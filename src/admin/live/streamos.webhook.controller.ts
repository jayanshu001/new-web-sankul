// StreamOS recording webhook (public, unauthenticated by Bearer): the legacy ?key= callback and
// StreamOS v1 HMAC-signed deliveries share one URL (POST /api/v1/webhooks/recording).
// Moved out of live.controller.ts so admin HTTP handlers and the provider callback stay apart.
import { Request, Response } from "express";
import crypto from "crypto";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { enrichMp4Sizes as streamosEnrichMp4Sizes } from "../../libs/streamos/streamos.service";
import * as adminLiveSql from "../../modules/admin-live/admin-live.service";
import { io, roomKey } from "../../socket/livechat.socket";
import { streamosV1WebhookSecret } from "../../config/streamos";
import { verifyStreamosSignature } from "../../utils/streamosSignature";
import {
  resolveSession as resolveV1Session,
  applyEvent as applyV1Event,
  isForeignEnvironment as isForeignV1Environment,
} from "./streamos.v1.webhook";

type ILiveSessionRecording = {
  quality?: string;
  file_size?: number;
  path: string;
};

// Legacy StreamOS doesn't sign callbacks, so the webhook URL is registered with
// `?key=<secret>`. When unset we warn but still accept (enforce-only-if-configured,
// like the Razorpay webhook); it must be set in production.
export const STREAMOS_WEBHOOK_SECRET = process.env.STREAMOS_WEBHOOK_SECRET || "";

function secretMatches(provided: string): boolean {
  if (provided.length !== STREAMOS_WEBHOOK_SECRET.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(provided),
    Buffer.from(STREAMOS_WEBHOOK_SECRET)
  );
}

// Streamos stream ids are strings (e.g. "T_17787583234029"). Accept a string
// or a number (legacy / loose callers) and return a trimmed non-empty string.
export function parseStreamIdParam(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
}

// StreamOS v1 deliveries share the legacy callback URL and are told apart by
// v1's headers. They are HMAC-signed, retried up to 6x with a stable
// X-Streamos-Delivery id, and expect a 2xx within 10 seconds.
const handleV1RecordingWebhook = async (req: Request, res: Response, traceId?: string) => {
  const event = String(req.headers["x-streamos-event"] ?? "");
  const deliveryId = String(req.headers["x-streamos-delivery"] ?? "");
  const signature = req.headers["x-streamos-signature"] as string | undefined;

  // No unauthenticated fallback: v1 signs every delivery, so an unverifiable one
  // is a misconfiguration or a forgery.
  const secret = streamosV1WebhookSecret();
  const verdict = verifyStreamosSignature((req as any).rawBody, signature, secret);
  if (!verdict.ok) {
    logger.warn("StreamOS v1 webhook rejected", { traceId, event, deliveryId, reason: verdict.reason });
    return res.status(401).json({ success: false, message: "Unauthorized." });
  }
  // Docs specify `{timestamp}.{rawBody}`; once a real delivery confirms
  // "timestamped", drop the body-only fallback in utils/streamosSignature.ts.
  logger.info("StreamOS v1 webhook verified", { traceId, event, deliveryId, scheme: verdict.scheme });

  const body = req.body ?? {};

  // Claim the delivery before any work: a re-run retry would duplicate Video rows.
  // Without the header, a payload-derived key still makes retries collide.
  const claimKey =
    deliveryId || `${event}:${String(body?.data?.recording?.asset_id ?? body?.data?.video?.id ?? "")}`;
  if (claimKey) {
    let firstTime = true;
    try {
      firstTime = await adminLiveSql.claimWebhookDelivery(claimKey, event || null);
    } catch (err) {
      // A failed claim must not drop the delivery — process it and accept the
      // (small) duplicate risk rather than losing the recording entirely.
      logger.error("StreamOS v1 delivery claim failed", { traceId, claimKey, error: getErrorMessage(err) });
    }
    if (!firstTime) {
      logger.info("StreamOS v1 webhook replay ignored", { traceId, event, deliveryId });
      return res.status(200).json({ success: true, message: "Already processed." });
    }
  }

  // Staging and production share one StreamOS organisation and API key, so drop
  // the other environment's deliveries before correlation (wrong-class attachment).
  if (isForeignV1Environment(body)) {
    logger.info("StreamOS v1 webhook ignored (other environment)", { traceId, event, deliveryId });
    return res.status(200).json({ success: true, message: "Acknowledged (other environment)." });
  }

  // Documented payloads carry no stream id; resolveSession tries several keys.
  const session = await resolveV1Session(body);
  if (!session) {
    // Ack so StreamOS stops retrying (it won't become attributable later); logged
    // at error because it needs a human.
    logger.error("StreamOS v1 webhook could not be correlated to a session", {
      traceId,
      event,
      deliveryId,
      dataKeys: Object.keys(body?.data ?? {}),
    });
    return res.status(200).json({ success: true, message: "Acknowledged (no matching session)." });
  }

  const result = await applyV1Event(body, session);
  if (!result.handled) {
    logger.warn("StreamOS v1 webhook not applied", { traceId, event, sessionId: session.id, reason: result.reason });
    return res.status(200).json({ success: true, message: `Acknowledged (${result.reason}).` });
  }

  // Notify viewers only once the recording is playable.
  if (event === "VIDEO_TRANSCODING_COMPLETED" && session.streamId) {
    const liveClassId = String(session.streamId);
    const fresh = await adminLiveSql.findSessionByAnyId(String(session.id));
    io?.to(roomKey(liveClassId)).emit("recordings_ready", {
      streamId: session.streamId,
      liveClassId,
      status: "READY",
      recordings: fresh ? adminLiveSql.hlsRecordingsOf(fresh) : [],
    });
  }

  logger.info("StreamOS v1 webhook applied", { traceId, event, sessionId: session.id, reason: result.reason });
  return res.status(200).json({ success: true, message: result.reason });
};

