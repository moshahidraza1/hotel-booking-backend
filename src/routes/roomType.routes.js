import { Router } from "express";
import {
  createRoomType,
  getRoomType,
  getAllRoomType,
  getRoomTypeWithDetails,
  updateRoomType,
  softDeleteRoomType,
} from "../controllers/roomType.controller.js";

import { verifyJWT, verifyAdmin } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validator.middleware.js";

import {
  createRoomTypeSchema,
  getRoomTypeSchema,
  getAllRoomTypesSchema,
  getRoomTypeWithDetailsSchema,
  updateRoomTypeSchema,
  softDeleteRoomTypeSchema,
} from "../validators/roomType.validator.js";

const router = Router();

//Public (booking portal)
router.get("/", validate(getAllRoomTypesSchema), getAllRoomType);
router.get("/:roomId", validate(getRoomTypeSchema), getRoomType);
router.get("/:roomId/details", validate(getRoomTypeWithDetailsSchema), getRoomTypeWithDetails);

// Admin-only (management)
router.use(verifyAdmin)
router.use(verifyJWT)
router.post("/", validate(createRoomTypeSchema), createRoomType);
router.patch("/", validate(updateRoomTypeSchema), updateRoomType);
router.delete("/", validate(softDeleteRoomTypeSchema), softDeleteRoomType);

export default router;