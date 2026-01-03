import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { prisma } from "../db/db.config.js";


// Create a new amenity category for a room type
const createAmenityCategory = asyncHandler(async(req, res) => {
    const {roomTypeId, categoryName} = req.body;

    // Validation
    if(!roomTypeId || !categoryName){
        throw new ApiError(400, "Room Type ID and Category Name are required");
    }

    if(categoryName.trim().length < 2){
        throw new ApiError(400, "Category name must be at least 2 characters long");
    }

    if(categoryName.trim().length > 50){
        throw new ApiError(400, "Category name cannot exceed 50 characters");
    }

    // Verify room type exists
    const roomType = await prisma.roomType.findFirst({
        where: {id: roomTypeId, deletedAt: null}
    });

    if(!roomType){
        throw new ApiError(404, "Room type not found or already deleted");
    }

    // Check for duplicate category name within this room type
    const existingCategory = await prisma.amenityCategory.findFirst({
        where: {
            roomTypeId,
            categoryName: {
                equals: categoryName.trim(),
                mode: 'insensitive'
            }
        }
    });

    if(existingCategory){
        throw new ApiError(409, `Category "${categoryName}" already exists for this room type`);
    }

    // Create category
    const category = await prisma.amenityCategory.create({
        data: {
            roomTypeId,
            categoryName: categoryName.trim()
        },
        include: {
            items: true
        }
    });

    return res.status(201).json(
        new ApiResponse(201, category, "Amenity category created successfully")
    );
});

