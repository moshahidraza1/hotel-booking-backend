import bcrypt from "bcrypt";
import crypto from "crypto";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { prisma } from "../db/db.config.js";
import { generateAccessToken, generateRefreshToken } from "../utils/tokenService.js";
import { EMAIL_TEMPLATES, sendEmail } from "../utils/emailService.js";
import { create } from "domain";

const BCRYPT_SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 12);

const PASSWORD_RESET_EXPIRY = 60 * 60 * 1000; // 1 hour
const EMAIL_VERIFICATION_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const MAX_PASSWORD_RESET_ATTEMPTS = 5;
const RESET_ATTEMPT_WINDOW = 60 * 60 * 1000; // 1 hour


const hashToken = (token) =>
  crypto.createHmac("sha256", process.env.TOKEN_SECRET)
        .update(token)
        .digest("hex");

const generateVerificationToken = () => crypto.randomBytes(32).toString("hex");


const isProd = process.env.NODE_ENV === "production";

const ensurePasswordPolicy = (password) => {
    if (!password || password.length < 8) {
        throw new ApiError(400, "Password must be at least 8 characters long");
    }
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumber = /\d/.test(password);
    const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
    if (!hasUpperCase || !hasLowerCase || !hasNumber || !hasSpecial) {
        throw new ApiError(400, "Password must contain uppercase, lowercase, number, and special character");
    }
};

const hashPassword = (password) => bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

const setAuthCookies = (res, accessToken, refreshToken) => {
    const options = {
        httpOnly: true,
        secure: isProd, 
        sameSite: isProd ? "none" : "strict",
        path: "/",
    };
    res.cookie("accessToken", accessToken, { ...options, maxAge: 15 * 60 * 1000 }); // 15m
    res.cookie("refreshToken", refreshToken, { ...options, maxAge: 7 * 24 * 60 * 60 * 1000 }); // 7d
};

const clearAuthCookies = (res) => {
    res.clearCookie("accessToken", { path: "/" });
    res.clearCookie("refreshToken", { path: "/" });
};

