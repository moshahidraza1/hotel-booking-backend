import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { verifyAccessToken, parseBearer } from "../utils/tokenService.js";
import { prisma } from "../db/db.config.js";
import { ApiResponse } from "../utils/ApiResponse.js";

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

const verifyAdmin = asyncHandler(async(req,res,next) => {

    if(!req.user || !req.user.id){
      throw new ApiError(401, "Authentication required");
    }

    const user = await prisma.user.findUnique({
      where: {id: req.user.id},
      include: {
        role: {
          select: {
            name: true
          }
        } 
      }
    });
    if(!user || user.deletedAt){
      throw new ApiError(404, "User Not Found or deleted");
    }
    if(user.role.name!=="ADMIN"){
      throw new ApiError(403, "Only Admin can access this route");
    }
    next();
});

const verifyAdminOrStaff = asyncHandler(async(req,res,next) => {
  if(!req.user || !req.user.id){
      throw new ApiError(401, "Authentication required");
    }

    const user = await prisma.user.findUnique({
      where: {id: req.user.id},
      include: {
        role: { 
          select: {
            name: true
          }
        } 
      }
    });
    if(!user || user.deletedAt){
      throw new ApiError(404, "User Not Found or deleted");
    }
    if(user.role.name!=="ADMIN" && user.role.name!=="STAFF"){
      throw new ApiError(403, "Only Admin and Staff can access this route");
    }
    next();
});


export { verifyJWT, verifyAdmin, verifyAdminOrStaff };
