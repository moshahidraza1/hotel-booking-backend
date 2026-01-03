import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { prisma } from "../db/db.config.js";

// Initialize stock for date (totalStock, availableCount)
const createInventory = asyncHandler(async(req, res) => {
    const {roomTypeId, date, availableCount, totalStock} = req.body;
    
    if(!roomTypeId || !date || !availableCount || !totalStock){
        throw new ApiError(400, "RoomType Id, Date, Available Count and Total Stock are required");
    }
    
    // Validate date is a valid Date object
    const parsedDate = new Date(date);
    if(isNaN(parsedDate.getTime())){
        throw new ApiError(400, "Invalid date format");
    }
    
    // Validate stock numbers
    if(availableCount < 0 || totalStock <= 0){
        throw new ApiError(400, "Available count must be >= 0 and total stock must be > 0");
    }
    
    if(availableCount > totalStock){
        throw new ApiError(400, "Available count cannot exceed total stock");
    }
    
    const roomType = await prisma.roomType.findFirst({
        where: {id: roomTypeId, deletedAt: null}
    });
    
    if(!roomType){
        throw new ApiError(404, "Room Type not found or already deleted");
    }
    
    const existingInventory = await prisma.roomInventory.findUnique({
        where: {roomTypeId_date: {roomTypeId, date: parsedDate}}
    });
    
    if(existingInventory){
        throw new ApiError(409, "Room inventory for this Room Type and date already exists");
    }

    const createdRoomInventory = await prisma.roomInventory.create({
        data: {
            roomTypeId,
            date: parsedDate,
            availableCount,
            totalStock,
        },
        include: {roomType: {select: {id: true, name: true}}}
    });

    return res.status(201).json(
        new ApiResponse(201, createdRoomInventory, "Room inventory created successfully")
    );
});

// Get stock for specific date
const getInventory = asyncHandler(async(req, res) => {
    const {roomTypeId, date} = req.body;
    
    if(!roomTypeId || !date){
        throw new ApiError(400, "Room Type Id and date are required");
    }
    
    const parsedDate = new Date(date);
    if(isNaN(parsedDate.getTime())){
        throw new ApiError(400, "Invalid date format");
    }
    
    const roomInventory = await prisma.roomInventory.findUnique({
        where: {roomTypeId_date: {roomTypeId, date: parsedDate}},
        include:{roomType:{select: {id: true, name: true, slug: true, basePrice: true}}}
    });
    
    if(!roomInventory){
        throw new ApiError(404, "Room inventory not found for the specified date");
    }
    
    return res.status(200).json(
        new ApiResponse(200, roomInventory, "Room inventory fetched successfully")
    );
});

// Get stock for date range (check availability)
const getInventoryRange = asyncHandler(async(req, res) => {
    const {roomTypeId, checkInDate, checkOutDate} = req.params;

    if(!roomTypeId || !checkInDate || !checkOutDate){
        throw new ApiError(400, "RoomType Id, CheckIn Date, and CheckOut Date are required");
    }

    const startDate = new Date(checkInDate);
    const endDate = new Date(checkOutDate);
    
    if(isNaN(startDate.getTime()) || isNaN(endDate.getTime())){
        throw new ApiError(400, "Invalid date format");
    }
    
    if(startDate >= endDate){
        throw new ApiError(400, "Check-in date must be before check-out date");
    }

    // Verify room type exists
    const roomType = await prisma.roomType.findFirst({
        where: {id: roomTypeId, deletedAt: null}
    });
    
    if(!roomType){
        throw new ApiError(404, "Room type not found or deleted");
    }

    // Get inventory for all dates in range
    const inventoryRange = await prisma.roomInventory.findMany({
        where: {
            roomTypeId,
            date: {
                gte: startDate,
                lt: endDate  
            }
        },
        orderBy: {date: 'asc'},
        include:{roomType:{select: {id: true, name: true}}}
    });

    if(inventoryRange.length === 0){
        throw new ApiError(404, "No inventory found for the specified date range");
    }

    // Find minimum available count (bottleneck)
    const minAvailable = Math.min(...inventoryRange.map(inv => inv.availableCount));
    
    return res.status(200).json(
        new ApiResponse(200, {
            roomTypeId,
            checkInDate: startDate,
            checkOutDate: endDate,
            daysCount: inventoryRange.length,
            minAvailable,
            maxBookable: minAvailable,
            inventoryDetails: inventoryRange
        }, "Room inventory availability fetched successfully")
    );
});