// Register a new user
const registerUser = asyncHandler(async (req, res) => {
    const { email, password, firstName, lastName, phone } = req.body;

    // Public registration is restricted to GUEST role only
    const role = "GUEST";

    // Validate required fields
    if (!email || !password) {
        throw new ApiError(400, "Email and password are required");
    }
    ensurePasswordPolicy(password);

    if (!firstName || !lastName) {
        throw new ApiError(400, "First name and last name are required");
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({ 
        where: { email },
        select: {id: true, email: true}
     });

    if (existingUser) {
        throw new ApiError(409, "User with this email already exists");
    }

    const user = await prisma.$transaction(async (tx) => {
        const roleRecord = await tx.role.findUnique({ where: { name: role } });
        if (!roleRecord) {
            throw new ApiError(500, "System role configuration missing");
        }

        const passwordHash = await hashPassword(password);

        const createdUser = await tx.user.create({
            data: {
                email,
                passwordHash,
                roleId: roleRecord.id,
                isEmailVerified: false
            },
        });

        // Create GUEST profile only for public registration
        await tx.guestProfile.create({
            data: {
                userId: createdUser.id,
                firstName,
                lastName,
                phone,
            },
        });

        //Generate and store email verification token
        const verificationToken = generateVerificationToken();
        const expiresAt = new Date(Date.now()+ EMAIL_VERIFICATION_EXPIRY);
        const hashedVerificationToken = hashToken(verificationToken);

        await tx.emailVerification.create({
            data:{
                token: hashedVerificationToken,
                userId: createdUser.id,
                expiresAt
            }
        });

        return {...createdUser, verificationToken};
    });

    //send verification email
    const { verificationToken } = user;
    const verificationLink = `${FRONTEND_URL}/verify-email?token=${verificationToken}`;

    try {
        await sendEmail(email, EMAIL_TEMPLATES.VERIFICATION, {
            firstName,
            verificationLink
        });
    } catch (emailError) {
        console.error("Email sending failed during registration:", emailError);
        //TODO: Implement Queue for retry
    }

    // Generate tokens and set secure cookies
    const roleRecord = await prisma.role.findUnique({ where: { id: user.roleId } });
    const roleName = roleRecord?.name || role;
    const accessToken = generateAccessToken(user.id, roleName);
    const refreshToken = generateRefreshToken();
    const hashedToken = hashToken(refreshToken);

    // Store refresh token in database for revocation
    await prisma.refreshToken.create({
        data: {
            token: hashedToken,
            userId: user.id,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        }
    });

    setAuthCookies(res, accessToken, refreshToken);

    const { passwordHash: _, verificationToken: __, ...userResponse } = user;
    res.status(201).json(new ApiResponse(201, { user: userResponse }, "User registered successfully"));
});

// send verification email
const resendVerificationEmail = asyncHandler(async(req, res) => {
    const userId = req.user.id;

    const user = await prisma.user.findFirst({
        where: { id: userId, deletedAt: null },
        include: { guestProfile: true },
    });

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    if (user.isEmailVerified) {
        throw new ApiError(400, "Email is already verified");
    }

    // Check if verification token exists and is still valid
    let emailVerification = await prisma.emailVerification.findUnique({
        where: { userId },
    });

    // If token exists and is still valid, don't create a new one
    if (emailVerification && emailVerification.expiresAt > new Date()) {
        throw new ApiError(400, "Verification email was recently sent. Please check your inbox or try again later.");
    }

    // Create new verification token
    const verificationToken = generateVerificationToken();
    const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_EXPIRY);
    const hashedVerificationToken = hashToken(verificationToken);

    emailVerification = await prisma.emailVerification.upsert({
        where: {userId},
        update:{
            token: hashedVerificationToken,
            expiresAt
        },
        create:{
            token: hashedVerificationToken,
            userId,
            expiresAt
        }
    });

    // Send verification email
    const verificationLink = `${FRONTEND_URL}/verify-email?token=${verificationToken}`

    await sendEmail(user.email, EMAIL_TEMPLATES.VERIFICATION, {
        firstName: user.guestProfile?.firstName ||"User",
        verificationLink
    });

    res.status(200).json(
        new ApiResponse(200, null, "Verification email sent successfully")
    );

});

// verify email
const verifyEmail = asyncHandler(async(req, res) => {
    const {token} = req.body;
    
    if (!token) {
        throw new ApiError(400, "Verification token is required");
    }

    const hashedToken = hashToken(token);

    const emailVerification = await prisma.emailVerification.findUnique({
        where: { token: hashedToken },
        include: { user: true },
    });

    if (!emailVerification) {
        throw new ApiError(400, "Invalid verification token");
    }

    // Check if token has expired
    if (new Date() > emailVerification.expiresAt) {
        // Delete expired token
        await prisma.emailVerification.delete({
            where: { id: emailVerification.id },
        });
        throw new ApiError(400, "Verification token has expired. Please request a new one.");
    }

    // Check if email is already verified
    if (emailVerification.user.isEmailVerified) {
        await prisma.emailVerification.delete({
            where: { id: emailVerification.id },
        });
        throw new ApiError(400, "Email is already verified");
    }

    // Update user email verification status and delete token
    await prisma.$transaction(async (tx) => {
        await tx.user.update({
            where: { id: emailVerification.userId },
            data: { isEmailVerified: true },
        });

        await tx.emailVerification.delete({
            where: { id: emailVerification.id },
        });
    });

    res.status(200).json(
        new ApiResponse(200, null, "Email verified successfully")
    );

});

