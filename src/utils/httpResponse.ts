// HTTP response envelope: success()/failure() helpers and Zod error flattening.
import { Response } from "express";

import { ZodError } from "zod";

interface ResponseData {
  success: boolean;
  code: number;
  data: object;
  message: string;
  messages: object;
}

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
 * Failure response that honors a thrown 4xx error's own status + message; any
 * other error gets the generic fallback so internals never leak to the client.
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
 * Flatten a ZodError into `{ message, errors }`: `message` is the first issue's
 * message, `errors` maps each field path to its first message.
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
 * Flatten raw Zod `issues` into a `field -> message` map (the `errors` shape of
 * the admin role/permission/video controllers' 422s).
 *
 * Not interchangeable with `formatZodError`: a root issue keys as "" here (vs
 * "_"), and the last issue per field wins here (vs the first).
 */
export const formatZodIssues = (
  issues: { path: (string | number)[]; message: string }[]
): Record<string, string> =>
  issues.reduce<Record<string, string>>((acc, i) => {
    acc[i.path.join(".")] = i.message;
    return acc;
  }, {});

export type ActionError = readonly [status: number, message: string, field?: string];

export const actionFailure = (res: Response, [status, message, field]: ActionError): Response =>
  failure(res, message, status, field ? { [field]: message } : {});
