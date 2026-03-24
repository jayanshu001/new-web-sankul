// src/middlewares/authenticate.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { failure } from "../utils/httpResponse";

// augment Request to carry the decoded user
declare module "express-serve-static-core" {
  interface Request {
    user?: { id: string; email: string; role?: string; [k: string]: any };
  }
}

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET as string;

const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  // Let CORS preflight through
  if (req.method === "OPTIONS") return next();

  // Expect "Authorization: Bearer <token>"
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : undefined;

  if (!token) {
    return failure(res, "Authentication token is required", 401);
  }

  try {
    const decoded = jwt.verify(token, JWT_ACCESS_SECRET) as any;
    req.user = decoded; // { id, email, ... } per your signTokens payload
    return next();
  } catch {
    return failure(res, "Invalid or expired token", 401);
  }
};

export default authenticate;
