import { z } from "zod";

// UUID validation helper
const uuid = z.string().uuid("Invalid UUID format");

// Password strength
const strongPassword = (value, ctx) => {
    const hasUpperCase = /[A-Z]/.test(value);
    const hasLowerCase = /[a-z]/.test(value);
    const hasNumber = /\d/.test(value);
    const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(value);
    
    if (!hasUpperCase || !hasLowerCase || !hasNumber || !hasSpecial) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Password must contain uppercase, lowercase, number, and special character"
        });
    }
    return z.NEVER;
};

export const updateAdminDetailsSchema = z.object({
    body: z.object({
        firstName: z.string().trim().min(2, "First name must be 2+ chars").max(50).optional(),
        lastName: z.string().trim().min(2, "Last name must be 2+ chars").max(50).optional(),
        phone: z.string().trim().min(13).max(15).optional(),
        department: z.string().trim().min(2).max(100).optional(),
        employeeId: z.string().trim().min(4).max(20).optional(),
        shiftStatus: z.string().trim().min(2).max(20).optional()
    })
});

export const addStaffSchema = z.object({
    body: z.object({
        email: z.email("Valid email is required"),
        password: z.string().min(8).refine(strongPassword),
        firstName: z.string().trim().min(2, "First name must be 2+ chars").max(50),
        lastName: z.string().trim().min(2, "Last name must be 2+ chars").max(50),
        phone: z.string().min(13).max(15).optional(),
        department: z.string().trim().min(2).max(100),
        employeeId: z.string().trim().min(2).max(20),
        shiftStatus: z.enum(["FULL_TIME", "PART_TIME", "SHIFT"]).optional()
    })
});

export const updateStaffDetailsSchema = z.object({
    params: z.object({
        staffId: uuid
    }),
    body: z.object({
        firstName: z.string().trim().min(2).max(50).optional(),
        lastName: z.string().trim().min(2).max(50).optional(),
        phone: z.string().min(13).max(15).optional(),
        department: z.string().trim().min(2).max(100).optional(),
        employeeId: z.string().trim().min(2).max(20).optional(),
        shiftStatus: z.enum(["FULL_TIME", "PART_TIME", "SHIFT"]).optional()
    })
});

export const deactivateStaffSchema = z.object({
    body: z.object({
        staffId: uuid,
        reason: z.string().trim().max(500).optional()
    })
});

export const activateStaffSchema = z.object({
    body: z.object({
        staffId: uuid
    })
});

export const deactivateCustomerSchema = z.object({
    body: z.object({
        customerId: uuid,
        reason: z.string().trim().max(500).optional()
    })
});

export const activateCustomerSchema = z.object({
    body: z.object({
        customerId: uuid
    })
});

export const getCustomerDetailsSchema = z.object({
    params: z.object({
        customerId: uuid
    })
});

export const paginationSchema = z.object({
    query: z.object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(10),
        search: z.string().trim().max(100).optional(),
        department: z.string().trim().max(100).optional()
    })
});
