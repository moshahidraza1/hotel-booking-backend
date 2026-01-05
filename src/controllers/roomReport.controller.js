import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { prisma } from "../db/db.config.js";

// Validate and parse date range
const validateDateRange = (startDate, endDate) => {
    if(!startDate || !endDate){
        throw new ApiError(400, "Start date and end date are required");
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if(isNaN(start.getTime()) || isNaN(end.getTime())){
        throw new ApiError(400, "Invalid date format. Use ISO 8601 format (YYYY-MM-DD)");
    }

    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    if(start >= end){
        throw new ApiError(400, "Start date must be before end date");
    }

    // Limit range to prevent excessive queries
    const daysDifference = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    if(daysDifference > 365){
        throw new ApiError(400, "Date range cannot exceed 365 days");
    }

    return {start, end, days: daysDifference};
};

//Calculate occupancy rate for a date range
const calculateOccupancyMetrics = (totalUnits, bookingDays, totalDays) => {
    if(totalUnits === 0) return {rate: 0, percentage: "0%"};
    
    const occupancyRate = (bookingDays / (totalUnits * totalDays)) * 100;
    return {
        rate: parseFloat(occupancyRate.toFixed(2)),
        percentage: `${occupancyRate.toFixed(2)}%`
    };
};

//Calculate occupancy % for date range
const getOccupancyRate = asyncHandler(async(req, res) => {
    const {startDate, endDate, roomTypeId} = req.body;

    const {start, end, days} = validateDateRange(startDate, endDate);

    // Get all room types or specific room type
    let roomTypeFilter = {};
    if(roomTypeId){
        const roomType = await prisma.roomType.findFirst({
            where: {id: roomTypeId, deletedAt: null}
        });

        if(!roomType){
            throw new ApiError(404, "Room type not found");
        }

        roomTypeFilter = {id: roomTypeId};
    }

    // Fetch room types with unit counts
    const roomTypes = await prisma.roomType.findMany({
        where: {...roomTypeFilter, deletedAt: null},
        include: {
            _count: {select: {units: true}},
            bookings: {
                where: {
                    checkIn: {lt: end},
                    checkOut: {gt: start},
                    status: {in: ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"]}
                },
                select: {
                    checkIn: true,
                    checkOut: true,
                    id: true
                }
            }
        }
    });

    if(roomTypes.length === 0){
        throw new ApiError(404, "No room types found");
    }

    // Calculate occupancy for each room type
    const occupancyDetails = roomTypes.map(roomType => {
        const totalUnits = roomType._count.units;
        if(totalUnits === 0){
            return {
                roomTypeId: roomType.id,
                roomTypeName: roomType.name,
                totalUnits: 0,
                occupancyRate: 0,
                occupancyPercentage: "0%",
                bookedRoomDays: 0,
                availableRoomDays: 0
            };
        }

        // Calculate booked room-days
        let bookedRoomDays = 0;
        roomType.bookings.forEach(booking => {
            const checkIn = new Date(booking.checkIn);
            checkIn.setHours(0, 0, 0, 0);
            const checkOut = new Date(booking.checkOut);
            checkOut.setHours(0, 0, 0, 0);

            // Overlap calculation
            const overlapStart = new Date(Math.max(checkIn.getTime(), start.getTime()));
            const overlapEnd = new Date(Math.min(checkOut.getTime(), end.getTime()));

            if(overlapStart < overlapEnd){
                const overlapDays = Math.ceil((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24));
                bookedRoomDays += overlapDays;
            }
        });

        const availableRoomDays = (totalUnits * days) - bookedRoomDays;
        const occupancyRate = (bookedRoomDays / (totalUnits * days)) * 100;

        return {
            roomTypeId: roomType.id,
            roomTypeName: roomType.name,
            totalUnits,
            occupancyRate: parseFloat(occupancyRate.toFixed(2)),
            occupancyPercentage: `${occupancyRate.toFixed(2)}%`,
            bookedRoomDays,
            availableRoomDays,
            totalRoomDays: totalUnits * days
        };
    });

    // Calculate overall occupancy
    const totalBookedDays = occupancyDetails.reduce((sum, dt) => sum + dt.bookedRoomDays, 0);
    const totalAvailableDays = occupancyDetails.reduce((sum, dt) => sum + dt.availableRoomDays, 0);
    const totalRoomDays = totalBookedDays + totalAvailableDays;
    const overallOccupancy = (totalBookedDays / totalRoomDays) * 100;

    return res.status(200).json(
        new ApiResponse(200, {
            period: {
                from: start.toISOString().split('T')[0],
                to: end.toISOString().split('T')[0],
                days
            },
            overall: {
                occupancyRate: parseFloat(overallOccupancy.toFixed(2)),
                occupancyPercentage: `${overallOccupancy.toFixed(2)}%`,
                totalRoomDays,
                bookedRoomDays: totalBookedDays,
                availableRoomDays: totalAvailableDays
            },
            byRoomType: occupancyDetails
        }, "Occupancy rate calculated successfully")
    );
});

// Get revenue by room type for date range
const getRevenueByRoomType = asyncHandler(async(req, res) => {
    const {startDate, endDate, roomTypeId} = req.body;

    const {start, end} = validateDateRange(startDate, endDate);

    let roomTypeFilter = {};
    if(roomTypeId){
        const roomType = await prisma.roomType.findFirst({
            where: {id: roomTypeId, deletedAt: null}
        });

        if(!roomType){
            throw new ApiError(404, "Room type not found");
        }

        roomTypeFilter = {id: roomTypeId};
    }

    // Fetch bookings grouped by room type
    const bookings = await prisma.booking.findMany({
        where: {
            ...roomTypeFilter,
            checkIn: {lt: end},
            checkOut: {gt: start},
            status: {in: ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"]},
            roomType: {deletedAt: null}
        },
        include: {
            roomType: {select: {id: true, name: true, basePrice: true}},
            payment: {select: {status: true}}
        }
    });

    if(bookings.length === 0){
        throw new ApiError(404, "No bookings found for the specified period");
    }

    // Group by room type and calculate revenue
    const revenueMap = new Map();

    bookings.forEach(booking => {
        const key = booking.roomTypeId;
        if(!revenueMap.has(key)){
            revenueMap.set(key, {
                roomTypeId: booking.roomType.id,
                roomTypeName: booking.roomType.name,
                basePrice: parseFloat(booking.roomType.basePrice),
                totalRevenue: 0,
                successfulPayments: 0,
                pendingPayments: 0,
                failedPayments: 0,
                totalBookings: 0,
                avgBookingValue: 0
            });
        }

        const data = revenueMap.get(key);
        data.totalRevenue += parseFloat(booking.totalPrice);
        data.totalBookings += 1;

        if(booking.payment){
            if(booking.payment.status === "SUCCESS"){
                data.successfulPayments += 1;
            } else if(booking.payment.status === "PENDING"){
                data.pendingPayments += 1;
            } else {
                data.failedPayments += 1;
            }
        }
    });

    // Calculate averages
    const revenueByRoomType = Array.from(revenueMap.values()).map(data => ({
        ...data,
        totalRevenue: parseFloat(data.totalRevenue.toFixed(2)),
        avgBookingValue: parseFloat((data.totalRevenue / data.totalBookings).toFixed(2))
    }));

    // Calculate overall metrics
    const totalRevenue = revenueByRoomType.reduce((sum, rt) => sum + rt.totalRevenue, 0);
    const totalBookings = revenueByRoomType.reduce((sum, rt) => sum + rt.totalBookings, 0);

    return res.status(200).json(
        new ApiResponse(200, {
            period: {
                from: start.toISOString().split('T')[0],
                to: end.toISOString().split('T')[0]
            },
            summary: {
                totalRevenue: parseFloat(totalRevenue.toFixed(2)),
                totalBookings,
                avgRevenuePerBooking: parseFloat((totalRevenue / totalBookings).toFixed(2))
            },
            byRoomType: revenueByRoomType
        }, "Revenue report generated successfully")
    );
});

// Predict future availability for next N days
const getAvailabilityForecast = asyncHandler(async(req, res) => {
    const {days = 30} = req.query;

    if(days < 1 || days > 365){
        throw new ApiError(400, "Days must be between 1 and 365");
    }

    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + parseInt(days));

    // Fetch all room types with inventory and bookings
    const roomTypes = await prisma.roomType.findMany({
        where: {deletedAt: null},
        include: {
            _count: {select: {units: true}},
            inventory: {
                where: {
                    date: {gte: startDate, lt: endDate}
                },
                select: {date: true, availableCount: true, totalStock: true},
                orderBy: {date: 'asc'}
            },
            bookings: {
                where: {
                    checkIn: {lt: endDate},
                    checkOut: {gt: startDate},
                    status: {in: ["CONFIRMED", "CHECKED_IN"]}
                },
                select: {checkIn: true, checkOut: true}
            }
        }
    });

    if(roomTypes.length === 0){
        throw new ApiError(404, "No room types found");
    }

    // Build forecast for each room type
    const forecasts = roomTypes.map(roomType => {
        const totalUnits = roomType._count.units;
        const dailyForecast = [];

        const currentDate = new Date(startDate);
        while(currentDate < endDate){
            const dateKey = currentDate.toISOString().split('T')[0];

            // Get inventory for this date
            const inventoryData = roomType.inventory.find(
                inv => inv.date.toISOString().split('T')[0] === dateKey
            );

            // Get bookings for this date
            const bookingsForDate = roomType.bookings.filter(booking => {
                const checkIn = new Date(booking.checkIn);
                checkIn.setHours(0, 0, 0, 0);
                const checkOut = new Date(booking.checkOut);
                checkOut.setHours(0, 0, 0, 0);

                return checkIn <= currentDate && currentDate < checkOut;
            }).length;

            const available = inventoryData ? inventoryData.availableCount : totalUnits;
            const occupancyCount = bookingsForDate;
            const actualAvailable = Math.max(0, available - occupancyCount);

            dailyForecast.push({
                date: dateKey,
                totalUnits,
                occupiedUnits: occupancyCount,
                availableUnits: actualAvailable,
                occupancyPercentage: parseFloat(((occupancyCount / totalUnits) * 100).toFixed(2))
            });

            currentDate.setDate(currentDate.getDate() + 1);
        }

        // Calculate forecast statistics
        const avgOccupancy = dailyForecast.reduce((sum, d) => sum + d.occupancyPercentage, 0) / dailyForecast.length;
        const minAvailable = Math.min(...dailyForecast.map(d => d.availableUnits));
        const maxAvailable = Math.max(...dailyForecast.map(d => d.availableUnits));
        const fullyBookedDays = dailyForecast.filter(d => d.availableUnits === 0).length;

        return {
            roomTypeId: roomType.id,
            roomTypeName: roomType.name,
            totalUnits,
            statistics: {
                avgOccupancyPercentage: parseFloat(avgOccupancy.toFixed(2)),
                minAvailableUnits: minAvailable,
                maxAvailableUnits: maxAvailable,
                fullyBookedDays,
                partiallyAvailableDays: dailyForecast.filter(d => d.availableUnits > 0 && d.availableUnits < totalUnits).length,
                completelyAvailableDays: dailyForecast.filter(d => d.availableUnits === totalUnits).length
            },
            dailyForecast
        };
    });

    return res.status(200).json(
        new ApiResponse(200, {
            period: {
                from: startDate.toISOString().split('T')[0],
                to: endDate.toISOString().split('T')[0],
                days: parseInt(days)
            },
            forecasts
        }, "Availability forecast generated successfully")
    );
});

// Get current inventory status summary
const getInventoryStatus = asyncHandler(async(req, res) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Fetch all room types with current status
    const roomTypes = await prisma.roomType.findMany({
        where: {deletedAt: null},
        include: {
            _count: {select: {units: true}},
            units: {
                select: {
                    id: true,
                    status: true
                }
            },
            inventory: {
                where: {date: today},
                select: {availableCount: true, totalStock: true}
            },
            bookings: {
                where: {
                    checkIn: {lte: today},
                    checkOut: {gt: today},
                    status: {in: ["CONFIRMED", "CHECKED_IN"]}
                },
                select: {id: true}
            }
        }
    });

    if(roomTypes.length === 0){
        throw new ApiError(404, "No room types found");
    }

    // Calculate status for each room type
    const inventoryStatus = roomTypes.map(roomType => {
        const totalUnits = roomType._count.units;
        
        // Count units by status
        const statusCounts = {
            AVAILABLE: 0,
            DIRTY: 0,
            MAINTENANCE: 0,
            OCCUPIED: 0
        };

        roomType.units.forEach(unit => {
            statusCounts[unit.status]++;
        });

        // Get inventory data
        const inventoryData = roomType.inventory[0];
        const currentAvailable = inventoryData ? inventoryData.availableCount : totalUnits;
        const currentOccupied = roomType.bookings.length;

        return {
            roomTypeId: roomType.id,
            roomTypeName: roomType.name,
            totalUnits,
            unitStatus: {
                available: statusCounts.AVAILABLE,
                dirty: statusCounts.DIRTY,
                maintenance: statusCounts.MAINTENANCE,
                occupied: statusCounts.OCCUPIED
            },
            inventoryStatus: {
                availableForBooking: currentAvailable,
                totalStock: inventoryData ? inventoryData.totalStock : totalUnits,
                currentlyOccupied: currentOccupied,
                utilizationPercentage: parseFloat(((currentOccupied / totalUnits) * 100).toFixed(2))
            },
            healthIndicator: statusCounts.MAINTENANCE > 0 ? "warning" : statusCounts.DIRTY > 0 ? "caution" : "healthy"
        };
    });

    // Overall summary
    const totalUnits = inventoryStatus.reduce((sum, inv) => sum + inv.totalUnits, 0);
    const totalAvailable = inventoryStatus.reduce((sum, inv) => sum + inv.unitStatus.available, 0);
    const totalOccupied = inventoryStatus.reduce((sum, inv) => sum + inv.unitStatus.occupied, 0);
    const totalDirty = inventoryStatus.reduce((sum, inv) => sum + inv.unitStatus.dirty, 0);
    const totalMaintenance = inventoryStatus.reduce((sum, inv) => sum + inv.unitStatus.maintenance, 0);

    return res.status(200).json(
        new ApiResponse(200, {
            date: today.toISOString().split('T')[0],
            summary: {
                totalUnits,
                availableUnits: totalAvailable,
                occupiedUnits: totalOccupied,
                dirtyUnits: totalDirty,
                maintenanceUnits: totalMaintenance,
                occupancyPercentage: parseFloat(((totalOccupied / totalUnits) * 100).toFixed(2))
            },
            byRoomType: inventoryStatus
        }, "Inventory status fetched successfully")
    );
});

// Get booking trends - Most booked room types
const getBookingTrends = asyncHandler(async(req, res) => {
    const {startDate, endDate, limit = 10} = req.body;
    let {page = 1} = req.query;

    const {start, end} = validateDateRange(startDate, endDate);

    page = Math.max(1, parseInt(page) || 1);
    limit = Math.min(50, Math.max(1, parseInt(limit) || 10));
    const skip = (page - 1) * limit;

    // Fetch bookings with room type details
    const bookings = await prisma.booking.findMany({
        where: {
            checkIn: {lt: end},
            checkOut: {gt: start},
            status: {in: ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"]},
            roomType: {deletedAt: null}
        },
        include: {
            roomType: {select: {id: true, name: true, basePrice: true, capacity: true}}
        }
    });

    if(bookings.length === 0){
        throw new ApiError(404, "No bookings found for the specified period");
    }

    // Group and analyze booking trends
    const trendMap = new Map();

    bookings.forEach(booking => {
        const key = booking.roomTypeId;
        if(!trendMap.has(key)){
            trendMap.set(key, {
                roomTypeId: booking.roomType.id,
                roomTypeName: booking.roomType.name,
                basePrice: parseFloat(booking.roomType.basePrice),
                capacity: booking.roomType.capacity,
                totalBookings: 0,
                totalRevenue: 0,
                totalNights: 0,
                avgNightlyRate: 0
            });
        }

        const data = trendMap.get(key);
        data.totalBookings += 1;
        data.totalRevenue += parseFloat(booking.totalPrice);

        const checkIn = new Date(booking.checkIn);
        const checkOut = new Date(booking.checkOut);
        const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
        data.totalNights += nights;
    });

    // Calculate averages and sort
    let trends = Array.from(trendMap.values())
        .map(data => ({
            ...data,
            totalRevenue: parseFloat(data.totalRevenue.toFixed(2)),
            avgNightlyRate: parseFloat((data.totalRevenue / data.totalNights).toFixed(2)),
            revenuePerBooking: parseFloat((data.totalRevenue / data.totalBookings).toFixed(2))
        }))
        .sort((a, b) => b.totalBookings - a.totalBookings);

    const total = trends.length;
    trends = trends.slice(skip, skip + limit);

    const totalPages = Math.ceil(total / limit);

    // Calculate trend insights
    const topRoomType = Array.from(trendMap.values()).reduce((max, current) => 
        current.totalBookings > max.totalBookings ? current : max
    );

    return res.status(200).json(
        new ApiResponse(200, {
            period: {
                from: start.toISOString().split('T')[0],
                to: end.toISOString().split('T')[0]
            },
            insights: {
                mostBookedRoomType: topRoomType.roomTypeName,
                mostBookedCount: topRoomType.totalBookings,
                totalBookings: bookings.length,
                avgBookingsPerRoomType: parseFloat((bookings.length / trendMap.size).toFixed(2))
            },
            trends,
            pagination: {
                total,
                page,
                limit,
                totalPages
            }
        }, "Booking trends retrieved successfully")
    );
});

// Comprehensive dashboard report
const getDashboardReport = asyncHandler(async(req, res) => {
    const {days = 30} = req.query;

    if(days < 1 || days > 365){
        throw new ApiError(400, "Days must be between 1 and 365");
    }

    const endDate = new Date();
    endDate.setHours(0, 0, 0, 0);

    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - parseInt(days));

    // Parallel data fetching
    const [
        roomTypes,
        bookings,
        inventory,
        dailyRates
    ] = await Promise.all([
        prisma.roomType.findMany({
            where: {deletedAt: null},
            include: {_count: {select: {units: true}}}
        }),
        prisma.booking.findMany({
            where: {
                checkIn: {lt: endDate},
                checkOut: {gt: startDate},
                status: {in: ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"]},
                roomType: {deletedAt: null}
            },
            include: {roomType: {select: {id: true, name: true}}}
        }),
        prisma.roomInventory.findMany({
            where: {
                date: {gte: startDate, lt: endDate}
            }
        }),
        prisma.dailyRate.findMany({
            where: {
                date: {gte: startDate, lt: endDate}
            }
        })
    ]);

    // Calculate metrics
    const totalRoomTypes = roomTypes.length;
    const totalUnits = roomTypes.reduce((sum, rt) => sum + rt._count.units, 0);
    const totalBookings = bookings.length;
    const totalRevenue = bookings.reduce((sum, b) => sum + parseFloat(b.totalPrice), 0);

    // Occupancy calculation
    let bookedRoomDays = 0;
    bookings.forEach(booking => {
        const checkIn = new Date(booking.checkIn);
        checkIn.setHours(0, 0, 0, 0);
        const checkOut = new Date(booking.checkOut);
        checkOut.setHours(0, 0, 0, 0);

        const overlapStart = new Date(Math.max(checkIn.getTime(), startDate.getTime()));
        const overlapEnd = new Date(Math.min(checkOut.getTime(), endDate.getTime()));

        if(overlapStart < overlapEnd){
            const overlapDays = Math.ceil((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24));
            bookedRoomDays += overlapDays;
        }
    });

    const totalRoomDays = totalUnits * parseInt(days);
    const occupancyRate = (bookedRoomDays / totalRoomDays) * 100;

    return res.status(200).json(
        new ApiResponse(200, {
            period: {
                from: startDate.toISOString().split('T')[0],
                to: endDate.toISOString().split('T')[0],
                days: parseInt(days)
            },
            overview: {
                totalRoomTypes,
                totalUnits,
                totalBookings,
                totalRevenue: parseFloat(totalRevenue.toFixed(2)),
                avgRevenuePerBooking: totalBookings > 0 ? parseFloat((totalRevenue / totalBookings).toFixed(2)) : 0
            },
            occupancy: {
                rate: parseFloat(occupancyRate.toFixed(2)),
                percentage: `${occupancyRate.toFixed(2)}%`,
                bookedRoomDays,
                totalRoomDays
            },
            averages: {
                bookingsPerRoomType: parseFloat((totalBookings / totalRoomTypes).toFixed(2)),
                revenuePerRoomType: parseFloat((totalRevenue / totalRoomTypes).toFixed(2)),
                revenuePerUnit: parseFloat((totalRevenue / totalUnits).toFixed(2))
            }
        }, "Dashboard report generated successfully")
    );
});

export {
    getOccupancyRate,
    getRevenueByRoomType,
    getAvailabilityForecast,
    getInventoryStatus,
    getBookingTrends,
    getDashboardReport
};
