import { z } from "zod";

/**
 * GET /api/v1/client/live-sessions/:id?liveCourseId=<id>
 *
 * `liveCourseId` is the ENTRY POINT, not a permission: it says which live course
 * the student tapped through from. Supplied → entitlement is judged against that
 * course alone. Omitted → the Live Now entry point, where every linked course is
 * considered. See the controller for the access decision.
 *
 * Non-numeric / non-positive values are a client bug, so they 422 here rather
 * than being silently ignored (which would upgrade a preview to a full stream).
 * Whether the course is actually LINKED to the session is a data question the
 * controller answers — it 404s.
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
 * The preview endpoints take the SAME `?liveCourseId` entry point as the join
 * above, and for the same reason: a heartbeat judged against every linked course
 * would report `full` — and silently stop metering — for a student who owns one
 * linked course but is previewing through a different, unpurchased one.
 */
export const previewTrackingQuerySchema = getLiveSessionQuerySchema;

/**
 * POST /api/v1/client/live-sessions/:id/preview/heartbeat
 *
 * `previewTrackingId` is required and must be the value handed out by the join
 * response. It is a correlation check, not an authorisation one (entitlement is
 * always re-derived from the bearer token) — it catches an app heartbeating the
 * wrong session, which would otherwise quietly drain the wrong trial.
 *
 * `isPlaying` defaults to `true` because that is the only reason to send a
 * heartbeat at all; `false` is accepted and handled exactly like /preview/stop,
 * so a pause is metered even if the app never manages to call stop.
 *
 * Note there is deliberately NO client-supplied "seconds watched" field: the
 * server derives consumption from its own timestamps, so the trial length cannot
 * be extended by a patched client.
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
