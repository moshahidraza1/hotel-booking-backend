import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { prisma } from "../db/db.config.js";

// Add individual room unit (roomNumber, floor)
const createRoomUnit = asyncHandler(async(req, res) => {
    const {roomTypeId, roomNumber, floor, status} = req.body;

    if(!roomTypeId){
        throw new ApiError(400, "Room Type ID is required");
    }
    if(!roomNumber){
        throw new ApiError(400, "Room number is required");
    }

    const roomType = await prisma.roomType.findFirst({
        where: {id: roomTypeId, deletedAt: null}
    });

    if(!roomType){
        throw new ApiError(404, "Room type not found OR room type already deleted");
    }
    const roomUnit = await prisma.roomUnit.findFirst({
        where:{roomTypeId, roomNumber}
    });
    if(roomUnit){
        throw new ApiError(409, "Room Unit with roomNumber already exists");
    }

    const createdRoomUnit = await prisma.roomUnit.create({
        data:{
            roomTypeId,
            roomNumber,
            floor,
            status 
        }
    });

    return res.status(201).json(
        new ApiResponse(201, createdRoomUnit, "Room unit created successfully")
    );
});

// Get single unit with current status
const getRoomUnit = asyncHandler(async(req, res) => {
    const {roomUnitId} = req.params;
    if(!roomUnitId){
        throw new ApiError(400, "Room unit Id is required");
    }
    const roomUnit = await prisma.roomUnit.findUnique({
        where:{id: roomUnitId}
    });
    if(!roomUnit){
        throw new ApiError(404, "Room unit not found");
    }
    const roomType =  await prisma.roomType.findUnique({
        where:{id:roomUnit.roomTypeId}
    });
    if(!roomType || roomType.deletedAt){
        throw new ApiError(404, " Room Type for mentioned room unit is deleted or does not exists");
    }
    return res.status(200).json(
        new ApiResponse(200, roomUnit, "Room Unit fetched successfully")
    );
});

// List units by roomType (with status filter)
const getAllRoomUnits = asyncHandler(async(req, res) => {
    let {page = 1, limit = 10, roomTypeId, status, floor, search} = req.query;
    page = Math.max(1, parseInt(page) || 1);
    limit = Math.min(100, Math.max(1, parseInt(limit)) || 10);
    const skip = (page-1) * limit;
    const where = {
        roomType: { deletedAt: null },
        ...(roomTypeId && { roomTypeId }),
        ...(status && { status }),
        ...(floor !== undefined && { floor }),
        ...(search && { roomNumber: { contains: search, mode: "insensitive" } }),
    };
    const [roomUnits, totalRoomUnits] = await prisma.$transaction([
         prisma.roomUnit.findMany({
            where,
            skip: skip,
            take: limit,
            
        }),
         prisma.roomUnit.count({
            where
         })
    ]);

    if(!roomUnits){
        throw new ApiError(404, "No room units found");
    }
    const totalPages = Math.ceil(totalRoomUnits/limit);

    return res.status(200).json(
        new ApiResponse(200, {
            roomUnits,
            pagination : {
                total: totalRoomUnits,
                page,
                totalPages,
                limit
            }
        }, "Room units fetched succesfully")
    );

});

// Change status (AVAILABLE → DIRTY → MAINTENANCE → OCCUPIED)
const updateRoomUnitStatus = asyncHandler(async(req, res) => {
    const {roomUnitId, status, reason} = req.body;

    if(!roomUnitId || !status){
        throw new ApiError(400, "Room unit id and status required");
    }
    const roomUnit = await prisma.roomUnit.findFirst({
        where: {
            id: roomUnitId,
            roomType:{
                deletedAt: null
            }
        }
    });

    if(!roomUnit){
        throw new ApiError(404, "No room unit found to update status");
    }
    const statusUpper = status.toUpperCase();

    if(roomUnit.status === statusUpper){
        throw new ApiError(400, `Room Unit's ${roomUnit.roomNumber}'s status already marked as ${roomUnit.status}`);
    }

    const validStatus = ['AVAILABLE', 'DIRTY', 'MAINTENANCE', 'OCCUPIED'];

    if(!validStatus.includes(statusUpper)){
        throw new ApiError(400, `Invalid status. Must be one of: ${validStatus.join(', ')}`)
    }

    const [updatedRoomUnit] = await prisma.$transaction([
        prisma.roomUnit.update({
            where: {id: roomUnitId},
            data: {status: statusUpper}
        }),
        prisma.roomUnitHistory.create({
            data: {
                roomUnitId,
                oldStatus: roomUnit.status,
                newStatus: statusUpper,
                changedBy: req.user.id,
                reason
            }
        })
    ]);

    return res.status(200).json(
        new ApiResponse(200, updatedRoomUnit, "Room unit's status updated")
    );

});

