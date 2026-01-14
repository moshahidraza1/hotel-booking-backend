import { Router } from "express";
import { validate } from "../middlewares/validator.middleware.js";
import { verifyJWT, verifyAdminOrStaff } from "../middlewares/auth.middleware.js";

import {
  createInventory,
  getInventory,
  getInventoryRange,
  checkAvailability,
  updateInventory,
  decrementInventory,
  incrementInventory,
  bulkUploadInventory,
  getInventoryForecast,
} from "../controllers/inventory.controller.js";

import {
  createInventorySchema,
  getInventorySchema,
  getInventoryRangeSchema,
  checkAvailabilitySchema,
  updateInventorySchema,
  adjustInventoryRangeSchema,
  bulkUploadInventorySchema,
  getInventoryForecastSchema,
} from "../validators/inventory.validator.js";

const router = Router();

// Public read endpoints (booking portal)
router.post("/availability", validate(checkAvailabilitySchema), checkAvailability);
router.get(
  "/:roomTypeId/range/:checkInDate/:checkOutDate",
  validate(getInventoryRangeSchema),
  getInventoryRange
);
router.get("/forecast", validate(getInventoryForecastSchema), getInventoryForecast);

// Management endpoints
router.use(verifyJWT, verifyAdminOrStaff);

router.post("/", validate(createInventorySchema), createInventory);
router.post("/single", validate(getInventorySchema), getInventory); 
router.patch("/", validate(updateInventorySchema), updateInventory);

router.post("/decrement", validate(adjustInventoryRangeSchema), decrementInventory);
router.post("/increment", validate(adjustInventoryRangeSchema), incrementInventory);

router.post("/bulk-upload", validate(bulkUploadInventorySchema), bulkUploadInventory);

export default router;