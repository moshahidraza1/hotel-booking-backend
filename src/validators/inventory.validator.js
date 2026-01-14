import { z } from "zod";

const uuid = z.string().uuid("Invalid UUID format");

// strict YYYY-MM-DD (prevents timezone bugs)
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");

const positiveInt = z.number().int().min(0);

export const createInventorySchema = z.object({
  body: z.object({
    roomTypeId: uuid,
    date: dateOnly,
    availableCount: z.number().int().min(0),
    totalStock: z.number().int().min(1),
  }).refine((d) => d.availableCount <= d.totalStock, {
    message: "availableCount cannot exceed totalStock",
    path: ["availableCount"],
  }),
});

export const getInventorySchema = z.object({
  body: z.object({
    roomTypeId: uuid,
    date: dateOnly,
  }),
});

export const getInventoryRangeSchema = z.object({
  params: z.object({
    roomTypeId: uuid,
    checkInDate: dateOnly,
    checkOutDate: dateOnly,
  }),
});

export const checkAvailabilitySchema = z.object({
  body: z.object({
    roomTypeId: uuid,
    checkInDate: dateOnly,
    checkOutDate: dateOnly,
    roomsNeeded: z.number().int().min(1).default(1),
  }),
});

export const updateInventorySchema = z.object({
  body: z.object({
    roomTypeId: uuid,
    date: dateOnly,
    availableCount: z.number().int().min(0).optional(),
    totalStock: z.number().int().min(1).optional(),
    reason: z.string().trim().max(500).optional(),
  }).refine((d) => d.availableCount !== undefined || d.totalStock !== undefined, {
    message: "At least one of availableCount or totalStock must be provided",
  }),
});

export const adjustInventoryRangeSchema = z.object({
  body: z.object({
    roomTypeId: uuid,
    checkInDate: dateOnly,
    checkOutDate: dateOnly,
    quantity: z.number().int().min(1).default(1),
  }),
});

export const bulkUploadInventorySchema = z.object({
  body: z.object({
    roomTypeId: uuid,
    inventoryData: z.array(
      z.object({
        date: dateOnly,
        availableCount: z.number().int().min(0),
        totalStock: z.number().int().min(1),
      }).refine((d) => d.availableCount <= d.totalStock, {
        message: "availableCount cannot exceed totalStock",
        path: ["availableCount"],
      })
    ).min(1, "inventoryData must be a non-empty array"),
  }),
});

export const getInventoryForecastSchema = z.object({
  query: z.object({
    roomTypeId: uuid,
    days: z.coerce.number().int().min(1).max(365).default(30),
  }),
});