// Update multiple units at once
const bulkUpdateStatus = asyncHandler(async(req, res) => {
    const {roomUnitIds, status, reason} = req.body;

    if(!roomUnitIds || !status){
        throw new ApiError(400, "Room Unit Ids and status are required");
    }
    if(!Array.isArray(roomUnitIds) || roomUnitIds.length===0){
        throw new ApiError(400, "Room Unit Ids should be a non empty array");
    }
    const normalizedIds = [...new Set(roomUnitIds.map(id => 
        typeof id === 'string' ? id : id.roomUnitId
    ))];
    const statusUpper = status.toUpperCase();

    const validStatus = ['AVAILABLE', 'DIRTY', 'MAINTENANCE', 'OCCUPIED'];

    if(!validStatus.includes(statusUpper)){
        throw new ApiError(400, `Invalid status. Must be one of: ${validStatus.join(', ')}`)
    }

    const result = await prisma.$transaction(async (tx) => {
        // Get current status of all units
        const units = await tx.roomUnit.findMany({
            where: {id: {in: normalizedIds}, roomType: {deletedAt: null}},
            select: {id: true, status: true}
        });

        if(units.length !== normalizedIds.length){
        const missingIds = normalizedIds.filter(id => !units.find(u => u.id === id));
        throw new ApiError(404, `Room units not found: ${missingIds.join(', ')}`);
        }

        // Update status
        await tx.roomUnit.updateMany({
            where: {id: {in: normalizedIds}},
            data: {status: statusUpper}
        });

        // Create history for each unit
        await tx.roomUnitHistory.createMany({
            data: units.map(unit => ({
                roomUnitId: unit.id,
                oldStatus: unit.status,
                newStatus: statusUpper,
                changedBy: req.user.id,
                reason: reason || 'Bulk status update'
            }))
        });
    });
    

return res.status(200).json(
    new ApiResponse(200, {updatedCount: normalizedIds.length }, "Room units status updated successfully")
);

});

// Delete unit
const deleteRoomUnit = asyncHandler(async(req, res) => {
    const {roomUnitId} = req.params;

    if(!roomUnitId){
        throw new ApiError(400, "Room Unit Id is required");
    }
    const roomUnit = await prisma.roomUnit.findFirst({
        where: {id: roomUnitId, roomType:{deletedAt:null}}
    });
    
    if(!roomUnit){
        throw new ApiError(404, "Room unit does not exists or already deleted");
    }

    const active = await prisma.booking.count({
        where: { roomUnitId, status: { in: ["PENDING","CONFIRMED","CHECKED_IN"] } }
    });
    if (active > 0) throw new ApiError(400, "Cannot delete unit with active bookings");
    
    await prisma.roomUnit.delete({
        where: {id: roomUnitId}
    });

    return res.status(200).json(
        new ApiResponse(200, "Successfully deleted room unit")
    )

});

