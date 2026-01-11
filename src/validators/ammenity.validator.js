import { z } from "zod";

const uuid = z.string().uuid("Invalid UUID format");

const categoryNameSchema = z
  .string()
  .trim()
  .min(2, "Category name must be at least 2 characters long")
  .max(50, "Category name cannot exceed 50 characters");

const itemNameSchema = z
  .string()
  .trim()
  .min(2, "Item name must be at least 2 characters long")
  .max(50, "Item name cannot exceed 50 characters");

const iconSchema = z.string().trim().max(100, "Icon cannot exceed 100 characters").optional();

export const createAmenityCategorySchema = z.object({
  body: z.object({
    roomTypeId: uuid,
    categoryName: categoryNameSchema,
  }),
});

export const getAllCategoriesSchema = z.object({
  params: z.object({
    roomTypeId: uuid,
  }),
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
  }),
});

export const updateAmenityCategorySchema = z.object({
  body: z.object({
    categoryId: uuid,
    categoryName: categoryNameSchema,
  }),
});

export const deleteAmenityCategorySchema = z.object({
  body: z.object({
    categoryId: uuid,
  }),
});

export const createAmenityItemSchema = z.object({
  body: z.object({
    categoryId: uuid,
    itemName: itemNameSchema,
    icon: iconSchema,
  }),
});

export const updateAmenityItemSchema = z.object({
  body: z.object({
    itemId: uuid,
    itemName: itemNameSchema.optional(),
    icon: iconSchema.optional(),
  }).refine((d) => d.itemName !== undefined || d.icon !== undefined, {
    message: "At least one of itemName or icon must be provided",
  }),
});

export const deleteAmenityItemSchema = z.object({
  body: z.object({
    itemId: uuid,
  }),
});