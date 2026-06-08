// src/admin/uploads/uploads.controller.ts
//
// Issues presigned URLs so the admin dashboard can upload large files (e.g.
// eBook book PDFs up to 500 MB) directly to DigitalOcean Spaces, bypassing
// this server. See src/utils/presignUpload.ts for the full rationale.

import { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { success, failure } from "../../utils/httpResponse";
import {
  buildPresignedUpload,
  PRESIGN_KINDS,
  PRESIGN_MAX_BYTES,
} from "../../utils/presignUpload";

const presignSchema = z.object({
  kind: z.enum(PRESIGN_KINDS as [string, ...string[]]),
  fileName: z.string().min(1, "fileName is required"),
  contentType: z.string().min(1, "contentType is required"),
  fileSize: z.coerce
    .number()
    .int()
    .positive("fileSize must be a positive integer (bytes)")
    .max(PRESIGN_MAX_BYTES, "fileSize exceeds the maximum allowed."),
});

export const createPresignedUpload = asyncHandler(
  async (req: Request, res: Response) => {
    const parsed = presignSchema.safeParse(req.body);
    if (!parsed.success) {
      return failure(
        res,
        parsed.error.issues[0]?.message || "Invalid request.",
        422
      );
    }

    try {
      const result = await buildPresignedUpload(parsed.data as any);
      return success(res, result, "Presigned upload URL created.");
    } catch (err: any) {
      return failure(res, err?.message || "Could not create upload URL.", 400);
    }
  }
);