// Get status change history (audit trail)
const getRoomUnitHistory = asyncHandler(async(req, res) => {
    const {roomUnitId} = req.params;
    let {page = 1, limit = 20} = req.query;

    if(!roomUnitId){
        throw new ApiError(400, "Room unit Id is required");
    }
    
    page = Math.max(1, parseInt(page) || 1);
    limit = Math.min(100, Math.max(parseInt(limit)) || 20);
    const skip = (page-1) * limit;
    
    // Verify room unit exists
    const roomUnit = await prisma.roomUnit.findFirst({
        where: {id: roomUnitId, roomType:{deletedAt: null}}
    });

    if(!roomUnit){
        throw new ApiError(404, "Room unit not found or deleted");
    }

    const [history, totalRecords] = await prisma.$transaction([
        prisma.roomUnitHistory.findMany({
            where: {roomUnitId},
            include: {
                changedByUser: true
            },
            skip,
            take: limit,
            orderBy: {createdAt: 'desc'}
        }),
        prisma.roomUnitHistory.count({
            where: {roomUnitId}
        })
    ]);

    const totalPages = Math.ceil(totalRecords / limit);
    
    return res.status(200).json(
        new ApiResponse(200, {
            roomUnitId,
            history,
            pagination: {
                total: totalRecords,
                page,
                totalPages,
                limit
            }
        }, "Room unit history fetched successfully")
    );
    
});

// Get Available Room Units
const getAvailableRoomUnits = asyncHandler(async (req, res) => {
  const { roomTypeId, checkIn, checkOut, includeDirty } = req.query;

  // 1. Basic Validation
  if (!roomTypeId) throw new ApiError(400, "roomTypeId is required");
  if (!checkIn || !checkOut) throw new ApiError(400, "checkIn and checkOut are required");

  // Date Normalization - set Check-In to start of day and Check-Out to end of day to avoid timezone "ghost" overlaps
  const start = new Date(checkIn);
  start.setHours(0, 0, 0, 0); 
  
  const end = new Date(checkOut);
  end.setHours(23, 59, 59, 999);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new ApiError(400, "Invalid date format");
  }
  if (end <= start) {
    throw new ApiError(400, "checkOut must be after checkIn");
  }

  // Verify Room Type exists
  const roomType = await prisma.roomType.findFirst({
    where: { id: roomTypeId, deletedAt: null },
    select: { id: true, name: true },
  });

  if (!roomType) {
    throw new ApiError(404, "Room type not found");
  }

  // Logic for "Available"
  const allowedStatuses = includeDirty === "true"
    ? ["AVAILABLE", "DIRTY"]
    : ["AVAILABLE"];

  const activeBookingStatuses = ["PENDING", "CONFIRMED", "CHECKED_IN"];

  const availableUnits = await prisma.roomUnit.findMany({
    where: {
      roomTypeId,
      status: { in: allowedStatuses },
      bookings: {
        none: {
          status: { in: activeBookingStatuses },
          deletedAt: null,
          AND: [
            { checkIn: { lt: end } },
            { checkOut: { gt: start } },
          ],
        },
      },
    },
    orderBy: [{ floor: "asc" }, { roomNumber: "asc" }],
    select: {
      id: true,
      roomNumber: true,
      floor: true,
      status: true,
    },
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        roomType: { id: roomType.id, name: roomType.name },
        searchInterval: { checkIn: start, checkOut: end },
        count: availableUnits.length,
        availableUnits,
      },
      "Available room units fetched successfully"
    )
  );
});

