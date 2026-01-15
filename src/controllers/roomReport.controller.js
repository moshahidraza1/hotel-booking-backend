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
    end.setHours(23, 59, 59, 999);

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
    if(totalUnits === 0) {
        return {
            rate: 0, percentage: "0.00%"
        };
    }
    
    const occupancyRate = (bookingDays / (totalUnits * totalDays)) * 100;
    return {
        rate: parseFloat(occupancyRate.toFixed(2)),
        percentage: `${occupancyRate.toFixed(2)}%`
    };
};

// Calculate days between two dates
const calculateDaysBetween = (start, end) => {
    return Math.ceil((end - start) / (1000 * 60 * 60 * 24));
};

// Calculate overlap between two date ranges
const calculateOverlap = (bookingStart, bookingEnd, rangeStart, rangeEnd) => {
    const overlapStart = new Date(Math.max(bookingStart.getTime(), rangeStart.getTime()));
    const overlapEnd = new Date(Math.min(bookingEnd.getTime(), rangeEnd.getTime()));
    
    if (overlapStart >= overlapEnd) return 0;
    
    return calculateDaysBetween(overlapStart, overlapEnd);
};

// Stats calculation function
function calculateStats(daily, total) {
    const occSum = daily.reduce((sum, d) => sum + d.occupancyPercentage, 0);
    return {
        avgOccupancyPercentage: parseFloat((occSum / daily.length).toFixed(2)),
        minAvailableUnits: Math.min(...daily.map(d => d.availableUnits)),
        maxAvailableUnits: Math.max(...daily.map(d => d.availableUnits)),
        fullyBookedDays: daily.filter(d => d.availableUnits === 0).length,
        partiallyAvailableDays: daily.filter(d => d.availableUnits > 0 && d.availableUnits < total).length,
        completelyAvailableDays: daily.filter(d => d.availableUnits >= total).length
    };
}

