import { Router } from "express";
import { validate } from "../middlewares/validator.middleware.js";
import { verifyJWT, verifyAdmin, verifyAdminOrStaff } from "../middlewares/auth.middleware.js";

import {
  createRoomUnit,
  getRoomUnit,
  getAllRoomUnits,
  updateRoomUnitStatus,
  bulkUpdateStatus,
  deleteRoomUnit,
  getRoomUnitHistory,
  getAvailableRoomUnits,
  assignRoomUnitToBooking,
  unassignRoomUnitFromBooking,
} from "../controllers/roomUnit.controller.js";

import {
  createRoomUnitSchema,
  getRoomUnitSchema,
  listRoomUnitsSchema,
  updateRoomUnitStatusSchema,
  bulkUpdateRoomUnitStatusSchema,
  deleteRoomUnitSchema,
  roomUnitHistorySchema,
  availableRoomUnitsSchema,
  assignRoomUnitSchema,
  unassignRoomUnitSchema,
} from "../validators/roomUnit.validator.js";

const router = Router();

// Management only
router.use(verifyJWT, verifyAdminOrStaff);

// Read/list (STAFF+ADMIN)
router.get("/", validate(listRoomUnitsSchema), getAllRoomUnits);
router.get("/:roomUnitId", validate(getRoomUnitSchema), getRoomUnit);
router.get("/:roomUnitId/history", validate(roomUnitHistorySchema), getRoomUnitHistory);

// Status updates (STAFF+ADMIN)
router.patch("/status", validate(updateRoomUnitStatusSchema), updateRoomUnitStatus);
router.patch("/status/bulk", validate(bulkUpdateRoomUnitStatusSchema), bulkUpdateStatus);

// Admin-only operations
router.post("/", verifyAdmin, validate(createRoomUnitSchema), createRoomUnit);
router.delete("/:roomUnitId", verifyAdmin, validate(deleteRoomUnitSchema), deleteRoomUnit);

router.get("/available/search", validate(availableRoomUnitsSchema), getAvailableRoomUnits);
router.post("/assign", validate(assignRoomUnitSchema), assignRoomUnitToBooking);
router.post("/unassign", validate(unassignRoomUnitSchema), unassignRoomUnitFromBooking);

export default router;