// Assign Room Units to Booking
const assignRoomUnitToBooking = asyncHandler(async (req, res) => {
  const { bookingId, roomUnitId, reason, force } = req.body;

  if (!req.user?.id) throw new ApiError(401, "Authentication required");
  if (!bookingId || !roomUnitId) throw new ApiError(400, "bookingId and roomUnitId are required");

  const ACTIVE_BOOKING_STATUSES = ["PENDING", "CONFIRMED", "CHECKED_IN"];

  const result = await prisma.$transaction(async (tx) => {
    // Lock booking row to prevent concurrent assignment updates to same booking
    await tx.$queryRaw`
      SELECT id
      FROM bookings
      WHERE id = ${bookingId}
      FOR UPDATE
    `;

    // Lock room unit row to prevent concurrent assignment to same unit
    await tx.$queryRaw`
      SELECT id
      FROM room_units
      WHERE id = ${roomUnitId}
      FOR UPDATE
    `;

    const booking = await tx.booking.findFirst({
      where: { id: bookingId, deletedAt: null },
      select: {
        id: true,
        bookingReference: true,
        roomTypeId: true,
        roomUnitId: true,
        status: true,
        checkIn: true,
        checkOut: true,
      },
    });
    if (!booking) throw new ApiError(404, "Booking not found");

    if (!ACTIVE_BOOKING_STATUSES.includes(booking.status)) {
      throw new ApiError(400, `Cannot assign unit for booking status: ${booking.status}`);
    }

    const unit = await tx.roomUnit.findFirst({
      where: { id: roomUnitId, roomType: { deletedAt: null } },
      select: {
        id: true,
        roomTypeId: true,
        status: true,
        roomNumber: true,
      },
    });
    if (!unit) throw new ApiError(404, "Room unit not found");

    if (unit.roomTypeId !== booking.roomTypeId) {
      throw new ApiError(400, "Room unit does not belong to the same room type as the booking");
    }

    if (unit.status === "MAINTENANCE") {
      throw new ApiError(400, "Cannot assign a room unit under MAINTENANCE");
    }

    const isReassignment = Boolean(booking.roomUnitId && booking.roomUnitId !== roomUnitId);

    // Safety: prevent accidental overwrite unless force=true
    if (isReassignment && force !== true) {
      throw new ApiError(409, "Booking already has a room assigned. Use force=true to reassign.");
    }

    // Audit requirement for reassignment
    if (isReassignment && (!reason || reason.trim().length === 0)) {
      throw new ApiError(400, "reason is required when reassigning a room unit");
    }

    // If booking already assigned to same unit, no-op
    if (booking.roomUnitId === roomUnitId) {
      return {
        updatedBooking: booking,
        updatedUnit: null,
        note: "Booking already assigned to this room unit",
      };
    }

    // Overlap check
    const conflicting = await tx.booking.count({
      where: {
        id: { not: booking.id },
        roomUnitId: unit.id,
        deletedAt: null,
        status: { in: ACTIVE_BOOKING_STATUSES },
        AND: [
          { checkIn: { lt: booking.checkOut } },
          { checkOut: { gt: booking.checkIn } },
        ],
      },
    });

    if (conflicting > 0) {
      throw new ApiError(409, "Room unit is not available for the selected dates");
    }

    const updatedBooking = await tx.booking.update({
      where: { id: booking.id },
      data: { roomUnitId: unit.id },
      select: {
        id: true,
        bookingReference: true,
        status: true,
        roomTypeId: true,
        roomUnitId: true,
        checkIn: true,
        checkOut: true,
      },
    });

    // If CHECKED_IN, enforce physical status OCCUPIED
    let updatedUnit = null;
    if (updatedBooking.status === "CHECKED_IN" && unit.status !== "OCCUPIED") {
      updatedUnit = await tx.roomUnit.update({
        where: { id: unit.id },
        data: { status: "OCCUPIED" },
        select: { id: true, roomNumber: true, status: true },
      });

      // Room history logging
      if (tx.roomUnitHistory) {
        await tx.roomUnitHistory.create({
          data: {
            roomUnitId: unit.id,
            oldStatus: unit.status,
            newStatus: "OCCUPIED",
            changedBy: req.user.id,
            reason:
              reason ||
              `Assigned to booking ${updatedBooking.bookingReference} (CHECKED_IN)`,
          },
        });
      }
    }

    // Record reassignment in history even if status didn't change
    if (isReassignment && tx.roomUnitHistory) {
      await tx.roomUnitHistory.create({
        data: {
          roomUnitId: unit.id,
          oldStatus: unit.status,
          newStatus: unit.status,
          changedBy: req.user.id,
          reason: reason || `Room reassigned for booking ${updatedBooking.bookingReference}`,
        },
      });
    }

    if (isReassignment && booking.status === "CHECKED_IN") {

        // Set the old room to DIRTY
        await tx.roomUnit.update({
            where: { id: booking.roomUnitId },
            data: { status: "DIRTY" },
        });

        // Log why the old room is now dirty
        if (tx.roomUnitHistory) {
        await tx.roomUnitHistory.create({
            data: {
            roomUnitId: booking.roomUnitId,
            oldStatus: "OCCUPIED",
            newStatus: "DIRTY",
            changedBy: req.user.id,
            reason: `Guest moved to another room: ${reason}`,
            },
        });
        }
    }

    return { updatedBooking, updatedUnit };
  });

  return res
    .status(200)
    .json(new ApiResponse(200, result, "Room unit assigned to booking successfully"));
});

