import { z } from "zod";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

// Body fields arrive as strings because of multipart/form-data. We coerce
// here rather than relying on JSON parsing.
const timestampSec = z.coerce.number().int().min(0).max(60 * 60 * 24);
const durationSec = z.coerce.number().min(0).max(60 * 60 * 24);
const title = z.string().trim().max(200);

export const createAudioNoteBodySchema = z
  .object({
    lectureType: z.enum(["recorded", "live"]),
    videoId: objectId.optional(),
    liveSessionId: objectId.optional(),
    timestampSec,
    title: title.optional(),
    durationSec: durationSec.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.lectureType === "recorded" && !val.videoId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["videoId"],
        message: "videoId is required for recorded lectures",
      });
    }
    if (val.lectureType === "live" && !val.liveSessionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["liveSessionId"],
        message: "liveSessionId is required for live lectures",
      });
    }
  });

export const updateAudioNoteBodySchema = z
  .object({
    title: title.optional(),
    timestampSec: timestampSec.optional(),
  })
  .refine((v) => v.title !== undefined || v.timestampSec !== undefined, {
    message: "Nothing to update",
  });

export const listAudioNotesQuerySchema = z
  .object({
    lectureType: z.enum(["recorded", "live"]),
    videoId: objectId.optional(),
    liveSessionId: objectId.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.lectureType === "recorded" && !val.videoId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["videoId"],
        message: "videoId is required for recorded lectures",
      });
    }
    if (val.lectureType === "live" && !val.liveSessionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["liveSessionId"],
        message: "liveSessionId is required for live lectures",
      });
    }
  });

export const audioNoteIdParamSchema = z.object({ id: objectId });