//Calculate occupancy % for date range
const getOccupancyRate = asyncHandler(async(req, res) => {
    const {startDate, endDate, roomTypeId} = req.body;

    const {start, end, days} = validateDateRange(startDate, endDate);

    // Get all room types or specific room type
    let roomTypeFilter = {};
    if(roomTypeId){
        roomTypeFilter.id = roomTypeId;
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
                bookedRoomDays: 0,
                availableRoomDays: 0,
                occupancyRate: 0,
                occupancyPercentage: "0.00%"
            };
        }

        // Calculate booked room-days
        let bookedRoomDays = 0;
        roomType.bookings.forEach(booking => {
            const overlapDays = calculateOverlap(
                new Date(booking.checkIn),
                new Date(booking.checkOut),
                start,
                end
            );
            bookedRoomDays += overlapDays;
        });

        const totalRoomDays = totalUnits * days;
        const availableRoomDays = totalRoomDays - bookedRoomDays;
        const occupancyMetrics = calculateOccupancyMetrics(totalUnits, bookedRoomDays, days);

        return {
            roomTypeId: roomType.id,
            roomTypeName: roomType.name,
            totalUnits,
            bookedRoomDays,
            availableRoomDays,
            totalRoomDays,
            occupancyRate: occupancyMetrics.rate,
            occupancyPercentage: occupancyMetrics.percentage
        };
    });

    // Calculate overall occupancy
    const totalBookedDays = occupancyDetails.reduce((sum, dt) => sum + dt.bookedRoomDays, 0);
    const totalRoomDays = occupancyDetails.reduce((sum, dt) => sum + dt.totalRoomDays, 0);
    const totalAvailableDays = totalRoomDays - totalBookedDays;
    const overallOccupancy = totalRoomDays > 0 
        ? (totalBookedDays / totalRoomDays) * 100 
        : 0;

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
        roomTypeFilter.id = roomTypeId
    }

    // Fetch bookings grouped by room type
    const bookings = await prisma.booking.findMany({
        where: {
            roomType: {
                ...roomTypeFilter, 
            },
            checkIn: {lt: end},
            checkOut: {gt: start},
            status: {in: ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"]},
            roomType: {deletedAt: null}
        },
        include: {
            roomType: {select: {id: true, name: true, basePrice: true}},
            payment: {select: {status: true, amount: true}}
        }
    });

    if(bookings.length === 0){
        return res.status(200).json(
            new ApiResponse(200, {
                period: {
                    from: start.toISOString().split('T')[0],
                    to: end.toISOString().split('T')[0]
                },
                summary: {
                    totalRevenue: 0,
                    totalBookings: 0,
                    paidRevenue: 0,
                    pendingRevenue: 0,
                    avgRevenuePerBooking: 0
                },
                byRoomType: []
            }, "No bookings found for the specified period")
        );
    }

    // Group by room type and calculate revenue
    const revenueMap = new Map();

    bookings.forEach(booking => {
        const roomTypeId = booking.roomTypeId;
        if(!revenueMap.has(roomTypeId)){
            revenueMap.set(roomTypeId, {
                roomTypeId,
                roomTypeName: booking.roomType.name,
                basePrice: parseFloat(booking.roomType.basePrice),
                totalRevenue: 0,
                paidRevenue: 0,
                pendingRevenue: 0,
                totalBookings: 0,
                paidBookings: 0,
                pendingBookings: 0
            });
        }

        const data = revenueMap.get(roomTypeId);
        const bookingAmount = parseFloat(booking.totalPrice);
        data.totalRevenue += bookingAmount;
        data.totalBookings += 1;

        if (booking.payment && booking.payment.status === "SUCCESS") {
            data.paidRevenue += parseFloat(booking.payment.amount);
            data.paidBookings += 1;
        } else {
            data.pendingRevenue += bookingAmount;
            data.pendingBookings += 1;
        }
    });

    // Calculate averages
    const revenueByRoomType = Array.from(revenueMap.values()).map(data => ({
        ...data,
        totalRevenue: parseFloat(data.totalRevenue.toFixed(2)),
        paidRevenue: parseFloat(data.paidRevenue.toFixed(2)),
        pendingRevenue: parseFloat(data.pendingRevenue.toFixed(2)),
        avgBookingValue: parseFloat((data.totalRevenue / data.totalBookings).toFixed(2))
    }));

    // Calculate overall metrics
    const totalRevenue = revenueByRoomType.reduce((sum, rt) => sum + rt.totalRevenue, 0);
    const paidRevenue = revenueByRoomType.reduce((sum, rt) => sum + rt.paidRevenue, 0);
    const pendingRevenue = revenueByRoomType.reduce((sum, rt) => sum + rt.pendingRevenue, 0);
    const totalBookings = revenueByRoomType.reduce((sum, rt) => sum + rt.totalBookings, 0);


    return res.status(200).json(
        new ApiResponse(200, {
            period: {
                from: start.toISOString().split('T')[0],
                to: end.toISOString().split('T')[0]
            },
            summary: {
                totalRevenue: parseFloat(totalRevenue.toFixed(2)),
                paidRevenue: parseFloat(paidRevenue.toFixed(2)),
                pendingRevenue: parseFloat(pendingRevenue.toFixed(2)),
                totalBookings,
                avgRevenuePerBooking: totalBookings > 0 
                    ? parseFloat((totalRevenue / totalBookings).toFixed(2)) 
                    : 0
            },
            byRoomType: revenueByRoomType
        }, "Revenue report generated successfully")
    );
});

