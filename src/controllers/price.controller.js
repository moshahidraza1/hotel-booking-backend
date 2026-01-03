import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { prisma } from "../db/db.config.js";

//Validate price is positive and reasonable
const validatePrice = (price) => {
    if(price === null || price === undefined){
        throw new ApiError(400, "Price is required");
    }

    const parsedPrice = parseFloat(price);
    
    if(isNaN(parsedPrice)){
        throw new ApiError(400, "Price must be a valid number");
    }

    if(parsedPrice <= 0){
        throw new ApiError(400, "Price must be greater than 0");
    }

    // Prevent unreasonably high prices (max 999,999.99)
    if(parsedPrice > 999999.99){
        throw new ApiError(400, "Price cannot exceed 999,999.99");
    }

    return parsedPrice;
};

// Validate date is valid and not in the past
const validateAndParseDate = (date, allowPast = false) => {
    if(!date){
        throw new ApiError(400, "Date is required");
    }

    const parsedDate = new Date(date);
    
    if(isNaN(parsedDate.getTime())){
        throw new ApiError(400, "Invalid date format. Use ISO 8601 format (YYYY-MM-DD)");
    }

    // Normalize to start of day
    parsedDate.setHours(0, 0, 0, 0);

    // Check if date is in the past
    if(!allowPast){
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        if(parsedDate < today){
            throw new ApiError(400, "Cannot set pricing for past dates");
        }
    }

    return parsedDate;
};

// Verify room type exists and is not deleted
const verifyRoomTypeExists = async(roomTypeId) => {
    if(!roomTypeId){
        throw new ApiError(400, "Room Type ID is required");
    }

    const roomType = await prisma.roomType.findFirst({
        where: {id: roomTypeId, deletedAt: null}
    });

    if(!roomType){
        throw new ApiError(404, "Room type not found or already deleted");
    }

    return roomType;
};

// Set price for a specific date (override base price)
 
const createDailyRate = asyncHandler(async(req, res) => {
    const {roomTypeId, date, price, reason} = req.body;

    // Validation
    await verifyRoomTypeExists(roomTypeId);
    const parsedDate = validateAndParseDate(date, false);
    const validatedPrice = validatePrice(price);

    // Check for existing rate
    const existingRate = await prisma.dailyRate.findUnique({
        where: {roomTypeId_date: {roomTypeId, date: parsedDate}}
    });

    if(existingRate){
        throw new ApiError(409, `Daily rate already exists for ${parsedDate.toISOString().split('T')[0]}. Use update endpoint to modify.`);
    }

    // Create daily rate
    const dailyRate = await prisma.dailyRate.create({
        data: {
            roomTypeId,
            date: parsedDate,
            price: validatedPrice,
            currency: "USD"
        },
        include: {
            roomType: {select: {id: true, name: true, basePrice: true}}
        }
    });

    return res.status(201).json(
        new ApiResponse(201, dailyRate, "Daily rate created successfully")
    );
});

// Get price for a specific date
const getDailyRate = asyncHandler(async(req, res) => {
    const {roomTypeId, date} = req.body;

    // Validation
    await verifyRoomTypeExists(roomTypeId);
    const parsedDate = validateAndParseDate(date, true);

    // Get daily rate or fallback to base price
    const dailyRate = await prisma.dailyRate.findUnique({
        where: {roomTypeId_date: {roomTypeId, date: parsedDate}},
        include: {roomType: {select: {id: true, name: true, basePrice: true}}}
    });

    if(!dailyRate){
        throw new ApiError(404, "No daily rate found for this date. Base price applies.");
    }

    return res.status(200).json(
        new ApiResponse(200, dailyRate, "Daily rate fetched successfully")
    );
});