// refresh access token using refreshToken
const refreshTokens = asyncHandler(async (req, res) => {
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
        throw new ApiError(401, "Refresh token not found");
    }

    const hashedToken = hashToken(refreshToken);

    // Find the refresh token in database
    const storedToken = await prisma.refreshToken.findUnique({
        where: { tokenHash: hashedToken },
        include: { user: { include: { role: true } } }
    });

    if (!storedToken) {
        throw new ApiError(401, "Invalid refresh token");
    }

    // Check if token is expired
    if (new Date() > storedToken.expiresAt) {
        // Clean up expired token
        await prisma.refreshToken.delete({
            where: { id: storedToken.id }
        });
        throw new ApiError(401, "Refresh token has expired");
    }

    // Check if token is revoked
    if (storedToken.revokedAt) {
        await prisma.refreshToken.deleteMany({ where: { userId: storedToken.user.id } });
    throw new ApiError(401, "Refresh token reuse detected. All sessions revoked.");
}

    // Check if user is active
    if (storedToken.user.deletedAt) {
        throw new ApiError(403, "Account is disabled");
    }

    // Generate new tokens
    const newAccessToken = generateAccessToken(storedToken.user.id, storedToken.user.role.name);
    const newRefreshToken = generateRefreshToken();
    const newHashedToken = hashToken(newRefreshToken);

    // Invalidate old refresh token
    await prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { revokedAt: new Date() }
    });

    // Store new refresh token
    await prisma.refreshToken.create({
        data: {
            token: newHashedToken,
            userId: storedToken.user.id,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        }
    });

    // Set new cookies
    setAuthCookies(res, newAccessToken, newRefreshToken);

    const { passwordHash: _, ...userResponse } = storedToken.user;
    res.status(200).json(
        new ApiResponse(200, { user: userResponse }, "Tokens refreshed successfully")
    );
});

// Login user
const loginUser = asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        throw new ApiError(400, "Email and password are required");
    }

    // Find user with role
    const user = await prisma.user.findUnique({
        where: { email },
        include: { role: true, guestProfile: true, staffProfile: true },
    });
    if (!user) {
        throw new ApiError(401, "Invalid email or password");
    }
    if (user.deletedAt) {
        throw new ApiError(403, "Account disabled");
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid || !user.role) {
        throw new ApiError(401, "Invalid email or password");
    }

    // Generate tokens
    const accessToken = generateAccessToken(user.id, user.role.name);
    const refreshToken = generateRefreshToken();
    const hashedToken = hashToken(refreshToken);

    // Store refresh token in database
    await prisma.refreshToken.create({
        data: {
            token: hashedToken,
            userId: user.id,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        }
    });

    // Set secure cookies
    setAuthCookies(res, accessToken, refreshToken);

    const { passwordHash: _, ...userResponse } = user;
    res.status(200).json(new ApiResponse(200, { user: userResponse }, "Login successful"));
});

// Login management user
const loginManagementUser = asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        throw new ApiError(400, "Email and password are required");
    }

    const user = await prisma.user.findUnique({
        where: { email },
        include: { role: true, staffProfile: true },
    });

    if (!user || user.deletedAt) {
        throw new ApiError(401, "Invalid email or password");
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid || !user.role) {
        throw new ApiError(401, "Invalid email or password");
    }

    // management access restriction
    if (!["ADMIN", "STAFF"].includes(user.role.name)) {
        throw new ApiError(403, "Access denied");
    }

    const accessToken = generateAccessToken(user.id, user.role.name);
    const refreshToken = generateRefreshToken();

    await prisma.refreshToken.create({
        data: {
            token: hashToken(refreshToken),
            userId: user.id,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
    });

    setAuthCookies(res, accessToken, refreshToken);

    const { passwordHash: _, ...userResponse } = user;
    res.status(200).json(new ApiResponse(200, { user: userResponse }, "Login successful"));
});

//Logout user
const logoutUser = asyncHandler(async(req, res)=> {
    const refreshToken = req.cookies?.refreshToken;

    clearAuthCookies(res);

     if (refreshToken) {
        const hashedToken = hashToken(refreshToken);

        await prisma.refreshToken.updateMany({
            where: {
                tokenHash: hashedToken,
                revokedAt: null
            },
            data: {
                revokedAt: new Date()
            }
        });
    }

    res.status(200).json(
        new ApiResponse(200, null, "Logged out successfully")
    )
});

