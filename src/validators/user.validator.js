import { z } from "zod";
const emailSchema = z
  .email("Invalid email format")
  .toLowerCase()
  .trim();

// Strong password validation
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .refine((pwd) => /[A-Z]/.test(pwd), "Password must contain uppercase letter")
  .refine((pwd) => /[a-z]/.test(pwd), "Password must contain lowercase letter")
  .refine((pwd) => /\d/.test(pwd), "Password must contain number")
  .refine((pwd) => /[!@#$%^&*(),.?":{}|<>]/.test(pwd), "Password must contain special character");

// Name validation
const nameSchema = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters")
  .max(50, "Name must not exceed 50 characters")
  .regex(/^[a-zA-Z\s'-]+$/, "Name can only contain letters, spaces, hyphens, and apostrophes");

// Phone validation (basic international format)
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{1,14}$/, "Invalid phone number format")
  .optional();

// UUID validation
const uuidSchema = z.string().uuid("Invalid UUID format");

// Token validation
const tokenSchema = z
  .string()
  .min(32, "Invalid token")
  .max(256, "Invalid token");


// Registration

export const registerSchema = z.object({
  body: z.object({
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    firstName: nameSchema,
    lastName: nameSchema,
    phone: phoneSchema,
  }).refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  }),
});

export const bookingLoginSchema = z.object({
  body: z.object({
    email: emailSchema,
    password: z.string().min(1, "Password is required"),
  }),
});

export const managementLoginSchema = z.object({
  body: z.object({
    email: emailSchema,
    password: z.string().min(1, "Password is required"),
  }),
});

// EMAIL VERIFICATION 
export const verifyEmailSchema = z.object({
  body: z.object({
    token: tokenSchema,
  }),
});

export const resendVerificationEmailSchema = z.object({
  body: z.object({}).strict(), 
});

// PASSWORD MANAGEMENT

export const requestPasswordResetSchema = z.object({
  body: z.object({
    email: emailSchema,
  }),
});

export const verifyPasswordResetTokenSchema = z.object({
  body: z.object({
    token: tokenSchema,
  }),
});

export const completePasswordResetSchema = z.object({
  body: z.object({
    token: tokenSchema,
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  }).refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  }),
});

export const cancelPasswordResetSchema = z.object({
  body: z.object({
    token: tokenSchema,
  }),
});

export const changePasswordSchema = z.object({
  body: z.object({
    oldPassword: z.string().min(1, "Old password is required"),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  }).refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  }).refine((data) => data.oldPassword !== data.newPassword, {
    message: "New password must be different from old password",
    path: ["newPassword"],
  }),
});

// PROFILE MANAGEMENT

export const updateProfileSchema = z.object({
  body: z.object({
    firstName: nameSchema.optional(),
    lastName: nameSchema.optional(),
    phone: phoneSchema,
  }).refine((data) => Object.values(data).some(v => v !== undefined), {
    message: "At least one field must be provided for update",
  }),
});

export const getCurrentUserSchema = z.object({
  body: z.object({}).strict(), 
});

// PAGINATION & SEARCH 

export const paginationSchema = z.object({
  query: z.object({
    page: z
      .string()
      .transform((v) => parseInt(v, 10))
      .pipe(z.number().int().min(1, "Page must be at least 1"))
      .default("1"),
    limit: z
      .string()
      .transform((v) => parseInt(v, 10))
      .pipe(z.number().int().min(1, "Limit must be at least 1").max(100, "Limit cannot exceed 100"))
      .default("10"),
    search: z.string().trim().max(100, "Search query too long").optional(),
  }),
});