// Client live sessions: Zod schemas for the join and preview endpoints.
import { z } from "zod";

/**
 * GET /api/v1/client/live-sessions/:id?liveCourseId=<id>
 *
 * `liveCourseId` is the entry point, not a permission: supplied, entitlement is
 * judged against that course alone; omitted (Live Now), every linked course counts.
 * Invalid values 422 rather than being ignored, which would upgrade a preview to a
 * full stream. An unlinked course is a 404 from the controller.
 */
export const getLiveSessionQuerySchema = z
  .object({
    liveCourseId: z.coerce
      .number({ invalid_type_error: "liveCourseId must be a number." })
      .int("liveCourseId must be an integer.")
      .positive("liveCourseId must be a positive integer.")
      .optional(),
  })
  .passthrough();

/**
 * Preview endpoints take the same entry point: judged against every linked course,
 * a student owning one course but previewing through an unpurchased one would get
 * `full` and silently stop being metered.
 */
export const previewTrackingQuerySchema = getLiveSessionQuerySchema;

/**
 * POST /api/v1/client/live-sessions/:id/preview/heartbeat
 *
 * `previewTrackingId` (from the join response) is a correlation check, not authz:
 * it stops an app heartbeating the wrong session and draining the wrong trial.
 * `isPlaying: false` is handled like /preview/stop, so a pause is metered even if
 * stop is never called. There is deliberately no client "seconds watched" field;
 * the server derives consumption from its own timestamps.
 */
export const previewHeartbeatBodySchema = z
  .object({
    previewTrackingId: z
      .string({ required_error: "previewTrackingId is required.", invalid_type_error: "previewTrackingId must be a string." })
      .trim()
      .min(1, "previewTrackingId is required."),
    isPlaying: z.boolean({ invalid_type_error: "isPlaying must be a boolean." }).optional().default(true),
  })
  .passthrough();

/** POST /api/v1/client/live-sessions/:id/preview/stop — idempotent; see the service. */
export const previewStopBodySchema = z
  .object({
    previewTrackingId: z
      .string({ required_error: "previewTrackingId is required.", invalid_type_error: "previewTrackingId must be a string." })
      .trim()
      .min(1, "previewTrackingId is required."),
  })
  .passthrough();
