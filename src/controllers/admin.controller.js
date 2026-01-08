import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { prisma } from "../db/db.config.js";

// Get admin profile
const getAdminProfile = asyncHandler(async (req, res) => {
    const userId = req.user.id;

    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { role: true, staffProfile: true },
    });

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    const { passwordHash: _, ...userResponse } = user;
    res.status(200).json(new ApiResponse(200, userResponse, "Admin profile retrieved"));
});

// Update admin details
const updateAdminDetails = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { firstName, lastName, phone, department, employeeId, shiftStatus } = req.body;

    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { staffProfile: true, role: true },
    });

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    if (user.role.name !== "ADMIN") {
        throw new ApiError(403, "Only admins can update their profile");
    }

    if (user.staffProfile) {
        await prisma.staffProfile.update({
            where: { id: user.staffProfile.id },
            data: {
                ...(firstName && { firstName }),
                ...(lastName && { lastName }),
                ...(phone && { phone }),
                ...(department && { department }),
                ...(employeeId && { employeeId }),
                ...(shiftStatus && { shiftStatus }),
            },
        });
    }

    res.status(200).json(new ApiResponse(200, null, "Admin details updated successfully"));
});

// Add new staff (admin only)
const addStaff = asyncHandler(async (req, res) => {
    const adminId = req.user.id;
    const { email, password, firstName, lastName, phone, department, employeeId, shiftStatus } = req.body;

    if (!email || !password || !firstName || !lastName || !department || !employeeId) {
        throw new ApiError(400, "Email, password, firstName, lastName, department, and employeeId are required");
    }

    const admin = await prisma.user.findUnique({
        where: { id: adminId },
        include: { role: true },
    });

    if (!admin || admin.role.name !== "ADMIN") {
        throw new ApiError(403, "Only admins can add staff");
    }

    ensurePasswordPolicy(password);

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
        throw new ApiError(409, "User with this email already exists");
    }

    const passwordHash = await hashPassword(password);
    const staffRole = await prisma.role.findUnique({ where: { name: "STAFF" } });
    if (!staffRole) {
        throw new ApiError(500, "STAFF role not found");
    }

    const newUser = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
            data: {
                email,
                passwordHash,
                roleId: staffRole.id,
            },
        });

        await tx.staffProfile.create({
            data: {
                userId: user.id,
                firstName,
                lastName,
                phone,
                department,
                employeeId,
                shiftStatus,
            },
        });

        return user;
    });

    res.status(201).json(new ApiResponse(201, { email: newUser.email }, "Staff added successfully"));
});

// Get all staff
const getAllStaff = asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, search, department } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
    const skip = (pageNum - 1) * limitNum;

    const where = {
        role: { name: "STAFF" },
        deletedAt: null,
        ...(search && {
            OR: [
                { email: { contains: search, mode: "insensitive" } },
                { staffProfile: { firstName: { contains: search, mode: "insensitive" } } },
                { staffProfile: { lastName: { contains: search, mode: "insensitive" } } },
            ],
        }),
        ...(department && { staffProfile: { department } }),
    };

    const [staff, total] = await prisma.$transaction([
        prisma.user.findMany({
            where,
            skip,
            take: limitNum,
            orderBy: { createdAt: "desc" },
            include: { staffProfile: true, role: true },
        }),
        prisma.user.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limitNum);

    res.status(200).json(
        new ApiResponse(
            200,
            {
                staff,
                pagination: { total, page: pageNum, limit: limitNum, totalPages },
            },
            "Staff list retrieved successfully"
        )
    );
});

//TODO: Add get a Staff Details function

