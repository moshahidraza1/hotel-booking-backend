import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { prisma } from "../db/db.config.js";
import slug from "slug";

// function to generate unique slug
const generateUniqueSlug = async(baseName) => {
    let baseSlug = slug(baseName, {lower: true, strict: true});
    let finalSlug = baseSlug;
    let counter = 1;
    const maxAttempts = 100

    // check if slug already exists
    while(counter<maxAttempts && await prisma.roomType.findUnique({
        where: {slug: finalSlug}
    })){
        finalSlug = `${baseSlug}-${counter}`;
        counter++;
    }
    if(counter>=maxAttempts){
        throw new Error("Could not generate unique slug please choose a different name for your room type")
    }
    return finalSlug;
}

// create room type
const createRoomType = asyncHandler(async(req, res) => {
    const {name, description, basePrice, capacity, size, view} = req.body;

    if(!name){
        throw new ApiError(400, "Room type name is required");
    }

    // Check if a room type with this name already exists
    const existingRoomType = await prisma.roomType.findUnique({
        where: {
            name: name,
            deletedAt: null  
        }
    });

    if (existingRoomType) {
        throw new ApiError(409, "A room type with this name already exists");
    }

    if(!description){
        throw new ApiError(400, "Description is required");
    }
    if(basePrice <= 0){
        throw new ApiError(400, "Base price must be greater than 0");
    }
    if(capacity < 1){
        throw new ApiError(400, "Capacity must be atleast 1");
    }

    // generate unique slug
    const generatedSlug = await generateUniqueSlug(name);

    // create room type
    const roomType = await prisma.roomType.create({
        data: {
            name: name,
            slug: generatedSlug,
            description: description,
            basePrice: basePrice,
            capacity: capacity,
            size: size || null,
            view: view || null
        }
    });

    return res.status(201).json( new ApiResponse(201, roomType, "Room type created successfully"))
});

// get room type
const getRoomType = asyncHandler(async(req, res) => {
    const {roomId} = req.params;

    // check if room Type exists
    const roomType = await prisma.roomType.findUnique({
        where:{id: roomId, deletedAt:null},
        include: {
            images:{
                take: 1,
                orderBy: {order: 'asc'}
            }
        }
    });
    if (!roomType){
        throw new ApiError(404, "Room type not found")
    }
    return res.status(200).json(
        new ApiResponse(200, roomType, "Room data fetched successfully")
    );
});

// get all room types
const getAllRoomType = asyncHandler(async(req, res)=>{
    let {page = 1, limit = 10} = req.query;
    page = Math.max(1, parseInt(page) || 1);
    limit = Math.min(100, Math.max(1, parseInt(limit) || 10));
    const skip = (page-1)* limit;
    const [rooms, totalRooms] = await prisma.$transaction([
        prisma.roomType.findMany({
            where: {deletedAt: null},
            skip:skip,
            take:limit,
            orderBy: {createdAt: 'desc'},
            include:{
                images:{
                    take: 1,
                    orderBy: {order: 'asc'}
                },
                _count: {
                    select:{units: true}
                }
            }
        }),
        prisma.roomType.count({
            where: {deletedAt: null}
        })
    ]);

    const totalPages = Math.ceil(totalRooms/limit);

    return res.status(200).json(
        new ApiResponse(200, {
            rooms,
            pagination:{
                total: totalRooms,
                page,
                limit,
                totalPages
            }
            }, "Successfully fetched all rooms data" )
    );
});
// update room type
const updateRoomType = asyncHandler(async(req,res) => {
    const {roomId, name, description, basePrice, capacity, size, view} = req.body;

    if(!roomId){
        throw new ApiError(400, "Room id is required");
    }
    const roomType = await prisma.roomType.findUnique({
        where: {id: roomId}
    });
    if(!roomType || roomType.deletedAt){
        throw new ApiError(404, `Room with id: ${roomId} not found`);
    }

    let generatedSlug = roomType.slug;
    if(name && name !== roomType.name){ generatedSlug = await generateUniqueSlug(name);
    }

    const data = {};
    if(name && name!== roomType.name){
        data.name = name;
        data.slug = generatedSlug;
    }
    if(description && description!==roomType.description){data.description = description}
    if(basePrice && basePrice!==roomType.basePrice){data.basePrice = basePrice}
    if(capacity && capacity > 0 &&capacity!==roomType.capacity){data.capacity = capacity}
    if(size && roomType.size!==size){data.size = size}
    if(view && roomType.view!==view){data.view = view}
    

    const updatedRoomType = await prisma.roomType.update({
        where: {id: roomId},
        data
    });

    return res.status(200).json(
        new ApiResponse(200, updatedRoomType, "Room Type successfully updated")
    )


});

// delete room type
const softDeleteRoomType = asyncHandler(async(req, res)=> {
    const {roomId} = req.body;
    if(!roomId){
        throw new ApiError(400, "Room Id is required");
    }
    const roomType = await prisma.roomType.findUnique({
        where: {id: roomId},
        include: {units:true}
    });

    if(!roomType){
        throw new ApiError(404, `Room with id:${roomId} not found for deletion`);
    }
    if(roomType.deletedAt){
        throw new ApiError(404, "Room type already deleted")
    }

    // prevent deletion if room has active bookings
    const activeBookings = await prisma.booking.count({
        where:{
            roomTypeId: roomId,
            status: {in: ["PENDING", "CONFIRMED", "CHECKED_IN"]}
        }
    });

    if(activeBookings > 0){
        throw new ApiError(400, `Cannot delete room type with ${activeBookings} active booking(s)`);
    }

    await prisma.roomType.update({
        where: {id: roomId},
        data: {deletedAt: new Date.now()}
    });

    return res.status(200).json(
        new ApiResponse(200, "Successfully deleted Room Type")
    );
});

// get room type with details (images, ammenities and units)
const getRoomTypeWithDetails = asyncHandler(async(req, res) => {
    const {roomId} = req.params;

    if(!roomId){
        throw new ApiError(400, "Room ID is required");
    }

    const roomType = await prisma.roomType.findUnique({
        where:{id: roomId},
        include:{
            images: {
                orderBy: {order: 'asc'}
            },
            ammenityCategories:{
                include:{
                    items: true
                }
            },
            units: {
                select:{
                    id:true,
                    roomNumber: true,
                    floor: true,
                    status:true
                }
            },
            inventory:{
                where:{
                    date:{
                        gte: new Date()
                    }
                },
                orderBy: {date: 'asc'}
            },
            dailyRates: {
                where: {
                    date: {
                        gte: new Date()
                    }
                },
                orderBy: {date: 'asc'},
                take: 30
            }
        }
    });

    if(!roomType || roomType.deletedAt){
        throw new ApiError(404, "Room type not found");
    }

    const transformedRoomType = {
        ...roomType,
        images: roomType.images || [],
        ammenityCategories: (roomType.ammenityCategories || []).map(cat => ({
            ...cat,
            items: cat.items || []
        })),
        units: roomType.units || [],
        inventory: roomType.inventory || [],
        dailyRates: roomType.dailyRates || [],
        
    }

    return res.status(200).json(
        new ApiResponse(200, {roomType: transformedRoomType}, "Room details fetched successfully")
    )
});

export {
    createRoomType,
    getRoomType,
    getAllRoomType,
    getRoomTypeWithDetails,
    updateRoomType,
    softDeleteRoomType
};