// Legacy deliveries authenticate with STREAMOS_WEBHOOK_SECRET via `?key=` or the
// `x-webhook-secret` header; otherwise a guessed streamId could inject recording
// URLs and auto-create Videos in course folders.
export const recordingWebhook = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("recordingWebhook invoked", { traceId, path: req.originalUrl });

  try {
    if (req.headers["x-streamos-event"] || req.headers["x-streamos-signature"]) {
      return await handleV1RecordingWebhook(req, res, traceId);
    }

    if (STREAMOS_WEBHOOK_SECRET) {
      const provided =
        (typeof req.query.key === "string" ? req.query.key : "") ||
        (typeof req.headers["x-webhook-secret"] === "string"
          ? (req.headers["x-webhook-secret"] as string)
          : "");
      if (!provided || !secretMatches(provided)) {
        logger.warn("recordingWebhook rejected missing secret", { traceId });
        return res.status(401).json({ success: false, message: "Unauthorized." });
      }
    } else {
      logger.warn(
        "Recording webhook: STREAMOS_WEBHOOK_SECRET is not set — accepting request unauthenticated. Set it in production."
      );
    }

    const streamId = parseStreamIdParam(req.body?.streamId);
    const rawRecordings = req.body?.recordings;

    if (!streamId) {
      logger.warn("recordingWebhook invalid streamId", { traceId, body: req.body });
      return res.status(400).json({ success: false, message: "Invalid streamId." });
    }
    if (!Array.isArray(rawRecordings)) {
      logger.warn("recordingWebhook recordings not array", { traceId, streamId });
      return res.status(400).json({ success: false, message: "recordings must be an array." });
    }

    // StreamOS has shipped paths with a stray trailing quote (`"`, `%22`, or
    // double-encoded `%2522`); strip it so we don't persist unplayable URLs.
    const stripTrailingQuote = (s: string) => s.replace(/(?:"|%22|%2522)+$/i, "");
    const normalizeRecs = (raw: any): ILiveSessionRecording[] =>
      (Array.isArray(raw) ? raw : [])
        .filter((r: any) => r && typeof r.path === "string" && r.path.length > 0)
        .map((r: any) => ({
          quality: typeof r.quality === "string" ? r.quality : undefined,
          file_size: typeof r.file_size === "number" ? r.file_size : Number(r.file_size) || undefined,
          path: stripTrailingQuote(r.path),
        }));

    const recordings: ILiveSessionRecording[] = normalizeRecs(rawRecordings);
    // Persisted only when present so a callback without mp4Links doesn't clobber
    // an mp4 captured via the poll path. file_size comes from Content-Length
    // (StreamOS omits it on mp4Links).
    const mp4Recordings: ILiveSessionRecording[] = await streamosEnrichMp4Sizes(
      normalizeRecs(req.body?.mp4Links ?? req.body?.mp4links)
    );

      const updatedSql = await adminLiveSql.updateByStreamId(streamId, {
        recordings,
        status: "READY",
        ...(mp4Recordings.length > 0 ? { mp4Recordings } : {}),
      });
      if (!updatedSql) {
        logger.warn("recordingWebhook stream not found", { traceId, streamId });
        return res.status(200).json({ success: true, message: "Acknowledged (no matching stream)." });
      }
      // Best-effort, never throws.
      await adminLiveSql.maybeAutoPromoteRecordingSql({
        sessionId: updatedSql.id,
        sessionTitle: updatedSql.title ?? null,
        recordings,
      });
      const liveClassIdSql = String(streamId);
      io?.to(roomKey(liveClassIdSql)).emit("recordings_ready", {
        streamId,
        liveClassId: liveClassIdSql,
        status: "READY",
        recordings,
      });
      logger.info("recordingWebhook success", { traceId, streamId, recordingCount: recordings.length });
      return res.status(200).json({ success: true, message: "Recording saved." });
  } catch (err) {
    logger.error("recordingWebhook failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return res.status(200).json({ success: false, message: "Internal error logged." });
  }
};
