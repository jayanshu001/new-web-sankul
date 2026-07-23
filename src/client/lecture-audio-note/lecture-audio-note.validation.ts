import { z } from "zod";

// Accept a 24-hex Mongo ObjectId OR a numeric MySQL id: this module runs on MySQL,
// so ids like "33141" (ws_video / ws_live_session ints) are valid.
const objectId = z.string().regex(/^([0-9a-fA-F]{24}|\d+)$/, "Invalid id");

// Body fields arrive as strings because of multipart/form-data. We coerce
// here rather than relying on JSON parsing.
const timestampSec = z.coerce.number().int().min(0).max(60 * 60 * 24);
// Audio-note length in seconds. FE measures the recording and may report a
// fractional value ("42.7"); `duration_sec` is an INT column, so floor here —
// an unfloored float reached Prisma as a non-integer and blew up the whole
// create (500 + the just-uploaded file cleaned off S3). 0 stays legal: a
// sub-second note floors to 0 and must not cost the user the recording.
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