// Get rates for a date range with analytics
const getDailyRates = asyncHandler(async(req, res) => {
    const {roomTypeId, checkInDate, checkOutDate} = req.body;
    let {page = 1, limit = 31} = req.query;

    // Validation
    const roomType = await verifyRoomTypeExists(roomTypeId);
    const startDate = validateAndParseDate(checkInDate, true);
    const endDate = validateAndParseDate(checkOutDate, true);

    if(startDate >= endDate){
        throw new ApiError(400, "Check-in date must be before check-out date");
    }

    // Limit range to prevent excessive queries
    const daysDifference = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
    if(daysDifference > 365){
        throw new ApiError(400, "Date range cannot exceed 365 days");
    }

    page = Math.max(1, parseInt(page) || 1);
    limit = Math.min(100, Math.max(1, parseInt(limit) || 31));
    const skip = (page - 1) * limit;

    // Fetch daily rates for range
    const [dailyRates, totalCount] = await prisma.$transaction([
        prisma.dailyRate.findMany({
            where: {
                roomTypeId,
                date: {
                    gte: startDate,
                    lt: endDate
                }
            },
            skip,
            take: limit,
            orderBy: {date: 'asc'}
        }),
        prisma.dailyRate.count({
            where: {
                roomTypeId,
                date: {
                    gte: startDate,
                    lt: endDate
                }
            }
        })
    ]);

    // Calculate analytics
    const analytics = {
        dateRange: {
            from: startDate.toISOString().split('T')[0],
            to: endDate.toISOString().split('T')[0],
            totalDays: daysDifference
        },
        basePrice: roomType.basePrice,
        customRateCount: totalCount,
        averageCustomRate: dailyRates.length > 0 
            ? parseFloat((dailyRates.reduce((sum, rate) => sum + parseFloat(rate.price), 0) / dailyRates.length).toFixed(2))
            : null,
        minPrice: dailyRates.length > 0 
            ? Math.min(...dailyRates.map(rate => parseFloat(rate.price)))
            : null,
        maxPrice: dailyRates.length > 0 
            ? Math.max(...dailyRates.map(rate => parseFloat(rate.price)))
            : null,
        priceVariance: dailyRates.length > 0 
            ? ((Math.max(...dailyRates.map(rate => parseFloat(rate.price))) - 
                Math.min(...dailyRates.map(rate => parseFloat(rate.price)))) / 
                Math.min(...dailyRates.map(rate => parseFloat(rate.price))) * 100).toFixed(2) + "%"
            : null
    };

    const totalPages = Math.ceil(totalCount / limit);

    return res.status(200).json(
        new ApiResponse(200, {
            roomTypeId,
            analytics,
            rates: dailyRates,
            pagination: {
                total: totalCount,
                page,
                limit,
                totalPages
            }
        }, "Daily rates fetched successfully")
    );
});

// Update price for a specific date
const updateDailyRate = asyncHandler(async(req, res) => {
    const {roomTypeId, date, price} = req.body;

    // Validation
    await verifyRoomTypeExists(roomTypeId);
    const parsedDate = validateAndParseDate(date, true);
    const validatedPrice = validatePrice(price);

    // Verify rate exists
    const existingRate = await prisma.dailyRate.findUnique({
        where: {roomTypeId_date: {roomTypeId, date: parsedDate}}
    });

    if(!existingRate){
        throw new ApiError(404, "Daily rate not found for this date");
    }

    // Prevent updating past rates (audit trail)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if(parsedDate < today){
        throw new ApiError(400, "Cannot modify pricing for past dates");
    }

    // Update daily rate
    const updatedRate = await prisma.dailyRate.update({
        where: {roomTypeId_date: {roomTypeId, date: parsedDate}},
        data: {price: validatedPrice},
        include: {roomType: {select: {id: true, name: true, basePrice: true}}}
    });

    return res.status(200).json(
        new ApiResponse(200, updatedRate, "Daily rate updated successfully")
    );
});

// Delete custom rate for a date (revert to base price)
const deleteDailyRate = asyncHandler(async(req, res) => {
    const {roomTypeId, date} = req.body;

    // Validation
    const roomType = await verifyRoomTypeExists(roomTypeId);
    const parsedDate = validateAndParseDate(date, true);

    // Verify rate exists
    const existingRate = await prisma.dailyRate.findUnique({
        where: {roomTypeId_date: {roomTypeId, date: parsedDate}}
    });

    if(!existingRate){
        throw new ApiError(404, "Daily rate not found for this date");
    }

    // Delete daily rate
    await prisma.dailyRate.delete({
        where: {roomTypeId_date: {roomTypeId, date: parsedDate}}
    });

    return res.status(200).json(
        new ApiResponse(200, {
            date: parsedDate.toISOString().split('T')[0],
            fallbackPrice: roomType.basePrice,
            message: "Custom rate deleted. Base price now applies."
        }, "Daily rate deleted successfully")
    );
});

