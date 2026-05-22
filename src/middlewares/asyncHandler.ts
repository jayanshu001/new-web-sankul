// src/middlewares/asyncHandler.ts
import { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Wraps an async route handler so any thrown error / rejected promise is
 * forwarded to Express's global error middleware. Removes the need for
 * per-handler try/catch boilerplate.
 *
 * Usage:
 *   router.get("/", asyncHandler(async (req, res) => { ... }))
 */
type AsyncHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<unknown> | unknown;

export const asyncHandler =
  (fn: AsyncHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export default asyncHandler;
