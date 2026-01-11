import { z } from "zod";

const uuid = z.string().uuid("Invalid UUID format");

const roomStatusEnum = z.enum(["AVAILABLE", "DIRTY", "MAINTENANCE", "OCCUPIED"]);

export const createRoomUnitSchema = z.object({
  body: z.object({
    roomTypeId: uuid,
    roomNumber: z.string().trim().min(1, "Room number is required").max(20),
    floor: z.number().int().min(-10).max(200).optional(),
    status: roomStatusEnum.optional(), // default handled by DB if omitted
  }),
});

export const getRoomUnitSchema = z.object({
  params: z.object({
    roomUnitId: uuid,
  }),
});

export const listRoomUnitsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),

    roomTypeId: uuid.optional(),
    status: roomStatusEnum.optional(),
    floor: z.coerce.number().int().optional(),
    search: z.string().trim().max(50).optional(), // roomNumber partial search
  }),
});

export const updateRoomUnitStatusSchema = z.object({
  body: z.object({
    roomUnitId: uuid,
    status: roomStatusEnum,
    reason: z.string().trim().max(500).optional(),
  }),
});

export const bulkUpdateRoomUnitStatusSchema = z.object({
  body: z.object({
    roomUnitIds: z.array(uuid).min(1, "roomUnitIds must be a non-empty array"),
    status: roomStatusEnum,
    reason: z.string().trim().max(500).optional(),
  }),
});

export const deleteRoomUnitSchema = z.object({
  params: z.object({
    roomUnitId: uuid,
  }),
});

export const roomUnitHistorySchema = z.object({
  params: z.object({
    roomUnitId: uuid,
  }),
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
});

export const availableRoomUnitsSchema = z.object({
  query: z.object({
    roomTypeId: uuid,
    checkIn: z.string().min(1, "checkIn is required"),
    checkOut: z.string().min(1, "checkOut is required"),
    includeDirty: z.enum(["true", "false"]).optional(),
  }),
});

export const assignRoomUnitSchema = z.object({
  body: z.object({
    bookingId: uuid,
    roomUnitId: uuid,
    reason: z.string().trim().max(500).optional(),
    force: z.boolean().optional(),
  }),
});

export const unassignRoomUnitSchema = z.object({
  body: z.object({
    bookingId: uuid,
    reason: z.string().trim().max(500).optional(),
    markDirty: z.boolean().optional(),
  }),
});