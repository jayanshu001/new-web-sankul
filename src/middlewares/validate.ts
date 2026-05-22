// src/middlewares/validate.ts
import { Request, Response, NextFunction, RequestHandler } from "express";
import { ZodError, ZodSchema } from "zod";
import { failure } from "../utils/httpResponse";

/**
 * Validate `req.body`, `req.query`, and/or `req.params` against Zod schemas.
 * Unknown fields are rejected by passing a `.strict()` object schema in.
 *
 * On failure: responds 422 with a flat `field -> message` map under `messages`.
 * On success: replaces the request slice with the parsed (coerced/defaulted)
 * value, so downstream handlers receive typed input.
 */
export const validate = (schemas: {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.query) req.query = schemas.query.parse(req.query) as any;
      if (schemas.params) req.params = schemas.params.parse(req.params) as any;
      return next();
    } catch (err) {
      if (err instanceof ZodError) {
        const messages: Record<string, string> = {};
        for (const issue of err.issues) {
          const key = issue.path.join(".") || "_";
          if (!messages[key]) messages[key] = issue.message;
        }
        return failure(res, "Validation failed.", 422, messages);
      }
      return next(err);
    }
  };
};

export default validate;
