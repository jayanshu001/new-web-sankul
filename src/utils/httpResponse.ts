import { Response } from "express";
import { AxiosError } from "axios";
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

// Helper to get an error message from Axios errors
export const getAxiosErrorMessage = (error: unknown): string => {
  if (error instanceof AxiosError) {
    if (error.response && error.response.data) {
      const axiosErrorMessage = (error.response.data as { message?: string })
        .message;
      return axiosErrorMessage || "An error occurred during the request.";
    }
    return error.message;
  }

  return "Something went wrong! Please try again later.";
};
