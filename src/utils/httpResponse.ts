import { Response } from "express";

import { ZodError } from "zod";

// Define the response data structure
interface ResponseData {
  success: boolean;
  code: number;
  data: object;
  message: string;
  messages: object;
}

// Success response helper
export const success = (
  res: Response,
  data: object = {},
  message: string = "",
  status: number = 200,
  multipleMessages: object = {}
): Response => {
  const responseData: ResponseData = {
    success: true,
    code: status,
    data: Object.keys(data).length === 0 ? {} : data,
    message: message,
    messages:
      Object.keys(multipleMessages).length === 0 ? {} : multipleMessages,
  };

  return res.status(status).json(responseData);
};

// Failure response helper
export const failure = (
  res: Response,
  message: string = "An error occurred",
  status: number = 400,
  multipleMessages: object = {},
  data: object = {}
): Response => {
  if (message === "The given data was invalid.") {
    message = "Please fill in all the required details.";
  }

  const responseData: ResponseData = {
    success: false,
    code: status,
    data: Object.keys(data).length === 0 ? {} : data,
    message: message,
    messages:
      Object.keys(multipleMessages).length === 0 ? {} : multipleMessages,
  };

  return res.status(status).json(responseData);
};

/**
 * Failure response that honors a thrown `HttpError`'s own status + message,
 * falling back to a generic message otherwise.
 *
 * Use in a controller catch that would otherwise blanket-500: a boundary
 * validator throwing 422 ("Invalid status ...") is only useful if the catch
 * doesn't flatten it into an opaque 500. Unknown errors keep the generic
 * fallback so internals are never leaked to the client.
 *
 *   } catch (err) {
 *     logger.error(...);
 *     return failureFrom(res, err, "Failed to list subscriptions.");
 *   }
 */
export const failureFrom = (
  res: Response,
  error: unknown,
  fallbackMessage: string,
  fallbackStatus: number = 500
): Response => {
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500)
    return failure(res, getErrorMessage(error), statusCode);
  return failure(res, fallbackMessage, fallbackStatus);
};

// Helper to get a standard error message
export const getErrorMessage = (error: unknown): string => {
  let message: string;

  if (error instanceof Error) {
    message = error.message;
  } else if (error && typeof error === "object" && "message" in error) {
    message = String(error["message"]);
  } else if (typeof error === "string") {
    message = error;
  } else {
    message = "Something went wrong! Please try again Later!";
  }
  return message;
};

/**
 * Flatten a ZodError into a user-friendly `{ message, errors }` pair instead of
 * leaking the raw `error.issues` blob to the client. `message` is the first
 * issue's message (schemas should carry human-readable messages — see the
 * create-order schemas); `errors` maps each field path → its first message.
 *
 * Use in a controller catch block:
 *   if (e instanceof ZodError) {
 *     const { message, errors } = formatZodError(e);
 *     return res.status(400).json({ success: false, message, errors });
 *   }
 */
export const formatZodError = (
  error: ZodError
): { message: string; errors: Record<string, string> } => {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!errors[key]) errors[key] = issue.message;
  }
  return {
    message: error.issues[0]?.message || "Please check the details and try again.",
    errors,
  };
};

/**
 * Flatten raw Zod `issues` into a `field -> message` map.
 *
 * This is the shape the admin RBAC-ish controllers (role, permission,
 * permissionCategory, video, videoCategory) return under `errors` in their
 * hand-rolled 422s. It was copy-pasted identically into all five; this is that
 * exact function, unchanged.
 *
 * NOTE it deliberately differs from `formatZodError` above in two ways, so the
 * two are NOT interchangeable:
 *   - a root-level issue keys as "" here, but "_" in formatZodError;
 *   - on two issues for one field, the LAST wins here, the FIRST there.
 * Both are reachable, so neither was normalised onto the other.
 */
export const formatZodIssues = (
  issues: { path: (string | number)[]; message: string }[]
): Record<string, string> =>
  issues.reduce<Record<string, string>>((acc, i) => {
    acc[i.path.join(".")] = i.message;
    return acc;
  }, {});