// Get all amenity categories for a specific room type
const getAllCategories = asyncHandler(async(req, res) => {
    const {roomTypeId} = req.params;
    let {page = 1, limit = 10} = req.query;

    // Validation
    if(!roomTypeId){
        throw new ApiError(400, "Room Type ID is required");
    }

    page = Math.max(1, parseInt(page) || 1);
    limit = Math.min(100, Math.max(1, parseInt(limit) || 10));
    const skip = (page - 1) * limit;

    // Verify room type exists
    const roomType = await prisma.roomType.findFirst({
        where: {id: roomTypeId, deletedAt: null}
    });

    if(!roomType){
        throw new ApiError(404, "Room type not found");
    }

    // Fetch categories with items
    const [categories, totalCount] = await prisma.$transaction([
        prisma.amenityCategory.findMany({
            where: {roomTypeId},
            skip,
            take: limit,
            orderBy: {id: 'asc'},
            include: {
                items: {
                    orderBy: {id: 'asc'}
                },
                _count: {
                    select: {items: true}
                }
            }
        }),
        prisma.amenityCategory.count({
            where: {roomTypeId}
        })
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    return res.status(200).json(
        new ApiResponse(200, {
            roomTypeId,
            categories,
            pagination: {
                total: totalCount,
                page,
                limit,
                totalPages
            }
        }, "Amenity categories fetched successfully")
    );
});

// Update an amenity category name
const updateCategory = asyncHandler(async(req, res) => {
    const {categoryId, categoryName} = req.body;

    // Validation
    if(!categoryId || !categoryName){
        throw new ApiError(400, "Category ID and Category Name are required");
    }

    if(categoryName.trim().length < 2){
        throw new ApiError(400, "Category name must be at least 2 characters long");
    }

    if(categoryName.trim().length > 50){
        throw new ApiError(400, "Category name cannot exceed 50 characters");
    }

    // Verify category exists
    const category = await prisma.amenityCategory.findUnique({
        where: {id: categoryId}
    });

    if(!category){
        throw new ApiError(404, "Amenity category not found");
    }

    // Check for duplicate name in same room type
    if(categoryName.trim() !== category.categoryName){
        const duplicate = await prisma.amenityCategory.findFirst({
            where: {
                roomTypeId: category.roomTypeId,
                categoryName: {
                    equals: categoryName.trim(),
                    mode: 'insensitive'
                },
                id: {not: categoryId}
            }
        });

        if(duplicate){
            throw new ApiError(409, `Category "${categoryName}" already exists for this room type`);
        }
    }

    // Update category
    const updatedCategory = await prisma.amenityCategory.update({
        where: {id: categoryId},
        data: {categoryName: categoryName.trim()},
        include: {
            items: true,
            _count: {select: {items: true}}
        }
    });

    return res.status(200).json(
        new ApiResponse(200, updatedCategory, "Amenity category updated successfully")
    );
});

// Delete an amenity category and all its items
const deleteCategory = asyncHandler(async(req, res) => {
    const {categoryId} = req.body;

    // Validation
    if(!categoryId){
        throw new ApiError(400, "Category ID is required");
    }

    // Verify category exists
    const category = await prisma.amenityCategory.findUnique({
        where: {id: categoryId},
        include: {
            items: true,
            roomType: {
                select: {id: true, name: true}
            }
        }
    });

    if(!category){
        throw new ApiError(404, "Amenity category not found");
    }

    // Delete category and cascade delete items
    const deletedCategory = await prisma.amenityCategory.delete({
        where: {id: categoryId}
    });

    return res.status(200).json(
        new ApiResponse(200, {
            categoryId: deletedCategory.id,
            categoryName: deletedCategory.categoryName,
            itemsDeleted: category.items.length
        }, "Amenity category deleted successfully")
    );
});

// Create a new amenity item within a category
const createAmenityItem = asyncHandler(async(req, res) => {
    const {categoryId, itemName, icon} = req.body;

    // Validation
    if(!categoryId || !itemName){
        throw new ApiError(400, "Category ID and Item Name are required");
    }

    if(itemName.trim().length < 2){
        throw new ApiError(400, "Item name must be at least 2 characters long");
    }

    if(itemName.trim().length > 50){
        throw new ApiError(400, "Item name cannot exceed 50 characters");
    }

    if(icon && icon.trim().length > 100){
        throw new ApiError(400, "Icon cannot exceed 100 characters");
    }

    // Verify category exists
    const category = await prisma.amenityCategory.findUnique({
        where: {id: categoryId}
    });

    if(!category){
        throw new ApiError(404, "Amenity category not found");
    }

    // Check for duplicate item name within this category
    const existingItem = await prisma.amenityItem.findFirst({
        where: {
            categoryId,
            itemName: {
                equals: itemName.trim(),
                mode: 'insensitive'
            }
        }
    });

    if(existingItem){
        throw new ApiError(409, `Item "${itemName}" already exists in this category`);
    }

    // Create item
    const item = await prisma.amenityItem.create({
        data: {
            categoryId,
            itemName: itemName.trim(),
            icon: icon ? icon.trim() : null
        },
        include: {
            category: {
                select: {id: true, categoryName: true, roomTypeId: true}
            }
        }
    });

    return res.status(201).json(
        new ApiResponse(201, item, "Amenity item created successfully")
    );
});

// Update an amenity item's name and/or icon
const updateAmenityItem = asyncHandler(async(req, res) => {
    const {itemId, itemName, icon} = req.body;

    // Validation
    if(!itemId){
        throw new ApiError(400, "Item ID is required");
    }

    if(!itemName && !icon){
        throw new ApiError(400, "At least one of itemName or icon must be provided");
    }

    if(itemName && itemName.trim().length < 2){
        throw new ApiError(400, "Item name must be at least 2 characters long");
    }

    if(itemName && itemName.trim().length > 50){
        throw new ApiError(400, "Item name cannot exceed 50 characters");
    }

    if(icon && icon.trim().length > 100){
        throw new ApiError(400, "Icon cannot exceed 100 characters");
    }

    // Verify item exists
    const existingItem = await prisma.amenityItem.findUnique({
        where: {id: itemId},
        include: {category: true}
    });

    if(!existingItem){
        throw new ApiError(404, "Amenity item not found");
    }

    // Check for duplicate name if updating name
    if(itemName && itemName.trim() !== existingItem.itemName){
        const duplicate = await prisma.amenityItem.findFirst({
            where: {
                categoryId: existingItem.categoryId,
                itemName: {
                    equals: itemName.trim(),
                    mode: 'insensitive'
                },
                id: {not: itemId}
            }
        });

        if(duplicate){
            throw new ApiError(409, `Item "${itemName}" already exists in this category`);
        }
    }

    // Prepare update data
    const updateData = {};
    if(itemName && itemName.trim() !== existingItem.itemName){
        updateData.itemName = itemName.trim();
    }
    if(icon !== undefined){
        updateData.icon = icon ? icon.trim() : null;
    }

    // Update item
    const updatedItem = await prisma.amenityItem.update({
        where: {id: itemId},
        data: updateData,
        include: {
            category: {
                select: {id: true, categoryName: true, roomTypeId: true}
            }
        }
    });

    return res.status(200).json(
        new ApiResponse(200, updatedItem, "Amenity item updated successfully")
    );
});


//   Delete an amenity item
const deleteAmenityItem = asyncHandler(async(req, res) => {
    const {itemId} = req.body;

    // Validation
    if(!itemId){
        throw new ApiError(400, "Item ID is required");
    }

    // Verify item exists
    const item = await prisma.amenityItem.findUnique({
        where: {id: itemId},
        include: {
            category: {
                select: {id: true, categoryName: true}
            }
        }
    });

    if(!item){
        throw new ApiError(404, "Amenity item not found");
    }

    // Delete item
    const deletedItem = await prisma.amenityItem.delete({
        where: {id: itemId}
    });

    return res.status(200).json(
        new ApiResponse(200, {
            itemId: deletedItem.id,
            itemName: deletedItem.itemName,
            categoryId: item.category.id
        }, "Amenity item deleted successfully")
    );
});



export {
    createAmenityCategory,
    getAllCategories,
    updateCategory,
    deleteCategory,
    createAmenityItem,
    updateAmenityItem,
    deleteAmenityItem,
};
