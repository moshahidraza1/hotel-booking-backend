import * as jwt from "jsonwebtoken";
import { randomUUID } from "crypto";

// CONFIGURATION & VALIDATION
const JWT_CONFIG = {
  accessSecret: process.env.JWT_ACCESS_SECRET,
  refreshSecret: process.env.JWT_REFRESH_SECRET,
  accessTTL: process.env.JWT_ACCESS_TTL || "15m",
  refreshTTL: process.env.JWT_REFRESH_TTL || "7d",
  issuer: process.env.JWT_ISSUER || "hotel-booking-api",
  audience: process.env.JWT_AUDIENCE || "hotel-booking-clients",
  algorithm: "HS256",
};

// Fail fast: Verify secrets exist at startup
if (!JWT_CONFIG.accessSecret || !JWT_CONFIG.refreshSecret) {
  throw new Error("FATAL: JWT_ACCESS_SECRET or JWT_REFRESH_SECRET is missing.");
}

// UTILITIES
const generateAccessToken = (userId, role) => {
  const payload = {
    sub: userId,
    role,
    type: "access",
  };

  return jwt.sign(payload, JWT_CONFIG.accessSecret, {
    expiresIn: JWT_CONFIG.accessTTL,
    issuer: JWT_CONFIG.issuer,
    audience: JWT_CONFIG.audience,
    algorithm: JWT_CONFIG.algorithm,
    jwtid: randomUUID(),
  });
};

const generateRefreshToken = (userId, role) => {
  const jti = randomUUID();
  const payload = {
    sub: userId,
    role,
    type: "refresh",
    jti,
  };

  return jwt.sign(payload, JWT_CONFIG.refreshSecret, {
    expiresIn: JWT_CONFIG.refreshTTL,
    issuer: JWT_CONFIG.issuer,
    audience: JWT_CONFIG.audience,
    algorithm: JWT_CONFIG.algorithm,
    jwtid: jti,
  });
};

const verifyAccessToken = (token) => {
  const decoded = jwt.verify(token, JWT_CONFIG.accessSecret, {
    issuer: JWT_CONFIG.issuer,
    audience: JWT_CONFIG.audience,
    algorithms: [JWT_CONFIG.algorithm],
  });

  if (decoded.type !== "access") {
    throw new jwt.JsonWebTokenError("Invalid token type: expected 'access'");
  }
  return decoded;
};

const verifyRefreshToken = (token) => {
  const decoded = jwt.verify(token, JWT_CONFIG.refreshSecret, {
    issuer: JWT_CONFIG.issuer,
    audience: JWT_CONFIG.audience,
    algorithms: [JWT_CONFIG.algorithm],
  });

  if (decoded.type !== "refresh") {
    throw new jwt.JsonWebTokenError("Invalid token type: expected 'refresh'");
  }
  return decoded;
};

const parseBearer = (authHeader) => {
  if (!authHeader || typeof authHeader !== "string") {
    return null;
  }
  const parts = authHeader.split(" ");
  if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
    return parts[1];
  }
  return null;
};

export {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  parseBearer,
};
