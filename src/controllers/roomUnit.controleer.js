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
    let {page = 1, limit = 10} = req.query;
    page = Math.max(1, parseInt(page) || 1);
    limit = Math.min(100, Math.max(parseInt(limit)) || 10);
    const skip = (page-1) * limit;
    const [roomUnits, totalRoomUnits] = await prisma.$transaction([
         prisma.roomUnit.findMany({
            where: {
                roomType: {
                    deletedAt: null
                }
            },
            skip: skip,
            take: limit,
            
        }),
         prisma.roomUnit.count({
            where: {
                roomType: {
                    deletedAt: null
                }
            }
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

    const user = await prisma.user.findFirst({
        where: {id: req.user.id, role: {name: {in: ['ADMIN', 'STAFF']}}}
    });

    if(!user){
        throw new ApiError(400, "Only Admin and Staff are allowed to update room unit status");
    }

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

    const user = await prisma.user.findFirst({
        where: {id: req.user.id, role: {name: {in: ['ADMIN', 'STAFF']}}}
    });
    if(!user){
        throw new ApiError(400, "Only Admin and Staff are allowed");
    }
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

export {
    createRoomUnit,
    getRoomUnit,
    getAllRoomUnits,
    updateRoomUnitStatus,
    bulkUpdateStatus,
    deleteRoomUnit,
    getRoomUnitHistory
}