// Update staff details (admin only)
const updateStaffDetails = asyncHandler(async (req, res) => {
    const adminId = req.user.id;
    const {staffId} = req.params;
    const { firstName, lastName, phone, department, employeeId, shiftStatus } = req.body;

    const admin = await prisma.user.findUnique({
        where: { id: adminId },
        include: { role: true },
    });

    if (!admin || admin.role.name !== "ADMIN") {
        throw new ApiError(403, "Only admins can update staff details");
    }

    const staffUser = await prisma.user.findUnique({
        where: { id: staffId },
        include: { staffProfile: true, role: true },
    });

    if (!staffUser || staffUser.role.name !== "STAFF") {
        throw new ApiError(404, "Staff member not found");
    }

    if (staffUser.deletedAt) {
        throw new ApiError(400, "Cannot update disabled staff account");
    }

    await prisma.staffProfile.update({
        where: { id: staffUser.staffProfile.id },
        data: {
            ...(firstName && { firstName }),
            ...(lastName && { lastName }),
            ...(phone !== undefined && { phone }),
            ...(department && { department }),
            ...(employeeId && { employeeId }),
            ...(shiftStatus !== undefined && { shiftStatus }),
        },
    });

    res.status(200).json(new ApiResponse(200, null, "Staff details updated successfully"));
});

// Disable staff account (soft delete)
const disableStaffAccount = asyncHandler(async (req, res) => {
    const adminId = req.user.id;
    const { staffId, reason } = req.body;

    const admin = await prisma.user.findUnique({
        where: { id: adminId },
        include: { role: true },
    });

    if (!admin || admin.role.name !== "ADMIN") {
        throw new ApiError(403, "Only admins can disable staff accounts");
    }

    if (adminId === staffId) {
        throw new ApiError(400, "You cannot disable your own account");
    }

    const staffUser = await prisma.user.findUnique({
        where: { id: staffId },
        include: { role: true },
    });

    if (!staffUser || staffUser.role.name !== "STAFF") {
        throw new ApiError(404, "Staff member not found");
    }

    if (staffUser.deletedAt) {
        throw new ApiError(400, "Staff account is already disabled");
    }

    await prisma.user.update({
        where: { id: staffId },
        data: { deletedAt: new Date() },
    });

    res.status(200).json(new ApiResponse(200, null, "Staff account disabled successfully"));
});

// Re-enable staff account
const enableStaffAccount = asyncHandler(async (req, res) => {
    const adminId = req.user.id;
    const { staffId } = req.body;

    const admin = await prisma.user.findUnique({
        where: { id: adminId },
        include: { role: true },
    });

    if (!admin || admin.role.name !== "ADMIN") {
        throw new ApiError(403, "Only admins can enable staff accounts");
    }

    const staffUser = await prisma.user.findUnique({
        where: { id: staffId },
        include: { role: true },
    });

    if (!staffUser || staffUser.role.name !== "STAFF") {
        throw new ApiError(404, "Staff member not found");
    }

    if (!staffUser.deletedAt) {
        throw new ApiError(400, "Staff account is already enabled");
    }

    await prisma.user.update({
        where: { id: staffId },
        data: { deletedAt: null },
    });

    res.status(200).json(new ApiResponse(200, null, "Staff account enabled successfully"));
});

// Get all customers
const getAllCustomers = asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, search } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
    const skip = (pageNum - 1) * limitNum;

    const where = {
        role: { name: "GUEST" },
        deletedAt: null,
        ...(search && {
            OR: [
                { email: { contains: search, mode: "insensitive" } },
                { guestProfile: { firstName: { contains: search, mode: "insensitive" } } },
                { guestProfile: { lastName: { contains: search, mode: "insensitive" } } },
            ],
        }),
    };

    const [customers, total] = await prisma.$transaction([
        prisma.user.findMany({
            where,
            skip,
            take: limitNum,
            orderBy: { createdAt: "desc" },
            include: { guestProfile: true, role: true },
        }),
        prisma.user.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limitNum);

    res.status(200).json(
        new ApiResponse(
            200,
            {
                customers,
                pagination: { total, page: pageNum, limit: limitNum, totalPages },
            },
            "Customer list retrieved successfully"
        )
    );
});