// Verify available rooms for check-in/check-out dates
const checkAvailability = asyncHandler(async(req, res) => {
    const {roomTypeId, checkInDate, checkOutDate, roomsNeeded = 1} = req.body;

    if(!roomTypeId || !checkInDate || !checkOutDate){
        throw new ApiError(400, "RoomType Id, CheckIn Date, and CheckOut Date are required");
    }

    if(roomsNeeded < 1){
        throw new ApiError(400, "Rooms needed must be at least 1");
    }

    const startDate = new Date(checkInDate);
    const endDate = new Date(checkOutDate);
    
    if(isNaN(startDate.getTime()) || isNaN(endDate.getTime())){
        throw new ApiError(400, "Invalid date format");
    }
    
    if(startDate >= endDate){
        throw new ApiError(400, "Check-in date must be before check-out date");
    }
    
    if(startDate < new Date(new Date().setHours(0, 0, 0, 0))){
        throw new ApiError(400, "Check-in date cannot be in the past");
    }

    // Verify room type exists
    const roomType = await prisma.roomType.findFirst({
        where: {id: roomTypeId, deletedAt: null}
    });
    
    if(!roomType){
        throw new ApiError(404, "Room type not found");
    }

    // Get inventory for all dates in range
    const inventoryData = await prisma.roomInventory.findMany({
        where: {
            roomTypeId,
            date: {
                gte: startDate,
                lt: endDate
            }
        },
        select: {date: true, availableCount: true}
    });

    if(inventoryData.length === 0){
        throw new ApiError(404, "No inventory data for selected dates");
    }

    // Check if rooms are available for entire duration
    const minAvailable = Math.min(...inventoryData.map(inv => inv.availableCount));
    const isAvailable = minAvailable >= roomsNeeded;

    return res.status(200).json(
        new ApiResponse(200, {
            roomTypeId,
            isAvailable,
            roomsRequested: roomsNeeded,
            minAvailableInRange: minAvailable,
            canBook: minAvailable,
            message: isAvailable 
                ? `${minAvailable} rooms available for entire stay` 
                : `Only ${minAvailable} room(s) available, but ${roomsNeeded} requested`
        }, "Availability check completed")
    );
});

// Adjust stock count (manual adjustment)
const updateInventory = asyncHandler(async(req, res) => {
    const {roomTypeId, date, availableCount, totalStock, reason} = req.body;

    if(!roomTypeId || !date){
        throw new ApiError(400, "RoomType Id and date are required");
    }

    const parsedDate = new Date(date);
    if(isNaN(parsedDate.getTime())){
        throw new ApiError(400, "Invalid date format");
    }

    // Validate at least one field to update
    if(availableCount === undefined && totalStock === undefined){
        throw new ApiError(400, "At least one of availableCount or totalStock must be provided");
    }

    // Validate numbers if provided
    if(availableCount !== undefined && availableCount < 0){
        throw new ApiError(400, "Available count cannot be negative");
    }
    
    if(totalStock !== undefined && totalStock <= 0){
        throw new ApiError(400, "Total stock must be greater than 0");
    }

    const existingInventory = await prisma.roomInventory.findUnique({
        where: {roomTypeId_date: {roomTypeId, date: parsedDate}}
    });

    if(!existingInventory){
        throw new ApiError(404, "Room inventory not found for the specified date");
    }

    // Validate availableCount doesn't exceed totalStock
    const newAvailable = availableCount !== undefined ? availableCount : existingInventory.availableCount;
    const newTotal = totalStock !== undefined ? totalStock : existingInventory.totalStock;

    if(newAvailable > newTotal){
        throw new ApiError(400, "Available count cannot exceed total stock");
    }

    const updatedInventory = await prisma.roomInventory.update({
        where: {roomTypeId_date: {roomTypeId, date: parsedDate}},
        data: {
            ...(availableCount !== undefined && {availableCount}),
            ...(totalStock !== undefined && {totalStock})
        },
        include: {roomType: {select: {id: true, name: true}}}
    });

    return res.status(200).json(
        new ApiResponse(200, updatedInventory, "Room inventory updated successfully")
    );
});

