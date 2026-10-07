// Client lecture audio notes: Zod request schemas.
import { z } from "zod";

// Accepts a 24-hex legacy id or a numeric id (ws_video / ws_live_session ints).
const objectId = z.string().regex(/^([0-9a-fA-F]{24}|\d+)$/, "Invalid id");

// Multipart fields arrive as strings, so numbers are coerced here.
const timestampSec = z.coerce.number().int().min(0).max(60 * 60 * 24);
// FE may report a fractional length ("42.7") but `duration_sec` is INT: an unfloored
// value fails the Prisma create (500 + uploaded file deleted). 0 stays legal so a
// sub-second note is not lost.
const durationSec = z.coerce.number().min(0).max(60 * 60 * 24).transform(Math.floor);
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