// Disable customer account (soft delete)
const disableCustomerAccount = asyncHandler(async (req, res) => {
    const adminId = req.user.id;
    const { customerId, reason } = req.body;

    const admin = await prisma.user.findUnique({
        where: { id: adminId },
        include: { role: true },
    });

    if (!admin || admin.role.name !== "ADMIN") {
        throw new ApiError(403, "Only admins can disable customer accounts");
    }

    const customerUser = await prisma.user.findUnique({
        where: { id: customerId },
        include: { role: true },
    });

    if (!customerUser || customerUser.role.name !== "GUEST") {
        throw new ApiError(404, "Customer not found");
    }

    if (customerUser.deletedAt) {
        throw new ApiError(400, "Customer account is already disabled");
    }

    // Check for active bookings before disabling
    const activeBookings = await prisma.booking.count({
        where: {
            guestId: customerId,
            status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] },
        },
    });

    if (activeBookings > 0) {
        throw new ApiError(400, `Cannot disable account with ${activeBookings} active booking(s)`);
    }

    await prisma.user.update({
        where: { id: customerId },
        data: { deletedAt: new Date() },
    });

    res.status(200).json(new ApiResponse(200, null, "Customer account disabled successfully"));
});

// Re-enable customer account
const enableCustomerAccount = asyncHandler(async (req, res) => {
    const adminId = req.user.id;
    const { customerId } = req.body;

    const admin = await prisma.user.findUnique({
        where: { id: adminId },
        include: { role: true },
    });

    if (!admin || admin.role.name !== "ADMIN") {
        throw new ApiError(403, "Only admins can enable customer accounts");
    }

    const customerUser = await prisma.user.findUnique({
        where: { id: customerId },
        include: { role: true },
    });

    if (!customerUser || customerUser.role.name !== "GUEST") {
        throw new ApiError(404, "Customer not found");
    }

    if (!customerUser.deletedAt) {
        throw new ApiError(400, "Customer account is already enabled");
    }

    await prisma.user.update({
        where: { id: customerId },
        data: { deletedAt: null },
    });

    res.status(200).json(new ApiResponse(200, null, "Customer account enabled successfully"));
});

// Get customer details with bookings
const getCustomerDetails = asyncHandler(async (req, res) => {
    const { customerId } = req.params;

    const customer = await prisma.user.findUnique({
        where: { id: customerId },
        include: {
            role: true,
            guestProfile: true,
            bookings: {
                take: 10,
                orderBy: { createdAt: "desc" },
                include: { payment: true },
            },
        },
    });

    if (!customer || customer.role.name !== "GUEST") {
        throw new ApiError(404, "Customer not found");
    }

    res.status(200).json(new ApiResponse(200, customer, "Customer details retrieved"));
});

const getDashboardStats = asyncHandler(async (req, res) => {
    const adminId = req.user.id;

    const admin = await prisma.user.findUnique({
        where: { id: adminId },
        include: { role: true },
    });

    if (!admin || (admin.role.name !== "ADMIN" && admin.role.name !== "STAFF")) {
        throw new ApiError(403, "Access denied");
    }

    const [totalUsers, totalBookings, totalRevenue, recentBookings] = await prisma.$transaction([
        prisma.user.count({ where: { role: { name: "GUEST" }, deletedAt: null } }),
        prisma.booking.count(),
        prisma.payment.aggregate({
            where: { status: "SUCCESS" },
            _sum: { amount: true },
        }),
        prisma.booking.findMany({
            take: 5,
            orderBy: { createdAt: "desc" },
            include: { guest: { include: { guestProfile: true } }, roomType: true },
        }),
    ]);

    res.status(200).json(
        new ApiResponse(
            200,
            {
                totalUsers,
                totalBookings,
                totalRevenue: totalRevenue._sum.amount || 0,
                recentBookings,
            },
            "Dashboard stats retrieved"
        )
    );
});

export {
    getAdminProfile,
    updateAdminDetails,
    addStaff,
    getAllStaff,
    updateStaffDetails,
    disableStaffAccount,
    enableStaffAccount,
    getAllCustomers,
    disableCustomerAccount,
    enableCustomerAccount,
    getCustomerDetails,
    getDashboardStats,
};