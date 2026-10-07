// Client lecture notes: Zod request schemas.
import { z } from "zod";

// Accepts legacy 24-hex ids as well as numeric ids.
const objectId = z.string().regex(/^([0-9a-fA-F]{24}|\d+)$/, "Invalid id");

// Capped at 24h, matching LectureProgress.
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

// Bulk-delete a saved-material group (all text + audio notes). Exactly one id, matching
// `kind`, is required. Accepts body or query string (see controller).
export const deleteSavedMaterialSchema = z
  .object({
    kind: z.enum(["recorded", "live", "course", "live_course"]),
    videoId: objectId.optional(),
    liveSessionId: objectId.optional(),
    courseId: objectId.optional(),
    liveCourseId: objectId.optional(),
  })
  .superRefine((val, ctx) => {
    const required: Record<typeof val.kind, "videoId" | "liveSessionId" | "courseId" | "liveCourseId"> = {
      recorded: "videoId",
      live: "liveSessionId",
      course: "courseId",
      live_course: "liveCourseId",
    };
    const field = required[val.kind];
    if (!val[field]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: `kind and ${field} are required for ${val.kind} materials`,
      });
    }
  });
