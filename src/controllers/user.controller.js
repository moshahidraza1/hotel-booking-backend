import bcrypt from "bcrypt";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { prisma } from "../db/db.config.js";
import { generateAccessToken, generateRefreshToken } from "../utils/tokenService.js";

const BCRYPT_SALT_ROUNDS = Number(process.env.BCRYPT_SALT_ROUNDS || 12);
const isProd = process.env.NODE_ENV === "production";

const ensurePasswordPolicy = (password) => {
    if (!password || password.length < 8) {
        throw new ApiError(400, "Password must be at least 8 characters long");
    }
};

const hashPassword = (password) => bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

const setAuthCookies = (res, accessToken, refreshToken) => {
    const options = {
        httpOnly: true,
        secure: isProd, 
        sameSite: "strict",
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

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
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
            },
        });

        // Create GUEST profile only for public registration
        if (!firstName || !lastName) {
            throw new ApiError(400, "First name and last name are required for guests");
        }
        await tx.guestProfile.create({
            data: {
                userId: createdUser.id,
                firstName,
                lastName,
                phone,
            },
        });

        return createdUser;
    });

    // Generate tokens and set secure cookies
    const roleRecord = await prisma.role.findUnique({ where: { id: user.roleId } });
    const roleName = roleRecord?.name || role;
    const accessToken = generateAccessToken(user.id, roleName);
    const refreshToken = generateRefreshToken(user.id, roleName);

    setAuthCookies(res, accessToken, refreshToken);

    const { passwordHash: _, ...userResponse } = user;
    res.status(201).json(new ApiResponse(201, { user: userResponse }, "User registered successfully"));
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
        throw new ApiError(401, "Invalid credentials");
    }
    if (user.deletedAt) {
        throw new ApiError(403, "Account disabled");
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
        throw new ApiError(401, "Invalid credentials");
    }

    // Generate tokens
    const accessToken = generateAccessToken(user.id, user.role.name);
    const refreshToken = generateRefreshToken(user.id, user.role.name);

    // Set secure cookies
    setAuthCookies(res, accessToken, refreshToken);

    const { passwordHash: _, ...userResponse } = user;
    res.status(200).json(new ApiResponse(200, { user: userResponse }, "Login successful"));
});

// Get current user profile
const getCurrentUser = asyncHandler(async (req, res) => {
    const userId = req.user.id;

    const user = await prisma.user.findUnique({
        where: { id: userId },
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
    const { firstName, lastName, phone, department, employeeId } = req.body;

    const user = await prisma.user.findUnique({
        where: { id: userId },
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
            data: { department, employeeId },
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

    const user = await prisma.user.findUnique({ where: { id: userId } });
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
    await prisma.user.update({
        where: { id: userId },
        data: { passwordHash: newPasswordHash },
    });

    res.status(200).json(new ApiResponse(200, null, "Password changed successfully"));
});

export { registerUser, loginUser, getCurrentUser, updateProfile, changePassword };