//Bulk upload rates for multiple dates (CSV/Excel import)
const bulkUploadRates = asyncHandler(async(req, res) => {
    const {roomTypeId, ratesData} = req.body;

    // Validation
    await verifyRoomTypeExists(roomTypeId);

    if(!ratesData || !Array.isArray(ratesData) || ratesData.length === 0){
        throw new ApiError(400, "Rates data must be a non-empty array");
    }

    if(ratesData.length > 365){
        throw new ApiError(400, "Cannot upload more than 365 rates at once");
    }

    // Validate and prepare data with deduplication
    const validatedData = [];
    const seenDates = new Map();

    for(let i = 0; i < ratesData.length; i++){
        const {date, price} = ratesData[i];

        try {
            const parsedDate = validateAndParseDate(date, false);
            const validatedPrice = validatePrice(price);

            const dateKey = parsedDate.toISOString().split('T')[0];

            // Keep last occurrence of duplicate dates
            if(seenDates.has(dateKey)){
                // Remove previous entry
                validatedData.splice(seenDates.get(dateKey), 1);
            }

            seenDates.set(dateKey, validatedData.length);
            validatedData.push({roomTypeId, date: parsedDate, price: validatedPrice});

        } catch(error){
            throw new ApiError(400, `Row ${i + 1}: ${error.message}`);
        }
    }

    // Bulk upsert with transaction
    const result = await prisma.$transaction(async(tx) => {
        const created = [];
        const updated = [];

        for(const item of validatedData){
            const existing = await tx.dailyRate.findUnique({
                where: {roomTypeId_date: {roomTypeId: item.roomTypeId, date: item.date}}
            });

            if(existing){
                const updatedRate = await tx.dailyRate.update({
                    where: {roomTypeId_date: {roomTypeId: item.roomTypeId, date: item.date}},
                    data: {price: item.price}
                });
                updated.push(updatedRate);
            } else {
                const createdRate = await tx.dailyRate.create({
                    data: item
                });
                created.push(createdRate);
            }
        }

        return {created, updated};
    });

    return res.status(201).json(
        new ApiResponse(201, {
            created: result.created.length,
            updated: result.updated.length,
            total: validatedData.length,
            duplicatesRemoved: ratesData.length - validatedData.length,
            details: result
        }, "Bulk rates upload completed successfully")
    );
});

//Get applicable rate for booking (daily rate OR base price fallback)
const getApplicableRate = asyncHandler(async(req, res) => {
    const {roomTypeId, checkInDate, checkOutDate} = req.body;

    // Validation
    const roomType = await verifyRoomTypeExists(roomTypeId);
    const startDate = validateAndParseDate(checkInDate, false);
    const endDate = validateAndParseDate(checkOutDate, false);

    if(startDate >= endDate){
        throw new ApiError(400, "Check-in date must be before check-out date");
    }

    // Get all daily rates for the period
    const dailyRates = await prisma.dailyRate.findMany({
        where: {
            roomTypeId,
            date: {
                gte: startDate,
                lt: endDate
            }
        },
        orderBy: {date: 'asc'}
    });

    // Build pricing breakdown
    const pricingBreakdown = [];
    let totalPrice = 0;
    const rateMap = new Map(dailyRates.map(rate => [rate.date.toISOString().split('T')[0], parseFloat(rate.price)]));

    const currentDate = new Date(startDate);
    while(currentDate < endDate){
        const dateKey = currentDate.toISOString().split('T')[0];
        const price = rateMap.has(dateKey) ? rateMap.get(dateKey) : parseFloat(roomType.basePrice);

        pricingBreakdown.push({
            date: dateKey,
            price,
            isCustomRate: rateMap.has(dateKey)
        });

        totalPrice += price;
        currentDate.setDate(currentDate.getDate() + 1);
    }

    // Calculate statistics
    const stats = {
        nights: pricingBreakdown.length,
        basePrice: parseFloat(roomType.basePrice),
        customRatesDays: dailyRates.length,
        basePriceDays: pricingBreakdown.length - dailyRates.length,
        minPrice: Math.min(...pricingBreakdown.map(p => p.price)),
        maxPrice: Math.max(...pricingBreakdown.map(p => p.price)),
        avgPrice: parseFloat((totalPrice / pricingBreakdown.length).toFixed(2)),
        totalPrice: parseFloat(totalPrice.toFixed(2))
    };

    return res.status(200).json(
        new ApiResponse(200, {
            roomTypeId,
            checkIn: startDate.toISOString().split('T')[0],
            checkOut: endDate.toISOString().split('T')[0],
            stats,
            pricingBreakdown
        }, "Applicable rates calculated successfully")
    );
});

