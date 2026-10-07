// Request validation: Zod body/query/params middleware.
import { Request, Response, NextFunction, RequestHandler } from "express";
import { ZodError, ZodSchema } from "zod";
import { failure } from "../utils/httpResponse";

/**
 * Validates body/query/params against Zod schemas (pass `.strict()` to reject unknown
 * fields). Failure: 422 with a flat `field -> message` map under `messages`. Success:
 * replaces the request slice with the parsed (coerced/defaulted) value.
 */
export const validate = (schemas: {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      // Express 5's `req.query` is a getter-only prototype accessor; assigning it throws
      // at runtime (invisible to typecheck). An own property shadows the getter.
      if (schemas.query) {
        Object.defineProperty(req, "query", {
          value: schemas.query.parse(req.query),
          writable: true,
          enumerable: true,
          configurable: true, // so a second validate() on the same route can redefine
        });
      }
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