const unassignRoomUnitFromBooking = asyncHandler(async (req, res) => {
  const { bookingId, reason, markDirty } = req.body;

  if (!req.user?.id) throw new ApiError(401, "Authentication required");
  if (!bookingId) throw new ApiError(400, "bookingId is required");

  const result = await prisma.$transaction(async (tx) => {
    // Concurrency lock: prevent race with assign/check-in flows
    await tx.$queryRaw`
      SELECT id
      FROM bookings
      WHERE id = ${bookingId}
      FOR UPDATE
    `;

    const booking = await tx.booking.findFirst({
      where: { id: bookingId, deletedAt: null },
      select: {
        id: true,
        bookingReference: true,
        status: true,
        roomUnitId: true,
      },
    });

    if (!booking) throw new ApiError(404, "Booking not found");

    // Explicit status guards for clearer ops. behavior
    if (booking.status === "CHECKED_IN") {
      throw new ApiError(400, "Cannot unassign room unit from a CHECKED_IN booking");
    }
    if (booking.status === "CHECKED_OUT") {
      throw new ApiError(400, "Cannot unassign room unit from a CHECKED_OUT booking");
    }
    if (booking.status === "CANCELLED") {
      throw new ApiError(400, "Cannot unassign room unit from a CANCELLED booking");
    }

    if (!booking.roomUnitId) {
      throw new ApiError(400, "No room unit is assigned to this booking");
    }

    const unit = await tx.roomUnit.findFirst({
      where: { id: booking.roomUnitId, roomType: { deletedAt: null } },
      select: { id: true, roomNumber: true, status: true },
    });

    // If unit is deleted
    const updatedBooking = await tx.booking.update({
      where: { id: booking.id },
      data: { roomUnitId: null },
      select: {
        id: true,
        bookingReference: true,
        status: true,
        roomUnitId: true,
      },
    });

    // Operational safety: Default to marking DIRTY for CONFIRMED/PENDING unassigns unless explicitly overridden.
    
    const defaultMarkDirty = booking.status === "CONFIRMED" || booking.status === "PENDING";
    const shouldMarkDirty = typeof markDirty === "boolean" ? markDirty : defaultMarkDirty;

    let updatedUnit = null;

    if (unit && shouldMarkDirty && unit.status !== "DIRTY" && unit.status !== "MAINTENANCE") {
      updatedUnit = await tx.roomUnit.update({
        where: { id: unit.id },
        data: { status: "DIRTY" },
        select: { id: true, roomNumber: true, status: true },
      });

      // Room History log 
      if (tx.roomUnitHistory) {
        await tx.roomUnitHistory.create({
          data: {
            roomUnitId: unit.id,
            oldStatus: unit.status,
            newStatus: "DIRTY",
            changedBy: req.user.id,
            reason:
              reason ||
              `Unassigned from booking ${booking.bookingReference}; marked DIRTY for housekeeping`,
          },
        });
      }
    } else {
      // Even if no status change, log the unassignment for audit 
      if (unit && tx.roomUnitHistory) {
        await tx.roomUnitHistory.create({
          data: {
            roomUnitId: unit.id,
            oldStatus: unit.status,
            newStatus: unit.status,
            changedBy: req.user.id,
            reason: reason || `Unassigned from booking ${booking.bookingReference}`,
          },
        });
      }
    }

    return {
      updatedBooking,
      updatedUnit,
      unassignedFromUnitId: booking.roomUnitId,
    };
  });

  return res
    .status(200)
    .json(new ApiResponse(200, result, "Room unit unassigned from booking successfully"));
});


export {
    createRoomUnit,
    getRoomUnit,
    getAllRoomUnits,
    updateRoomUnitStatus,
    bulkUpdateStatus,
    deleteRoomUnit,
    getRoomUnitHistory,
    getAvailableRoomUnits,
    assignRoomUnitToBooking,
    unassignRoomUnitFromBooking
}