import { z } from "zod";

// Accept a 24-hex Mongo ObjectId OR a numeric MySQL id: this module runs on MySQL,
// so ids like "33141" (ws_video / ws_live_session ints) are valid.
const objectId = z.string().regex(/^([0-9a-fA-F]{24}|\d+)$/, "Invalid id");

// Sanity cap matches LectureProgress's 24h ceiling. Notes taken inside a
// player can't realistically be past that.
const timestampSec = z.number().int().min(0).max(60 * 60 * 24);

const content = z.string().trim().min(1, "Note cannot be empty").max(5000);

export const createNoteSchema = z
  .object({
    lectureType: z.enum(["recorded", "live"]),
    videoId: objectId.optional(),
    liveSessionId: objectId.optional(),
    timestampSec,
    content,
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

export const updateNoteSchema = z
  .object({
    content: content.optional(),
    timestampSec: timestampSec.optional(),
  })
  .refine((v) => v.content !== undefined || v.timestampSec !== undefined, {
    message: "Nothing to update",
  });

export const listNotesQuerySchema = z
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

export const noteIdParamSchema = z.object({ id: objectId });