// Get current user profile
const getCurrentUser = asyncHandler(async (req, res) => {
    const userId = req.user.id;

    const user = await prisma.user.findFirst({
        where: { id: userId, deletedAt: null },
        include: { role: true, guestProfile: true, staffProfile: true },
    });
    if (!user) {
        throw new ApiError(404, "User not found");
    }

    const { passwordHash: _, ...userResponse } = user;
    res.status(200).json(new ApiResponse(200, userResponse, "User profile retrieved"));
});

// Update user profile
const updateProfile = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { firstName, lastName, phone } = req.body;

    const user = await prisma.user.findFirst({
        where: { id: userId, deletedAt: null },
        include: { guestProfile: true, staffProfile: true, role: true },
    });
    if (!user) {
        throw new ApiError(404, "User not found");
    }

    // Update based on role
    if (user.role.name === "GUEST" && user.guestProfile) {
        await prisma.guestProfile.update({
            where: { id: user.guestProfile.id },
            data: { firstName, lastName, phone },
        });
    } else if (user.role.name === "STAFF" && user.staffProfile) {
        await prisma.staffProfile.update({
            where: { id: user.staffProfile.id },
            data: { firstName, lastName, phone},
        });
    }

    res.status(200).json(new ApiResponse(200, null, "Profile updated successfully"));
});

// Change password
const changePassword = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
        throw new ApiError(400, "Old and new passwords are required");
    }

    const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) {
        throw new ApiError(404, "User not found");
    }

    const isOldPasswordValid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!isOldPasswordValid) {
        throw new ApiError(400, "Old password is incorrect");
    }

    ensurePasswordPolicy(newPassword);
    if (newPassword === oldPassword) {
        throw new ApiError(400, "New password must be different from old password");
    }

    const newPasswordHash = await hashPassword(newPassword);
    await prisma.$transaction(async (tx) => {
        // Update password
        await tx.user.update({
            where: { id: userId },
            data: { passwordHash: newPasswordHash },
        });
        
        // Invalidate all refresh tokens 
        await tx.refreshToken.updateMany({
            where: { userId },
            data:{
                revokedAt: new Date()
            }
        });
    });


    res.status(200).json(new ApiResponse(200, null, "Password changed successfully"));
});
/*
//Reset Password
//TODO: send email
//TODO: set password and revoke refresh/acceess tokens
*/
// Request password Reset
const requestPasswordReset = asyncHandler(async(req, res) => {
    const {email} = req.body;

    if (!email) {
        throw new ApiError(400, "Email is required");
    }

    const user = await prisma.user.findUnique({
        where: {email},
        include: { guestProfile: true, staffProfile: true },
    
    });

    if(!user || user.deletedAt){
        return res.status(200).json(
            new ApiResponse(
                200, 
                null, 
                "If an account exists with this email, you will receive a password reset link"
            )
        );
    }

    // Rate limiting: Check if user has too many reset requests
    const recentResetAttempts = await prisma.passwordReset.count({
        where: {
            userId: user.id,
            createdAt: {
                gte: new Date(Date.now() - RESET_ATTEMPT_WINDOW)
            },
            isUsed: false
        }
    });

    if (recentResetAttempts >= MAX_PASSWORD_RESET_ATTEMPTS) {
        throw new ApiError(
            429, 
            "Too many password reset requests. Please try again later."
        );
    }

    // Generate reset token
    const resetToken = generateVerificationToken();
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRY);
    const hashedResetToken = hashToken(resetToken);

    // Create password reset record
    await prisma.passwordReset.create({
        data: {
            token: hashedResetToken,
            userId: user.id,
            expiresAt,
            isUsed: false
        }
    });

    const firstName = user.guestProfile?.firstName || user.staffProfile?.firstName || "User";

    // Send reset email
    const resetLink = `${FRONTEND_URL}/reset-password?token=${resetToken}`;

    try {
        await sendEmail(user.email, EMAIL_TEMPLATES.PASSWORD_RESET, {
            firstName,
            resetLink
        });
    } catch (emailError) {
        console.error("Email sending failed during password reset request:", emailError);
        // TODO: Retry queue implementation
    }

    res.status(200).json(
        new ApiResponse(
            200, 
            null, 
            "If an account exists with this email, you will receive a password reset link"
        )
    );

});

