import { Router } from "express";
import {
    getOccupancyRate,
    getRevenueByRoomType,
    getAvailabilityForecast,
    getInventoryStatus,
    getBookingTrends,
    getDashboardReport
} from "../controllers/roomReport.controller.js";
import {
    occupancyRateSchema,
    revenueReportSchema,
    availabilityForecastSchema,
    bookingTrendsSchema,
    dashboardReportSchema
} from "../validators/roomReport.validator.js";
import { verifyJWT, verifyAdminOrStaff } from "../middlewares/auth.middleware.js";
import { validate } from "../middlewares/validator.middleware.js";

const router = Router();

// Management Routes
router.use(verifyJWT);
router.use(verifyAdminOrStaff);

// Calculate occupancy rate for a date range
router.post(
    "/occupancy-rate",
    validate(occupancyRateSchema),
    getOccupancyRate
);

// Get revenue breakdown by room type
router.post(
    "/revenue-by-room-type",
    validate(revenueReportSchema),
    getRevenueByRoomType
);

// Predict future availability
router.get(
    "/availability-forecast",
    validate(availabilityForecastSchema),
    getAvailabilityForecast
);

// Get current inventory status summary
router.get(
    "/inventory-status",
    getInventoryStatus
);

// Get booking trends with pagination
router.post(
    "/booking-trends",
    validate(bookingTrendsSchema),
    getBookingTrends
);

// Comprehensive dashboard report
router.get(
    "/dashboard",
    validate(dashboardReportSchema),
    getDashboardReport
);

export default router;