// Predict future availability for next N days
const getAvailabilityForecast = asyncHandler(async (req, res) => {
    const { days = 30 } = req.query;
    const numDays = Math.min(Math.max(parseInt(days) || 30, 1), 365);

    // Date Handling (UTC Midnight for consistency)
    const startDate = new Date();
    startDate.setUTCHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setUTCDate(startDate.getUTCDate() + numDays);

    const roomTypes = await prisma.roomType.findMany({
        where: { deletedAt: null },
        include: {
            _count: { select: { units: true } },
            inventory: {
                where: { date: { gte: startDate, lt: endDate } },
                select: { date: true, availableCount: true, totalStock: true }
            },
            bookings: {
                where: {
                    checkIn: { lt: endDate },
                    checkOut: { gt: startDate },
                    status: { in: ["CONFIRMED", "CHECKED_IN"] },
                    deletedAt: null 
                },
                select: { checkIn: true, checkOut: true }
            }
        }
    });

    if (roomTypes.length === 0) throw new ApiError(404, "No room types found");

    const forecasts = roomTypes.map(roomType => {
        const totalUnits = roomType._count.units;
        
        // Pre-index Inventory 
        const inventoryMap = new Map(
            roomType.inventory.map(inv => [inv.date.toISOString().split('T')[0], inv])
        );

        // Pre-calculate Occupancy Map 
        const occupancyMap = new Map();
        roomType.bookings.forEach(booking => {
            let cursor = new Date(Math.max(booking.checkIn, startDate));
            const bookingEnd = new Date(Math.min(booking.checkOut, endDate));
            
            while (cursor < bookingEnd) {
                const dKey = cursor.toISOString().split('T')[0];
                occupancyMap.set(dKey, (occupancyMap.get(dKey) || 0) + 1);
                cursor.setUTCDate(cursor.getUTCDate() + 1);
            }
        });

        const dailyForecast = [];
        let loopDate = new Date(startDate);

        while (loopDate < endDate) {
            const dateKey = loopDate.toISOString().split('T')[0];
            const inv = inventoryMap.get(dateKey);
            const occupied = occupancyMap.get(dateKey) || 0;

            const available = inv ? inv.availableCount : Math.max(0, totalUnits - occupied);

            dailyForecast.push({
                date: dateKey,
                totalUnits: inv ? inv.totalStock : totalUnits,
                occupiedUnits: occupied,
                availableUnits: available,
                occupancyPercentage: totalUnits > 0 ? parseFloat(((occupied / totalUnits) * 100).toFixed(2)) : 0
            });

            loopDate.setUTCDate(loopDate.getUTCDate() + 1);
        }

        // Calculate statistics from the dailyForecast array
        const stats = calculateStats(dailyForecast, totalUnits);

        return {
            roomTypeId: roomType.id,
            roomTypeName: roomType.name,
            totalUnits,
            statistics: stats,
            dailyForecast
        };
    });

    return res.status(200).json(new ApiResponse(200, {
        period: { from: startDate.toISOString().split('T')[0], to: endDate.toISOString().split('T')[0], days: numDays },
        forecasts
    }, "Forecast generated successfully"));
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
                    status: true,
                    roomNumber: true
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
                select: {id: true, roomUnitId: true}
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
const getBookingTrends = asyncHandler(async (req, res) => {
    const { startDate, endDate, limit = 10 } = req.body;
    let { page = 1 } = req.query;

    const { start, end, days } = validateDateRange(startDate, endDate);

    page = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const skip = (page - 1) * limitNum;

    // Fetch bookings with aggregation
    const bookings = await prisma.booking.groupBy({
        by: ['roomTypeId'],
        where: {
            checkIn: { gte: start },
            checkOut: { lte: end },
            status: { in: ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"] },
            roomType: { deletedAt: null }
        },
        _count: { id: true },
        _sum: { totalPrice: true },
        orderBy: {
            _count: { id: 'desc' }
        },
        take: limitNum,
        skip
    });

    // Get total count for pagination
    const totalRoomTypes = await prisma.booking.groupBy({
        by: ['roomTypeId'],
        where: {
            checkIn: { gte: start },
            checkOut: { lte: end },
            status: { in: ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"] },
            roomType: { deletedAt: null }
        }
    });

    if (bookings.length === 0) {
        return res.status(200).json(
            new ApiResponse(200, {
                period: {
                    from: start.toISOString().split('T')[0],
                    to: end.toISOString().split('T')[0],
                    days
                },
                pagination: {
                    currentPage: page,
                    totalPages: 0,
                    totalItems: 0,
                    itemsPerPage: limitNum
                },
                trends: []
            }, "No booking trends found")
        );
    }

    // Fetch room type details
    const roomTypeIds = bookings.map(b => b.roomTypeId);
    const roomTypes = await prisma.roomType.findMany({
        where: { id: { in: roomTypeIds } },
        select: { id: true, name: true, basePrice: true }
    });

    const roomTypeMap = new Map(roomTypes.map(rt => [rt.id, rt]));

    // Build trends data
    const trends = bookings.map((booking, index) => {
        const roomType = roomTypeMap.get(booking.roomTypeId);
        const totalBookings = booking._count.id;
        const totalRevenue = parseFloat(booking._sum.totalPrice || 0);
        
        return {
            rank: skip + index + 1,
            roomTypeId: booking.roomTypeId,
            roomTypeName: roomType?.name || "Unknown",
            basePrice: roomType ? parseFloat(roomType.basePrice) : 0,
            totalBookings,
            totalRevenue: parseFloat(totalRevenue.toFixed(2)),
            avgRevenuePerBooking: totalBookings > 0 
                ? parseFloat((totalRevenue / totalBookings).toFixed(2)) 
                : 0
        };
    });

    const totalPages = Math.ceil(totalRoomTypes.length / limitNum);

    return res.status(200).json(
        new ApiResponse(200, {
            period: {
                from: start.toISOString().split('T')[0],
                to: end.toISOString().split('T')[0],
                days
            },
            pagination: {
                currentPage: page,
                totalPages,
                totalItems: totalRoomTypes.length,
                itemsPerPage: limitNum
            },
            trends
        }, "Booking trends fetched successfully")
    );
});

// Comprehensive dashboard report
const getDashboardReport = asyncHandler(async (req, res) => {
    const { days = 30 } = req.query;
    const numDays = Math.min(Math.max(parseInt(days) || 30, 1), 365);

    // Normalize Date
    const endDate = new Date();
    endDate.setUTCHours(23, 59, 59, 999);
    const startDate = new Date();
    startDate.setUTCDate(endDate.getUTCDate() - numDays);
    startDate.setUTCHours(0, 0, 0, 0);

    //Parallel Database Aggregations
    const [
        roomTypeStats,
        revenueData,
        statusCounts,
        occupancyData
    ] = await Promise.all([
        // Get Total Capacity
        prisma.roomType.findMany({
            where: { deletedAt: null },
            select: { 
                id: true, 
                _count: { select: { units: true } } 
            }
        }),

        // Aggregated Revenue & Booking Counts (Last N days)
        prisma.booking.aggregate({
            where: {
                checkIn: { gte: startDate, lte: endDate },
                status: { in: ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"] },
                deletedAt: null
            },
            _sum: { totalPrice: true },
            _count: { id: true },
            _avg: { totalPrice: true }
        }),

        // Unit Status Snapshot (Housekeeping/Operations)
        prisma.roomUnit.groupBy({
            by: ['status'],
            _count: { _all: true }
        }),

        // Performance Optimization: Raw SQL for "Room-Night" Occupancy
        // Calculate the sum of nights stayed within the period for ALL bookings
        prisma.$queryRaw`
            SELECT SUM(
                LEAST(CAST("checkOut" AS DATE), CAST(${endDate} AS DATE)) - 
                GREATEST(CAST("checkIn" AS DATE), CAST(${startDate} AS DATE))
            ) as "bookedRoomNights"
            FROM "bookings"
            WHERE "checkIn" < ${endDate} 
              AND "checkOut" > ${startDate}
              AND "status" IN ('CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT')
              AND "deletedAt" IS NULL
        `
    ]);

    // Process Results
    const totalUnits = roomTypeStats.reduce((sum, rt) => sum + rt._count.units, 0);
    const totalRoomDaysCapacity = totalUnits * numDays;
    
    // Extract raw SQL result (BigInt handling)
    const bookedRoomNights = Number(occupancyData[0]?.bookedRoomNights || 0);
    const occupancyRate = totalRoomDaysCapacity > 0 
        ? parseFloat(((bookedRoomNights / totalRoomDaysCapacity) * 100).toFixed(2)) 
        : 0;

    // Format Status Snapshot
    const unitStatus = {
        AVAILABLE: 0, OCCUPIED: 0, DIRTY: 0, MAINTENANCE: 0
    };
    statusCounts.forEach(stat => {
        unitStatus[stat.status] = stat._count._all;
    });

    return res.status(200).json(
        new ApiResponse(200, {
            period: { from: startDate, to: endDate, days: numDays },
            financials: {
                totalRevenue: parseFloat((revenueData._sum.totalPrice || 0).toFixed(2)),
                totalBookings: revenueData._count.id,
                adr: parseFloat((revenueData._avg.totalPrice || 0).toFixed(2)), // Average Daily Rate
                revPAR: parseFloat(((revenueData._sum.totalPrice || 0) / totalRoomDaysCapacity).toFixed(2)) // Revenue Per Available Room
            },
            occupancy: {
                rate: occupancyRate,
                bookedRoomNights,
                totalCapacityNights: totalRoomDaysCapacity
            },
            operations: {
                totalUnits,
                unitStatus
            }
        }, "High-performance report generated")
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
