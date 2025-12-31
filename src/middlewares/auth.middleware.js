import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { verifyAccessToken, parseBearer } from "../utils/tokenService.js";
import { prisma } from "../db/db.config.js";

const verifyJWT = asyncHandler(async (req, res, next) => {
  const token = req.cookies?.accessToken || parseBearer(req.headers.authorization);

  if (!token) {
    throw new ApiError(401, "Unauthorized access");
  }

  try {
    const decoded = verifyAccessToken(token);

    // Verify user exists in database 
    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      include: { role: true },
    });

    if (!user || user.deletedAt) {
      throw new ApiError(401, "User not found or inactive");
    }

    req.user = { id: user.id, email: user.email, role: user.role.name };
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      throw new ApiError(401, "Access token expired");
    }
    throw new ApiError(401, "Invalid token");
  }
});

export { verifyJWT };