// Get rate change history/audit trail with pagination
const getPriceHistory = asyncHandler(async(req, res) => {
    const {roomTypeId} = req.params;
    let {days = 90, page = 1, limit = 20} = req.query;

    // Validation
    await verifyRoomTypeExists(roomTypeId);

    days = Math.min(365, Math.max(1, parseInt(days) || 90));
    page = Math.max(1, parseInt(page) || 1);
    limit = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const skip = (page - 1) * limit;

    // Calculate date range
    const endDate = new Date();
    endDate.setHours(0, 0, 0, 0);
    
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - days);

    // Fetch rates
    const [rates, totalCount] = await prisma.$transaction([
        prisma.dailyRate.findMany({
            where: {
                roomTypeId,
                date: {
                    gte: startDate,
                    lte: endDate
                }
            },
            skip,
            take: limit,
            orderBy: {date: 'desc'},
            include: {
                roomType: {select: {id: true, name: true, basePrice: true}}
            }
        }),
        prisma.dailyRate.count({
            where: {
                roomTypeId,
                date: {
                    gte: startDate,
                    lte: endDate
                }
            }
        })
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    // Calculate price changes
    const ratesWithChange = rates.map((rate, index) => {
        const nextRate = rates[index + 1];
        const change = nextRate ? parseFloat(rate.price) - parseFloat(nextRate.price) : null;
        const percentChange = nextRate ? ((change / parseFloat(nextRate.price)) * 100).toFixed(2) : null;

        return {
            ...rate,
            price: parseFloat(rate.price),
            priceChange: change ? parseFloat(change.toFixed(2)) : null,
            percentageChange: percentChange ? `${percentChange}%` : null
        };
    });

    return res.status(200).json(
        new ApiResponse(200, {
            roomTypeId,
            period: {
                from: startDate.toISOString().split('T')[0],
                to: endDate.toISOString().split('T')[0],
                days
            },
            history: ratesWithChange,
            pagination: {
                total: totalCount,
                page,
                limit,
                totalPages
            }
        }, "Price history fetched successfully")
    );
});

// Get revenue analytics based on rates
const getPriceAnalytics = asyncHandler(async(req, res) => {
    const {roomTypeId, startDate: startDateStr, endDate: endDateStr} = req.body;

    // Validation
    const roomType = await verifyRoomTypeExists(roomTypeId);
    const startDate = validateAndParseDate(startDateStr, true);
    const endDate = validateAndParseDate(endDateStr, true);

    if(startDate >= endDate){
        throw new ApiError(400, "Start date must be before end date");
    }

    // Fetch rates and inventory for period
    const [dailyRates, inventory] = await prisma.$transaction([
        prisma.dailyRate.findMany({
            where: {
                roomTypeId,
                date: {
                    gte: startDate,
                    lt: endDate
                }
            }
        }),
        prisma.roomInventory.findMany({
            where: {
                roomTypeId,
                date: {
                    gte: startDate,
                    lt: endDate
                }
            }
        })
    ]);

    // Calculate analytics
    const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
    const customRateDays = dailyRates.length;
    const basePriceDays = totalDays - customRateDays;

    // Revenue projection
    const customRateRevenue = dailyRates.reduce((sum, rate) => sum + parseFloat(rate.price), 0);
    const basePriceRevenue = basePriceDays * parseFloat(roomType.basePrice);
    const totalRevenue = customRateRevenue + basePriceRevenue;

    return res.status(200).json(
        new ApiResponse(200, {
            roomTypeId,
            period: {
                from: startDate.toISOString().split('T')[0],
                to: endDate.toISOString().split('T')[0],
                totalDays
            },
            basePrice: parseFloat(roomType.basePrice),
            pricing: {
                customRateDays,
                basePriceDays,
                customRateAvg: customRateDays > 0 ? parseFloat((customRateRevenue / customRateDays).toFixed(2)) : null,
                avgPrice: parseFloat((totalRevenue / totalDays).toFixed(2))
            },
            revenue: {
                fromCustomRates: parseFloat(customRateRevenue.toFixed(2)),
                fromBasePrice: parseFloat(basePriceRevenue.toFixed(2)),
                total: parseFloat(totalRevenue.toFixed(2)),
                perDay: parseFloat((totalRevenue / totalDays).toFixed(2))
            }
        }, "Price analytics calculated successfully")
    );
});

export {
    createDailyRate,
    getDailyRate,
    getDailyRates,
    updateDailyRate,
    deleteDailyRate,
    bulkUploadRates,
    getApplicableRate,
    getPriceHistory,
    getPriceAnalytics
};