// Reduce available count on booking confirm (with version control)
const decrementInventory = asyncHandler(async(req, res) => {
    const {roomTypeId, checkInDate, checkOutDate, quantity = 1} = req.body;

    if(!roomTypeId || !checkInDate || !checkOutDate){
        throw new ApiError(400, "RoomType Id, CheckIn Date, and CheckOut Date are required");
    }

    if(quantity < 1){
        throw new ApiError(400, "Quantity must be at least 1");
    }

    const startDate = new Date(checkInDate);
    const endDate = new Date(checkOutDate);
    
    if(isNaN(startDate.getTime()) || isNaN(endDate.getTime())){
        throw new ApiError(400, "Invalid date format");
    }

    // Use transaction for atomic operation
    const result = await prisma.$transaction(async(tx) => {
        // Lock and fetch all inventory records for date range
        const inventoryRecords = await tx.roomInventory.findMany({
            where: {
                roomTypeId,
                date: {
                    gte: startDate,
                    lt: endDate
                }
            }
        });

        if(inventoryRecords.length === 0){
            throw new ApiError(404, "No inventory found for date range");
        }

        // Check if all have sufficient stock
        const insufficientDates = inventoryRecords.filter(inv => inv.availableCount < quantity);
        
        if(insufficientDates.length > 0){
            throw new ApiError(400, `Insufficient inventory on dates: ${insufficientDates.map(d => d.date).join(', ')}`);
        }

        // Decrement all records
        const updatePromises = inventoryRecords.map(inv =>
            tx.roomInventory.update({
                where: {roomTypeId_date: {roomTypeId, date: inv.date}},
                data: {
                    availableCount: {decrement: quantity}
                }
            })
        );

        return await Promise.all(updatePromises);
    });

    return res.status(200).json(
        new ApiResponse(200, {
            roomTypeId,
            decremented: quantity,
            datesAffected: result.length,
            updatedRecords: result
        }, "Inventory decremented successfully")
    );
});

// Increase available count on booking cancel
const incrementInventory = asyncHandler(async(req, res) => {
    const {roomTypeId, checkInDate, checkOutDate, quantity = 1} = req.body;

    if(!roomTypeId || !checkInDate || !checkOutDate){
        throw new ApiError(400, "RoomType Id, CheckIn Date, and CheckOut Date are required");
    }

    if(quantity < 1){
        throw new ApiError(400, "Quantity must be at least 1");
    }

    const startDate = new Date(checkInDate);
    const endDate = new Date(checkOutDate);
    
    if(isNaN(startDate.getTime()) || isNaN(endDate.getTime())){
        throw new ApiError(400, "Invalid date format");
    }

    // Use transaction for atomic operation
    const result = await prisma.$transaction(async(tx) => {
        const inventoryRecords = await tx.roomInventory.findMany({
            where: {
                roomTypeId,
                date: {
                    gte: startDate,
                    lt: endDate
                }
            }
        });

        if(inventoryRecords.length === 0){
            throw new ApiError(404, "No inventory found for date range");
        }

        // Increment all records (but not exceeding totalStock)
        const updatePromises = inventoryRecords.map(inv =>{
            const newAvailable = Math.min(inv.availableCount + quantity, inv.totalStock);
            const incrementAmount = newAvailable - inv.availableCount;
            

            return tx.roomInventory.update({
                where: {roomTypeId_date: {roomTypeId, date: inv.date}},
                data: {
                    availableCount: {increment: incrementAmount}
                }
            })}
        );

        return await Promise.all(updatePromises);
    });

    return res.status(200).json(
        new ApiResponse(200, {
            roomTypeId,
            incremented: quantity,
            datesAffected: result.length,
            updatedRecords: result
        }, "Inventory incremented successfully")
    );
});

