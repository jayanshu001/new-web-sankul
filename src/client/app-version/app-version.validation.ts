import { z } from "zod";

// Query for GET /api/v1/client/app-version/check
// Coerces the numeric build code from the query string and normalizes platform.
export const checkAppVersionQuerySchema = z
  .object({
    platform: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.enum(["ios", "android"], { errorMap: () => ({ message: "platform must be 'ios' or 'android'" }) })),
    currentVersion: z.coerce
      .number({ invalid_type_error: "currentVersion must be a number" })
      .int("currentVersion must be an integer")
      .min(0, "currentVersion cannot be negative")
      .default(0),
    currentVersionName: z
      .string()
      .trim()
      .max(50, "currentVersionName too long")
      .regex(/^[0-9]+(\.[0-9]+)*$/, "currentVersionName must look like 1.2.3")
      .optional(),
  })
  .strict();

export type CheckAppVersionQuery = z.infer<typeof checkAppVersionQuerySchema>;
