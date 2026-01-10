import { Router } from "express";
import { 
    registerUser, 
    verifyEmail,
    resendVerificationEmail,
    refreshTokens,
    loginUser, 
    logoutUser, 
    getCurrentUser, 
    updateProfile, 
    changePassword,
    requestPasswordReset,
    verifyPasswordResetToken,
    completePasswordReset,
    cancelPasswordReset
} from "../controllers/user.controller.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

import { validate } from "../middlewares/validator.middleware.js";
import {
  registerSchema,
  bookingLoginSchema,
  verifyEmailSchema,
  resendVerificationEmailSchema,
  requestPasswordResetSchema,
  verifyPasswordResetTokenSchema,
  completePasswordResetSchema,
  cancelPasswordResetSchema,
  changePasswordSchema,
  updateProfileSchema,
} from "../validators/user.validator.js";

const router = Router();

// Public routes (booking/auth)
router.post("/register", validate(registerSchema), registerUser);
router.post("/login", validate(bookingLoginSchema), loginUser);

router.post("/refresh-token", refreshTokens);

router.post("/verify-email", validate(verifyEmailSchema), verifyEmail);

router.post("/request-password-reset", validate(requestPasswordResetSchema), requestPasswordReset);
router.post("/verify-reset-token", validate(verifyPasswordResetTokenSchema), verifyPasswordResetToken);
router.post("/complete-password-reset", validate(completePasswordResetSchema), completePasswordReset);
router.post("/cancel-password-reset", validate(cancelPasswordResetSchema), cancelPasswordReset);

// Protected routes
router.post("/resend-verification-email", verifyJWT, validate(resendVerificationEmailSchema), resendVerificationEmail);
router.post("/logout", verifyJWT, logoutUser);

router.get("/profile", verifyJWT, getCurrentUser);
router.patch("/profile", verifyJWT, validate(updateProfileSchema), updateProfile);

router.post("/change-password", verifyJWT, validate(changePasswordSchema), changePassword);

export default router;