// Import inventory for multiple dates (CSV/Excel)
const bulkUploadInventory = asyncHandler(async(req, res) => {
    const {roomTypeId, inventoryData} = req.body;

    if(!roomTypeId || !inventoryData){
        throw new ApiError(400, "RoomType Id and inventory data are required");
    }

    if(!Array.isArray(inventoryData) || inventoryData.length === 0){
        throw new ApiError(400, "Inventory data must be a non-empty array");
    }

    // Validate room type exists
    const roomType = await prisma.roomType.findFirst({
        where: {id: roomTypeId, deletedAt: null}
    });

    if(!roomType){
        throw new ApiError(404, "Room type not found");
    }

    // Validate and prepare data
    const validatedData = inventoryData.map((item, index) => {
        const {date, availableCount, totalStock} = item;

        if(!date || availableCount === undefined || !totalStock){
            throw new ApiError(400, `Row ${index + 1}: Missing required fields (date, availableCount, totalStock)`);
        }

        const parsedDate = new Date(date);
        if(isNaN(parsedDate.getTime())){
            throw new ApiError(400, `Row ${index + 1}: Invalid date format`);
        }

        if(availableCount < 0 || totalStock <= 0){
            throw new ApiError(400, `Row ${index + 1}: Invalid stock values`);
        }

        if(availableCount > totalStock){
            throw new ApiError(400, `Row ${index + 1}: Available count exceeds total stock`);
        }

        return {
            roomTypeId, 
            date: parsedDate, 
            availableCount, 
            totalStock,
            dateKey: parsedDate.toISOString().split('T')[0]
        };
    });

    // Remove duplicates - keep the last occurrence
    const uniqueData = [];
    const seenDates = new Map();

    for(let i = validatedData.length - 1; i >= 0; i--){
        const item = validatedData[i];
        if(!seenDates.has(item.dateKey)){
            seenDates.set(item.dateKey, true);
            uniqueData.unshift(item);
        }
    }

    // Log removed duplicates
    const duplicateCount = validatedData.length - uniqueData.length;
    if(duplicateCount > 0){
        console.warn(`${duplicateCount} duplicate date entries were removed`);
    }

    // Bulk create with upsert
    const result = await prisma.$transaction(async(tx) => {
        const created = [];
        const updated = [];
        const duplicates = [];

        for(const item of uniqueData){
            const existing = await tx.roomInventory.findUnique({
                where: {roomTypeId_date: {roomTypeId: item.roomTypeId, date: item.date}}
            });

            if(existing){
                const updatedItem = await tx.roomInventory.update({
                    where: {roomTypeId_date: {roomTypeId: item.roomTypeId, date: item.date}},
                    data: {availableCount: item.availableCount, totalStock: item.totalStock}
                });
                updated.push(updatedItem);
            } else {
                const createdItem = await tx.roomInventory.create({
                    data: {
                        roomTypeId: item.roomTypeId,
                        date: item.date,
                        availableCount: item.availableCount,
                        totalStock: item.totalStock
                    }
                });
                created.push(createdItem);
            }
        }

        return {created, updated, duplicates};
    });

    return res.status(201).json(
        new ApiResponse(201, {
            created: result.created.length,
            updated: result.updated.length,
            total: validatedData.length,
            duplicatesRemoved: duplicateCount,
            processedCount: uniqueData.length,
            details: result
        }, "Bulk inventory upload completed successfully")
    );
});

// Project availability for next 30/90 days
const getInventoryForecast = asyncHandler(async(req, res) => {
    const {roomTypeId, days = 30} = req.query;

    if(!roomTypeId){
        throw new ApiError(400, "RoomType Id is required");
    }

    if(days < 1 || days > 365){
        throw new ApiError(400, "Days must be between 1 and 365");
    }

    // Verify room type exists
    const roomType = await prisma.roomType.findFirst({
        where: {id: roomTypeId, deletedAt: null}
    });

    if(!roomType){
        throw new ApiError(404, "Room type not found");
    }

    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + parseInt(days));

    // Get inventory for forecast period
    const forecast = await prisma.roomInventory.findMany({
        where: {
            roomTypeId,
            date: {
                gte: startDate,
                lt: endDate
            }
        },
        select: {date: true, availableCount: true, totalStock: true},
        orderBy: {date: 'asc'}
    });

    // Calculate analytics
    const analytics = {
        totalDays: parseInt(days),
        daysWithData: forecast.length,
        avgAvailable: forecast.length > 0 
            ? Math.round(forecast.reduce((sum, inv) => sum + inv.availableCount, 0) / forecast.length)
            : 0,
        minAvailable: forecast.length > 0 
            ? Math.min(...forecast.map(inv => inv.availableCount))
            : 0,
        maxAvailable: forecast.length > 0 
            ? Math.max(...forecast.map(inv => inv.availableCount))
            : 0,
        occupancyRate: forecast.length > 0
            ? Math.round(
                ((forecast.reduce((sum, inv) => sum + (inv.totalStock - inv.availableCount), 0) / 
                  forecast.reduce((sum, inv) => sum + inv.totalStock, 0)) * 100)
              )
            : 0
    };

    return res.status(200).json(
        new ApiResponse(200, {
            roomTypeId,
            forecastDays: parseInt(days),
            analytics,
            forecast
        }, "Inventory forecast generated successfully")
    );
});

export {
    createInventory,
    getInventory,
    getInventoryRange,
    checkAvailability,
    updateInventory,
    decrementInventory,
    incrementInventory,
    bulkUploadInventory,
    getInventoryForecast
};