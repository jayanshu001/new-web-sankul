// src/middlewares/authenticate.ts
import { Request, Response, NextFunction } from "express";
import { failure } from "../utils/httpResponse";
import { redisClient } from "../config/redis";
import { verifyAccessToken } from "../utils/jwtSigner";
import { isRevoked, UserType } from "../libs/tokenRevocation";
import { updateContext } from "../utils/requestContext";

// Augment Request to carry the decoded token payload
declare module "express-serve-static-core" {
  interface Request {
    user?: {
      id: string;
      phone?: string;
      email?: string;
      role: "customer" | "admin" | "super_admin" | "editor" | "educator" | "promoter";
      [k: string]: any;
    };
  }
}

/**
 * Verifies the Bearer JWT and attaches decoded payload to req.user.
 * Works for both customer tokens (role: "customer") and admin tokens
 * (role: "admin" | "super_admin" | "editor").
 *
 * Verification consults the access-key ring (utils/jwtSigner.ts) so we can
 * rotate JWT secrets without invalidating existing sessions. Tokens with a
 * `kid` header are checked against the ring; legacy tokens (no kid) are
 * verified with the ring's legacy secret (= JWT_ACCESS_SECRET).
 */
const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  // Let CORS preflight through
  if (req.method === "OPTIONS") return next();

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : undefined;

  if (!token) {
    return failure(res, "Authentication token is required.", 401);
  }

  try {
    const decoded = verifyAccessToken<any>(token);
    const role = decoded.role ?? "customer";

    // Coarse revocation check: if the user has triggered "logout all devices"
    // (or a password change / forced re-auth event), every token issued
    // before the cutoff is rejected. See libs/tokenRevocation.ts. This is
    // additive to the single-device session-pointer check below; either can
    // independently invalidate a token.
    const userType = (decoded.type ?? "customer") as UserType;
    if (await isRevoked(userType, decoded.id, decoded.iat)) {
      return failure(res, "Session was revoked. Please log in again.", 401);
    }

    // Enforce 1 active device rule for customers
    if (decoded.type === "customer") {
      const activeToken = await redisClient.get(`customer_session:${decoded.id}`);
      if (!activeToken || activeToken !== token) {
        return failure(res, "Session expired or logged in on another device.", 401);
      }
    }

    // Enforce 1 active device rule for admins
    // Disabled: admins may stay logged in on multiple devices simultaneously.
    // The DB-side invalidation in adminLogin is also disabled; coarse revocation
    // (logout-all / password change) above still applies.
    // if (decoded.type === "admin") {
    //   const activeAdminToken = await redisClient.get(`admin_session:${decoded.id}`);
    //   if (!activeAdminToken || activeAdminToken !== token) {
    //     return failure(res, "Admin session expired or logged in elsewhere.", 401);
    //   }
    // }

    // Enforce 1 active device rule for educators
    if (decoded.type === "educator") {
      const activeEducatorToken = await redisClient.get(`educator_session:${decoded.id}`);
      if (!activeEducatorToken || activeEducatorToken !== token) {
        return failure(res, "Educator session expired or logged in elsewhere.", 401);
      }
    }

    // Enforce 1 active device rule for promoters
    if (decoded.type === "promoter") {
      const activePromoterToken = await redisClient.get(`promoter_session:${decoded.id}`);
      if (!activePromoterToken || activePromoterToken !== token) {
        return failure(res, "Promoter session expired or logged in elsewhere.", 401);
      }
    }

    req.user = {
      id: decoded.id,
      phone: decoded.phone,
      email: decoded.email,
      role: role,
      ...decoded,
    };

    // Surface the authenticated user into the per-request context so every
    // downstream log line automatically carries `userId` + `userRole`
    // without callers threading them through. See utils/requestContext.ts.
    updateContext({ userId: decoded.id, userRole: role });

    return next();
  } catch {
    return failure(res, "Invalid or expired token.", 401);
  }
};

/**
 * Middleware factory — restrict access to specific roles.
 * Usage: router.get("/admin-only", authenticate, requireRole("admin", "super_admin"), handler)
 */
export const requireRole = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return failure(res, "Access denied. Insufficient permissions.", 403);
    }
    return next();
  };
};

export default authenticate;