// Verify password reset token and validate new password
const verifyPasswordResetToken = asyncHandler(async(req, res) =>{

    const {token} = req.body;

    if(!token){
        throw new ApiError(400, "Reset token is required");
    }

    const hashedToken = hashToken(token);

    const passwordReset = await prisma.passwordReset.findUnique({
        where: { token: hashedToken },
        include: { user: true }
    });

    if(!passwordReset) {
        throw new ApiError(400, "Invalid password reset token");
    }

    // Check if token has expired
    if(new Date() > passwordReset.expiresAt) {
        throw new ApiError(400, "Password reset token has expired. Please request a new one.");
    }

    // Check if token has already been used
    if (passwordReset.isUsed) {
        throw new ApiError(400, "This password reset token has already been used");
    }

    res.status(200).json(
        new ApiResponse(200, { email: passwordReset.user.email }, "Reset token is valid")
    );

});

// complete Password Reset
const completePasswordReset = asyncHandler(async(req, res) =>{

    const {token, newPassword} = req.body;
    if (!token || !newPassword) {
        throw new ApiError(400, "Reset token and new password are required");
    }

    // Validate password policy
    ensurePasswordPolicy(newPassword);
    const hashedToken = hashToken(token);

    const passwordReset = await prisma.passwordReset.findUnique({
        where: { token: hashedToken },
        include: { user: true }
    });

    if (!passwordReset) {
        throw new ApiError(400, "Invalid password reset token");
    }
    if(passwordReset.user.deletedAt){
        throw new ApiError(400, "Cannot update password of deleted user")
    }

    // Check if token has expired
    if (new Date() > passwordReset.expiresAt) {
        throw new ApiError(400, "Password reset token has expired. Please request a new one.");
    }

    // Check if token has already been used
    if (passwordReset.isUsed) {
        throw new ApiError(400, "This password reset token has already been used");
    }

    // Check if user still exists and is active
    if (passwordReset.user.deletedAt) {
        throw new ApiError(403, "Account is disabled");
    }

    // Hash new password
    const newPasswordHash = await hashPassword(newPassword);

    // Update user password and mark token as used in a transaction
    await prisma.$transaction(async (tx) => {
        // Update user password
        await tx.user.update({
            where: { id: passwordReset.userId },
            data: { passwordHash: newPasswordHash }
        });

        // Mark reset token as used
        await tx.passwordReset.update({
            where: { id: passwordReset.id },
            data: { isUsed: true }
        });

        // Invalidate all existing refresh tokens for security
        await tx.refreshToken.updateMany({
            where: { userId: passwordReset.userId },
            data: { revokedAt: new Date() }
        });
    });

    res.status(200).json(
        new ApiResponse(200, null, "Password reset successfully. Please login with your new password.")
    );
});

// Cancel password reset
const cancelPasswordReset = asyncHandler(async (req, res) => {
    const { token } = req.body;

    if (!token) {
        throw new ApiError(400, "Reset token is required");
    }

    const hashedToken = hashToken(token);

    const passwordReset = await prisma.passwordReset.findUnique({
        where: { token: hashedToken }
    });

    if (!passwordReset) {
        throw new ApiError(400, "Invalid password reset token");
    }

    if (passwordReset.isUsed) {
        throw new ApiError(400, "This password reset token has already been used");
    }

    // Mark as used to prevent further use
    await prisma.passwordReset.update({
        where: { id: passwordReset.id },
        data: { isUsed: true }
    });

    res.status(200).json(
        new ApiResponse(200, null, "Password reset request cancelled")
    );
});

export { 
    registerUser, 
    verifyEmail,
    resendVerificationEmail,
    refreshTokens,
    loginUser, 
    loginManagementUser,
    logoutUser, 
    getCurrentUser, 
    updateProfile, 
    changePassword,
    requestPasswordReset,
    verifyPasswordResetToken,
    completePasswordReset,
    cancelPasswordReset
}
