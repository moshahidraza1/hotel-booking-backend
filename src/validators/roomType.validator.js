import { z } from "zod";

const uuidSchema = z.string().uuid("Invalid UUID format");

const moneySchema = z
  .number({ invalid_type_error: "basePrice must be a number" })
  .positive("Base price must be greater than 0");

const positiveIntSchema = z
  .number({ invalid_type_error: "capacity must be a number" })
  .int("capacity must be an integer")
  .min(1, "Capacity must be at least 1");

const optionalNonEmptyString = (field) =>
  z.string().trim().min(1, `${field} is required`).max(500).optional();

export const createRoomTypeSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
    description: z.string().trim().min(10, "Description must be at least 10 characters").max(2000),
    basePrice: moneySchema,
    capacity: positiveIntSchema,
    size: z.string().trim().max(50).optional(),
    view: z.string().trim().max(50).optional(),
  }),
});

export const getRoomTypeSchema = z.object({
  params: z.object({
    roomId: uuidSchema,
  }),
});

export const getAllRoomTypesSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
  }),
});

export const getRoomTypeWithDetailsSchema = z.object({
  params: z.object({
    roomId: uuidSchema,
  }),
});

// Your controller currently expects roomId in body for update; keep compatible.
// (Recommended later: move roomId to params for REST style)
export const updateRoomTypeSchema = z.object({
  params: z.object({
    roomId: uuidSchema,
  }),
  body: z.object({
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().min(10).max(2000).optional(),
    basePrice: z.number().positive().optional(),
    capacity: z.number().int().min(1).optional(),
    size: optionalNonEmptyString("size"),
    view: optionalNonEmptyString("view"),
  }).refine((data) => Object.keys(data).some((k) => k !== "roomId" && data[k] !== undefined), {
    message: "At least one field must be provided for update",
  }),
});

export const softDeleteRoomTypeSchema = z.object({
  body: z.object({
    roomId: uuidSchema,
  }),
});