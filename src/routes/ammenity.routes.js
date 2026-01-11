import { Router } from "express";
import { validate } from "../middlewares/validator.middleware.js";
import { verifyJWT, verifyAdmin } from "../middlewares/auth.middleware.js";

import {
  createAmenityCategory,
  getAllCategories,
  updateCategory,
  deleteCategory,
  createAmenityItem,
  updateAmenityItem,
  deleteAmenityItem,
} from "../controllers/ammenity.controller.js";

import {
  createAmenityCategorySchema,
  getAllCategoriesSchema,
  updateAmenityCategorySchema,
  deleteAmenityCategorySchema,
  createAmenityItemSchema,
  updateAmenityItemSchema,
  deleteAmenityItemSchema,
} from "../validators/amenity.validator.js";

const router = Router();

//Public read (booking portal can use this)
router.get(
  "/room-type/:roomTypeId/categories",
  validate(getAllCategoriesSchema),
  getAllCategories
);

//Admin-only writes
router.post(
  "/category",
  verifyJWT,
  verifyAdmin,
  validate(createAmenityCategorySchema),
  createAmenityCategory
);

router.patch(
  "/category",
  verifyJWT,
  verifyAdmin,
  validate(updateAmenityCategorySchema),
  updateCategory
);

router.delete(
  "/category",
  verifyJWT,
  verifyAdmin,
  validate(deleteAmenityCategorySchema),
  deleteCategory
);

router.post(
  "/item",
  verifyJWT,
  verifyAdmin,
  validate(createAmenityItemSchema),
  createAmenityItem
);

router.patch(
  "/item",
  verifyJWT,
  verifyAdmin,
  validate(updateAmenityItemSchema),
  updateAmenityItem
);

router.delete(
  "/item",
  verifyJWT,
  verifyAdmin,
  validate(deleteAmenityItemSchema),
  deleteAmenityItem
);

export default router;