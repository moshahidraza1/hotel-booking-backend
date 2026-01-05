import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { prisma } from "../db/db.config.js";


// Generate unique booking reference Format: BK-YYYYMMDD-XXXXX (BK-20240115-A7K9M)
const generateBookingReference = async() => {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const randomStr = Math.random().toString(36).substring(2, 7).toUpperCase();
    const reference = `BK-${dateStr}-${randomStr}`;

    // Ensure uniqueness
    const existing = await prisma.booking.findUnique({
        where: {bookingReference: reference}
    });

    if(existing){
        return generateBookingReference(); // Recursive retry
    }

    return reference;
};

//Validate date range for booking
const validateBookingDates = (checkIn, checkOut) => {
    const start = new Date(checkIn);
    const end = new Date(checkOut);

    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    if(isNaN(start.getTime()) || isNaN(end.getTime())){
        throw new ApiError(400, "Invalid date format. Use YYYY-MM-DD");
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if(start < today){
        throw new ApiError(400, "Check-in date cannot be in the past");
    }

    if(start >= end){
        throw new ApiError(400, "Check-out date must be after check-in date");
    }

    const nights = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    if(nights > 10){
        throw new ApiError(400, "Booking cannot exceed 10 nights");
    }

    return {start, end, nights};
};

// Calculate total booking price
const calculateBookingPrice = async(roomTypeId, checkIn, checkOut) => {
    const roomType = await prisma.roomType.findFirst({
        where: {id: roomTypeId, deletedAt: null}
    });

    if(!roomType){
        throw new ApiError(404, "Room type not found");
    }

    // Get all daily rates for the period
    const dailyRates = await prisma.dailyRate.findMany({
        where: {
            roomTypeId,
            date: {
                gte: checkIn,
                lt: checkOut
            }
        }
    });

    // Build rate map
    const rateMap = new Map(
        dailyRates.map(rate => [
            rate.date.toISOString().split('T')[0],
            parseFloat(rate.price)
        ])
    );

    // Calculate price day by day
    let totalPrice = 0;
    const priceBreakdown = [];
    const currentDate = new Date(checkIn);

    while(currentDate < checkOut){
        const dateKey = currentDate.toISOString().split('T')[0];
        const dayPrice = rateMap.has(dateKey) 
            ? rateMap.get(dateKey) 
            : parseFloat(roomType.basePrice);

        totalPrice += dayPrice;
        priceBreakdown.push({
            date: dateKey,
            price: dayPrice,
            isCustomRate: rateMap.has(dateKey)
        });

        currentDate.setDate(currentDate.getDate() + 1);
    }

    return {
        totalPrice: parseFloat(totalPrice.toFixed(2)),
        priceBreakdown,
        basePrice: parseFloat(roomType.basePrice),
        currency: "USD"
    };
};

// Check room availability for dates
const checkRoomAvailability = async(roomTypeId, checkIn, checkOut) => {
    // Get inventory for date range
    const inventory = await prisma.roomInventory.findMany({
        where: {
            roomTypeId,
            date: {
                gte: checkIn,
                lt: checkOut
            }
        }
    });

    // Get confirmed bookings for date range
    const existingBookings = await prisma.booking.findMany({
        where: {
            roomTypeId,
            checkIn: {lt: checkOut},
            checkOut: {gt: checkIn},
            status: {in: ["CONFIRMED", "CHECKED_IN"]}
        }
    });

    if(inventory.length === 0){
        throw new ApiError(404, "No inventory data for selected dates");
    }

    // Check if minimum available rooms exist for entire period
    const minAvailable = Math.min(...inventory.map(inv => inv.availableCount));

    if(minAvailable <= existingBookings.length){
        throw new ApiError(409, "Room not available for selected dates");
    }

    return {available: true, minRoomsAvailable: minAvailable - existingBookings.length};
};

// Create a new booking (reserve room)
const createBooking = asyncHandler(async(req, res) => {
    const {guestId, roomTypeId, checkIn, checkOut, specialRequests} = req.body;

    // Validation
    if(!guestId || !roomTypeId || !checkIn || !checkOut){
        throw new ApiError(400, "Guest ID, Room Type ID, check-in and check-out dates are required");
    }

    // Verify guest exists
    const guest = await prisma.guestProfile.findUnique({
        where: {id: guestId}
    });

    if(!guest){
        throw new ApiError(404, "Guest profile not found");
    }

    // Validate dates
    const {start, end, nights} = validateBookingDates(checkIn, checkOut);

    // Verify room type exists
    const roomType = await prisma.roomType.findFirst({
        where: {id: roomTypeId, deletedAt: null}
    });

    if(!roomType){
        throw new ApiError(404, "Room type not found or deleted");
    }

    // Check availability
    await checkRoomAvailability(roomTypeId, start, end);

    // Calculate price
    const pricing = await calculateBookingPrice(roomTypeId, start, end);

    // Generate booking reference
    const bookingReference = await generateBookingReference();

    // Create booking in transaction
    const booking = await prisma.$transaction(async(tx) => {
        // Decrement inventory
        const inventoryRecords = await tx.roomInventory.findMany({
            where: {
                roomTypeId,
                date: {gte: start, lt: end}
            }
        });

        for(const inventory of inventoryRecords){
            await tx.roomInventory.update({
                where: {id: inventory.id},
                data: {availableCount: {decrement: 1}}
            });
        }

        // Create booking
        return await tx.booking.create({
            data: {
                bookingReference,
                guestId,
                roomTypeId,
                checkIn: start,
                checkOut: end,
                totalPrice: pricing.totalPrice,
                specialRequests: specialRequests?.trim() || null,
                status: "PENDING"
            },
            include: {
                guest: {select: {firstName: true, lastName: true, phone: true}},
                roomType: {select: {id: true, name: true, basePrice: true}},
                payment: true
            }
        });
    });

    return res.status(201).json(
        new ApiResponse(201, {
            booking,
            pricing
        }, "Booking created successfully. Proceed to payment.")
    );
});

// Get booking details
const getBooking = asyncHandler(async(req, res) => {
    const {bookingId} = req.params;

    if(!bookingId){
        throw new ApiError(400, "Booking ID is required");
    }

    const booking = await prisma.booking.findUnique({
        where: {id: bookingId},
        include: {
            guest: {select: {firstName: true, lastName: true, phone: true, email: true}},
            roomType: {select: {id: true, name: true, basePrice: true, capacity: true}},
            roomUnit: {select: {roomNumber: true, floor: true}},
            payment: true,
            review: true
        }
    });

    if(!booking){
        throw new ApiError(404, "Booking not found");
    }

    return res.status(200).json(
        new ApiResponse(200, booking, "Booking retrieved successfully")
    );
});

// Get booking by reference (guest-facing)
const getBookingByReference = asyncHandler(async(req, res) => {
    const {bookingReference} = req.params;

    if(!bookingReference){
        throw new ApiError(400, "Booking reference is required");
    }

    const booking = await prisma.booking.findUnique({
        where: {bookingReference},
        include: {
            guest: {select: {firstName: true, lastName: true, phone: true}},
            roomType: {select: {id: true, name: true, capacity: true}},
            roomUnit: {select: {roomNumber: true, floor: true}},
            payment: {select: {status: true, method: true}}
        }
    });

    if(!booking){
        throw new ApiError(404, "Booking not found");
    }

    return res.status(200).json(
        new ApiResponse(200, booking, "Booking retrieved successfully")
    );
});

// Get all bookings for a guest
const getGuestBookings = asyncHandler(async(req, res) => {
    const {guestId} = req.params;
    let {page = 1, limit = 10, status} = req.query;

    if(!guestId){
        throw new ApiError(400, "Guest ID is required");
    }

    // Verify guest exists
    const guest = await prisma.guestProfile.findUnique({
        where: {id: guestId}
    });

    if(!guest){
        throw new ApiError(404, "Guest not found");
    }

    page = Math.max(1, parseInt(page) || 1);
    limit = Math.min(50, Math.max(1, parseInt(limit) || 10));
    const skip = (page - 1) * limit;

    // Build where clause
    let whereClause = {guestId};
    if(status){
        const validStatuses = ["PENDING", "CONFIRMED", "CANCELLED", "CHECKED_IN", "CHECKED_OUT"];
        if(!validStatuses.includes(status.toUpperCase())){
            throw new ApiError(400, `Invalid status. Must be one of: ${validStatuses.join(', ')}`);
        }
        whereClause.status = status.toUpperCase();
    }

    const [bookings, totalCount] = await prisma.$transaction([
        prisma.booking.findMany({
            where: whereClause,
            skip,
            take: limit,
            orderBy: {createdAt: 'desc'},
            include: {
                roomType: {select: {name: true}},
                payment: {select: {status: true}},
                review: {select: {rating: true}}
            }
        }),
        prisma.booking.count({where: whereClause})
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    return res.status(200).json(
        new ApiResponse(200, {
            bookings,
            pagination: {
                total: totalCount,
                page,
                limit,
                totalPages
            }
        }, "Guest bookings retrieved successfully")
    );
});

//Cancel booking (before check-in)
const cancelBooking = asyncHandler(async(req, res) => {
    const {bookingId, reason} = req.body;

    if(!bookingId){
        throw new ApiError(400, "Booking ID is required");
    }

    const booking = await prisma.booking.findUnique({
        where: {id: bookingId},
        include: {roomType: true}
    });

    if(!booking){
        throw new ApiError(404, "Booking not found");
    }

    // Cannot cancel completed bookings
    if(["CHECKED_OUT", "CANCELLED"].includes(booking.status)){
        throw new ApiError(400, `Cannot cancel a ${booking.status.toLowerCase()} booking`);
    }

    // Check-in already started
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if(booking.checkIn <= today){
        throw new ApiError(400, "Cannot cancel booking after check-in has started");
    }

    // Cancel in transaction
    const cancelledBooking = await prisma.$transaction(async(tx) => {
        // Increment inventory back
        const inventoryRecords = await tx.roomInventory.findMany({
            where: {
                roomTypeId: booking.roomTypeId,
                date: {gte: booking.checkIn, lt: booking.checkOut}
            }
        });

        for(const inventory of inventoryRecords){
            await tx.roomInventory.update({
                where: {id: inventory.id},
                data: {availableCount: {increment: 1}}
            });
        }

        // Update booking status
        return await tx.booking.update({
            where: {id: bookingId},
            data: {status: "CANCELLED"},
            include: {
                guest: true,
                roomType: true,
                payment: true
            }
        });
    });

    return res.status(200).json(
        new ApiResponse(200, cancelledBooking, "Booking cancelled successfully")
    );
});

//Confirm booking (after payment success)
const confirmBooking = asyncHandler(async(req, res) => {
    const {bookingId} = req.body;

    if(!bookingId){
        throw new ApiError(400, "Booking ID is required");
    }

    const booking = await prisma.booking.findUnique({
        where: {id: bookingId},
        include: {payment: true, roomType: true}
    });

    if(!booking){
        throw new ApiError(404, "Booking not found");
    }

    if(booking.status !== "PENDING"){
        throw new ApiError(400, `Booking is already ${booking.status.toLowerCase()}`);
    }

    // Verify payment is successful
    if(!booking.payment || booking.payment.status !== "SUCCESS"){
        throw new ApiError(400, "Payment must be successful before confirming booking");
    }

    // Update booking status
    const confirmedBooking = await prisma.booking.update({
        where: {id: bookingId},
        data: {status: "CONFIRMED"},
        include: {
            guest: true,
            roomType: true,
            roomUnit: true,
            payment: true
        }
    });

    return res.status(200).json(
        new ApiResponse(200, confirmedBooking, "Booking confirmed successfully")
    );
});

//Check-in booking Assign room unit if not already assigned
const checkInBooking = asyncHandler(async(req, res) => {
    const {bookingId, roomUnitId} = req.body;

    if(!bookingId){
        throw new ApiError(400, "Booking ID is required");
    }

    const booking = await prisma.booking.findUnique({
        where: {id: bookingId},
        include: {roomType: true, roomUnit: true}
    });

    if(!booking){
        throw new ApiError(404, "Booking not found");
    }

    if(booking.status !== "CONFIRMED"){
        throw new ApiError(400, `Cannot check in a ${booking.status.toLowerCase()} booking`);
    }

    // Verify check-in is today or later
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if(booking.checkIn > today){
        throw new ApiError(400, "Cannot check in before check-in date");
    }

    // Assign room unit if provided
    let updateData = {status: "CHECKED_IN"};

    if(roomUnitId){
        // Verify room unit exists and belongs to correct room type
        const roomUnit = await prisma.roomUnit.findFirst({
            where: {
                id: roomUnitId,
                roomTypeId: booking.roomTypeId,
                status: "AVAILABLE"
            }
        });

        if(!roomUnit){
            throw new ApiError(404, "Room unit not available for assignment");
        }

        updateData.roomUnitId = roomUnitId;

        // Update room unit status
        await prisma.roomUnit.update({
            where: {id: roomUnitId},
            data: {status: "OCCUPIED"}
        });
    }

    const checkedInBooking = await prisma.booking.update({
        where: {id: bookingId},
        data: updateData,
        include: {
            guest: true,
            roomType: true,
            roomUnit: true
        }
    });

    return res.status(200).json(
        new ApiResponse(200, checkedInBooking, "Check-in completed successfully")
    );
});

// Check-out booking
const checkOutBooking = asyncHandler(async(req, res) => {
    const {bookingId} = req.body;

    if(!bookingId){
        throw new ApiError(400, "Booking ID is required");
    }

    const booking = await prisma.booking.findUnique({
        where: {id: bookingId},
        include: {roomUnit: true}
    });

    if(!booking){
        throw new ApiError(404, "Booking not found");
    }

    if(booking.status !== "CHECKED_IN"){
        throw new ApiError(400, `Booking cannot be checked out from ${booking.status.toLowerCase()} status`);
    }

    // Update in transaction
    const checkedOutBooking = await prisma.$transaction(async(tx) => {
        // Mark room as dirty if unit assigned
        if(booking.roomUnitId){
            await tx.roomUnit.update({
                where: {id: booking.roomUnitId},
                data: {status: "DIRTY"}
            });
        }

        // Mark booking as checked out
        return await tx.booking.update({
            where: {id: bookingId},
            data: {status: "CHECKED_OUT"},
            include: {
                guest: true,
                roomType: true,
                roomUnit: true
            }
        });
    });

    return res.status(200).json(
        new ApiResponse(200, checkedOutBooking, "Check-out completed successfully")
    );
});

// Get all bookings (admin/staff) With filters for status, date range, room type
const getAllBookings = asyncHandler(async(req, res) => {
    let {
        page = 1,
        limit = 20,
        status,
        startDate,
        endDate,
        roomTypeId,
        guestId
    } = req.query;

    page = Math.max(1, parseInt(page) || 1);
    limit = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const skip = (page - 1) * limit;

    // Build where clause
    let whereClause = {deletedAt: null};

    if(status){
        const validStatuses = ["PENDING", "CONFIRMED", "CANCELLED", "CHECKED_IN", "CHECKED_OUT"];
        if(!validStatuses.includes(status.toUpperCase())){
            throw new ApiError(400, `Invalid status. Must be one of: ${validStatuses.join(', ')}`);
        }
        whereClause.status = status.toUpperCase();
    }

    if(startDate && endDate){
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        if(isNaN(start.getTime()) || isNaN(end.getTime())){
            throw new ApiError(400, "Invalid date format");
        }

        whereClause.checkIn = {gte: start};
        whereClause.checkOut = {lte: end};
    }

    if(roomTypeId){
        whereClause.roomTypeId = roomTypeId;
    }

    if(guestId){
        whereClause.guestId = guestId;
    }

    const [bookings, totalCount] = await prisma.$transaction([
        prisma.booking.findMany({
            where: whereClause,
            skip,
            take: limit,
            orderBy: {createdAt: 'desc'},
            include: {
                guest: {select: {firstName: true, lastName: true, phone: true}},
                roomType: {select: {name: true}},
                roomUnit: {select: {roomNumber: true}},
                payment: {select: {status: true}},
                review: {select: {rating: true}}
            }
        }),
        prisma.booking.count({where: whereClause})
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    return res.status(200).json(
        new ApiResponse(200, {
            bookings,
            pagination: {
                total: totalCount,
                page,
                limit,
                totalPages
            }
        }, "Bookings retrieved successfully")
    );
});

//Update booking details (limited to PENDING status)
const updateBooking = asyncHandler(async(req, res) => {
    const {bookingId, checkIn, checkOut, specialRequests, roomTypeId} = req.body;

    if(!bookingId){
        throw new ApiError(400, "Booking ID is required");
    }

    const booking = await prisma.booking.findUnique({
        where: {id: bookingId}
    });

    if(!booking){
        throw new ApiError(404, "Booking not found");
    }

    // Only allow updates for PENDING bookings
    if(booking.status !== "PENDING"){
        throw new ApiError(400, "Can only update pending bookings");
    }

    // Prepare update data
    let updateData = {};

    if(specialRequests){
        updateData.specialRequests = specialRequests.trim();
    }

    // If changing dates or room type, need to recalculate price and check availability
    if(checkIn || checkOut || roomTypeId){
        const newCheckIn = checkIn ? new Date(checkIn) : booking.checkIn;
        const newCheckOut = checkOut ? new Date(checkOut) : booking.checkOut;
        const newRoomTypeId = roomTypeId || booking.roomTypeId;

        // Validate new dates
        const {start, end} = validateBookingDates(newCheckIn, newCheckOut);

        // Check availability for new dates
        await checkRoomAvailability(newRoomTypeId, start, end);

        // Calculate new price
        const newPricing = await calculateBookingPrice(newRoomTypeId, start, end);

        updateData.checkIn = start;
        updateData.checkOut = end;
        updateData.roomTypeId = newRoomTypeId;
        updateData.totalPrice = newPricing.totalPrice;
    }

    const updatedBooking = await prisma.booking.update({
        where: {id: bookingId},
        data: updateData,
        include: {
            guest: true,
            roomType: true,
            payment: true
        }
    });

    return res.status(200).json(
        new ApiResponse(200, updatedBooking, "Booking updated successfully")
    );
});

// Get booking analytics
const getBookingAnalytics = asyncHandler(async(req, res) => {
    const {startDate, endDate} = req.body;

    const start = startDate ? new Date(startDate) : new Date(new Date().setDate(new Date().getDate() - 30));
    const end = endDate ? new Date(endDate) : new Date();

    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    const bookings = await prisma.booking.findMany({
        where: {
            checkIn: {gte: start, lte: end},
            status: {in: ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"]}
        },
        include: {
            roomType: true,
            payment: true
        }
    });

    const totalBookings = bookings.length;
    const totalRevenue = bookings.reduce((sum, b) => sum + parseFloat(b.totalPrice), 0);

    // Group by status
    const statusBreakdown = {
        confirmed: 0,
        checkedIn: 0,
        checkedOut: 0
    };

    bookings.forEach(booking => {
        if(booking.status === "CONFIRMED") statusBreakdown.confirmed++;
        if(booking.status === "CHECKED_IN") statusBreakdown.checkedIn++;
        if(booking.status === "CHECKED_OUT") statusBreakdown.checkedOut++;
    });

    return res.status(200).json(
        new ApiResponse(200, {
            period: {from: start.toISOString().split('T')[0], to: end.toISOString().split('T')[0]},
            totalBookings,
            totalRevenue: parseFloat(totalRevenue.toFixed(2)),
            avgRevenuePerBooking: parseFloat((totalRevenue / totalBookings).toFixed(2)),
            statusBreakdown
        }, "Booking analytics retrieved successfully")
    );
});

export {
    createBooking,
    getBooking,
    getBookingByReference,
    getGuestBookings,
    getAllBookings,
    confirmBooking,
    cancelBooking,
    checkInBooking,
    checkOutBooking,
    updateBooking,
    getBookingAnalytics
};