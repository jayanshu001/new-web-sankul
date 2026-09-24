import { HttpError } from "../../middlewares/errorHandler";

export const orNotFound = <T>(data: T | null, message: string): T => {
  if (!data) throw new HttpError(404, message);
  return data;
};

export const OPENING_NOT_FOUND = "Career opening not found.";
export const APPLICATION_NOT_FOUND = "Application not found.";
