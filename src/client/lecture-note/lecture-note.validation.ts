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

// Bulk-delete a saved-material group (all text + audio notes). Mirrors the
// `kind` + id fields a saved-materials row carries. Exactly one id is required,
// matching the kind. Accepts body OR query-string (see controller).
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
