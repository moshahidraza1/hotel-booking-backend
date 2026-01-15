import { z } from "zod";

// Date range validation schema
const dateRangeSchema = z.object({
    startDate: z
        .string({ required_error: "Start date is required" })
        .refine((date) => !isNaN(Date.parse(date)), {
            message: "Start date must be a valid ISO 8601 date"
        })
        .transform((date) => new Date(date)),
    endDate: z
        .string({ required_error: "End date is required" })
        .refine((date) => !isNaN(Date.parse(date)), {
            message: "End date must be a valid ISO 8601 date"
        })
        .transform((date) => new Date(date)),
    roomTypeId: z
        .string()
        .uuid({ message: "Room type ID must be a valid UUID" })
        .optional()
}).refine(
    (data) => data.endDate > data.startDate,
    {
        message: "End date must be after start date",
        path: ["endDate"]
    }
).refine(
    (data) => {
        const daysDiff = Math.ceil((data.endDate - data.startDate) / (1000 * 60 * 60 * 24));
        return daysDiff <= 365;
    },
    {
        message: "Date range cannot exceed 365 days",
        path: ["endDate"]
    }
);

// Occupancy rate validation
const occupancyRateSchema = z.object({
    body: dateRangeSchema
});

// Revenue report validation
const revenueReportSchema = z.object({
    body: dateRangeSchema
});

// Availability forecast validation
const availabilityForecastSchema = z.object({
    query: z.object({
        days: z
            .string()
            .optional()
            .default("30")
            .transform((val) => parseInt(val))
            .refine((val) => val >= 1 && val <= 365, {
                message: "Days must be between 1 and 365"
            })
    })
});

// Booking trends validation
const bookingTrendsSchema = z.object({
    body: dateRangeSchema.extend({
        limit: z
            .number()
            .int()
            .min(1, { message: "Limit must be at least 1" })
            .max(50, { message: "Limit cannot exceed 50" })
            .optional()
            .default(10)
    }),
    query: z.object({
        page: z
            .string()
            .optional()
            .default("1")
            .transform((val) => parseInt(val))
            .refine((val) => val >= 1, {
                message: "Page must be a positive integer"
            })
    })
});

// Dashboard report validation
const dashboardReportSchema = z.object({
    query: z.object({
        days: z
            .string()
            .optional()
            .default("30")
            .transform((val) => parseInt(val))
            .refine((val) => val >= 1 && val <= 365, {
                message: "Days must be between 1 and 365"
            })
    })
});

export {
    occupancyRateSchema,
    revenueReportSchema,
    availabilityForecastSchema,
    bookingTrendsSchema,
    dashboardReportSchema
};