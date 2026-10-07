// Async handler: forwards a rejected async handler to the global error middleware.
import { Request, Response, NextFunction, RequestHandler } from "express";

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
