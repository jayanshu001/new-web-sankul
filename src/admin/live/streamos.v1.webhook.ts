// StreamOS v1 webhook: recording event handling. Differences from the legacy callback:
//  1. Recordings arrive in two events: LIVESTREAM_RECORDING_READY (still
//     transcoding) then VIDEO_TRANSCODING_COMPLETED (playable). Only the second
//     may mark a session READY.
//  2. Deliveries retry up to 6 times with the same X-Streamos-Delivery id, and
//     handling creates Video rows, so each delivery is claimed once first.
//  3. Correlation is via `data.stream.stream_key` (not the public_id stored as
//     `streamId`), hence ws_live_session's own `stream_key` column. RECORDING_READY
//     may carry only `recording.asset_id`; that is tolerable since it only stores a
//     pointer, and resolveSession keeps fallback keys for trimmed deliveries.

import logger from "../../utils/logger";
import * as adminLiveSql from "../../modules/admin-live/admin-live.service";
import { getRecordingByAssetId } from "./streamos.provider";
import { streamosEnvTag } from "../../config/streamos";
import type { LiveSession } from "@prisma/client";

export interface V1WebhookBody {
  event?: string;
  created_at?: string;
  data?: Record<string, any>;
}

const asString = (v: unknown): string | null => {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
};

const tagValue = (data: Record<string, any> | undefined, key: string): string | null => {
  for (const bag of [data?.stream?.tags, data?.video?.tags, data?.recording?.tags, data?.tags]) {
    const v = asString(bag?.[key]);
    if (v) return v;
  }
  return null;
};

/**
 * Staging and production share one StreamOS organisation and API key, so a delivery
 * tagged with a different `wsEnv` must be ignored, not merely unmatched (an id
 * collision could attach a staging recording to a real class). Untagged deliveries
 * (legacy, pre-tag, dashboard-created streams) are treated as ours.
 */
export const isForeignEnvironment = (body: V1WebhookBody): boolean => {
  const tag = tagValue(body.data, "wsEnv");
  return tag != null && tag !== streamosEnvTag();
};

const sessionIdFromTags = (data: Record<string, any> | undefined): number | null => {
  const raw = tagValue(data, "wsSessionId");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** The documented correlation field: the stream KEY, not the public_id stored as `streamId`. */
const streamKeyFromBody = (data: Record<string, any> | undefined): string | null =>
  asString(data?.stream?.stream_key) ?? asString(data?.recording?.stream_key);

/** Fallback only. */
const streamIdFromBody = (data: Record<string, any> | undefined): string | null =>
  asString(data?.stream?.public_id) ??
  asString(data?.stream?.id) ??
  asString(data?.recording?.stream_public_id) ??
  asString(data?.video?.stream_public_id) ??
  asString(data?.livestream?.public_id);

export const assetIdFromBody = (data: Record<string, any> | undefined): string | null =>
  asString(data?.recording?.asset_id) ?? asString(data?.video?.id) ?? asString(data?.asset?.public_id);

/**
 * Tries each correlation key in order of reliability. Returns null when none match;
 * the caller acks 200 since an unattributable recording is a wiring problem, not
 * a transient failure.
 */
export const resolveSession = async (body: V1WebhookBody): Promise<LiveSession | null> => {
  const data = body.data;

  // Logs which key matched, to settle the open question in STREAMOS_V1_QUESTIONS.md
  // (whether `stream_key` is actually present); then the losing branches can go.
  const found = (via: string, session: LiveSession): LiveSession => {
    logger.info("StreamOS v1 webhook correlated", {
      via,
      event: body.event ?? null,
      sessionId: session.id,
    });
    return session;
  };

  const streamKey = streamKeyFromBody(data);
  if (streamKey) {
    const byKey = await adminLiveSql.findSessionByStreamKey(streamKey);
    if (byKey) return found("stream_key", byKey);
  }

  // Our id echoed via customTags resolves events with no `stream` object.
  const taggedId = sessionIdFromTags(data);
  if (taggedId != null) {
    const byId = await adminLiveSql.findSessionByAnyId(String(taggedId));
    if (byId) return found("customTags.wsSessionId", byId);
  }

  const streamId = streamIdFromBody(data);
  if (streamId) {
    const byStream = await adminLiveSql.findSessionByAnyId(streamId);
    if (byStream) return found("stream.public_id", byStream);
  }

  // Works once LIVESTREAM_ENDED or RECORDING_READY has stamped recorded_asset_id.
  const assetId = assetIdFromBody(data);
  if (assetId) {
    const byAsset = await adminLiveSql.findSessionByRecordedAssetId(assetId);
    if (byAsset) return found("recorded_asset_id", byAsset);
  }

  // Log what was on the payload so the gap is diagnosable without a replay.
  logger.warn("StreamOS v1 webhook correlation failed", {
    event: body.event ?? null,
    sawStreamKey: Boolean(streamKey),
    sawSessionTag: taggedId != null,
    sawPublicId: Boolean(streamId),
    sawAssetId: Boolean(assetId),
    dataKeys: Object.keys(data ?? {}),
  });
  return null;
};

export interface HandleResult {
  handled: boolean;
  reason: string;
  sessionId?: number;
}

/**
 * Not idempotent: callers must claim the delivery id first. Free of network calls
 * except the completion-event asset fetch, to stay within StreamOS's 10s ack budget.
 */
export const applyEvent = async (
  body: V1WebhookBody,
  session: LiveSession
): Promise<HandleResult> => {
  const event = String(body.event ?? "");
  const data = body.data ?? {};
  const assetId = assetIdFromBody(data);

  switch (event) {
    case "LIVESTREAM_ENDED": {
      // Store the asset pointer when named so the later transcoding event can correlate.
      await adminLiveSql.updateSession(session.id, {
        status: session.status === "READY" ? session.status : "ENDED",
        ...(assetId ? { recordedAssetId: assetId } : {}),
      });
      return { handled: true, reason: "stream ended", sessionId: session.id };
    }

    case "LIVESTREAM_RECORDING_READY": {
      // Still transcoding: store the pointer only; READY is set by the completion event.
      if (!assetId) return { handled: false, reason: "recording event carried no asset id" };
      await adminLiveSql.updateSession(session.id, { recordedAssetId: assetId });
      return { handled: true, reason: "recording pointer stored (transcoding)", sessionId: session.id };
    }

    case "VIDEO_TRANSCODING_COMPLETED": {
      if (!assetId) return { handled: false, reason: "completion event carried no asset id" };

      // Fetch the asset when the delivery was trimmed via the webhook `fields` selector.
      let hlsUrl = asString(data?.video?.url);
      let ladder = Array.isArray(data?.renditions)
        ? data.renditions
            .map((r: any) => ({ quality: String(r?.quality ?? ""), path: String(r?.url ?? "") }))
            .filter((r: any) => r.path)
        : [];

      if (!hlsUrl || ladder.length === 0) {
        const resolved = await getRecordingByAssetId(assetId);
        hlsUrl = hlsUrl ?? resolved.hlsUrl;
        if (ladder.length === 0) ladder = resolved.hls;
      }

      // DRM recordings are DASH-only and unplayable (StreamOS has no licence server).
      // Keep the asset pointer but don't flip to READY or auto-promote: a missing
      // recording is recoverable, a broken one that looks fine is not.
      const drmFlag = data?.video?.drm === true || Boolean(data?.video?.drm_content_id);
      const dashOnly = !hlsUrl && ladder.length > 0 && ladder.every((r: any) => /\.mpd(\?|$)/i.test(r.path));
      if (drmFlag || dashOnly) {
        await adminLiveSql.updateSession(session.id, { recordedAssetId: assetId });
        logger.error("StreamOS v1 recording is DRM/DASH and cannot be played", {
          sessionId: session.id,
          assetId,
          drm: data?.video?.drm ?? null,
          drmContentId: data?.video?.drm_content_id ?? null,
          hasHlsManifest: Boolean(hlsUrl),
          renditionCount: ladder.length,
          hint: "Create live streams with drm:false — StreamOS has no licence server yet.",
        });
        return {
          handled: true,
          reason: "recording is DRM/DASH — not published (StreamOS has no licence server)",
          sessionId: session.id,
        };
      }

      // `auto` first: callers that take recordings[0] get the adaptive master.
      const recordings = [...(hlsUrl ? [{ quality: "auto", path: hlsUrl }] : []), ...ladder];
      if (recordings.length === 0) {
        return { handled: false, reason: "completion event resolved to no playable URL" };
      }

      await adminLiveSql.updateSession(session.id, {
        recordedAssetId: assetId,
        recordings,
        status: "READY",
      });

      // The delivery-id claim is what stops a retry duplicating these Video rows.
      await adminLiveSql.maybeAutoPromoteRecordingSql({
        sessionId: session.id,
        sessionTitle: session.title ?? null,
        recordings,
      });

      return { handled: true, reason: `recording ready (${recordings.length} url(s))`, sessionId: session.id };
    }

    case "VIDEO_TRANSCODING_FAILED": {
      // Stay ENDED so the UI doesn't advertise a replay that will never exist.
      logger.error("StreamOS v1 transcoding failed", {
        sessionId: session.id,
        assetId,
        code: data?.error?.code,
        message: data?.error?.message,
      });
      await adminLiveSql.updateSession(session.id, { status: "ENDED" });
      return { handled: true, reason: "transcoding failed", sessionId: session.id };
    }

    default:
      return { handled: false, reason: `unhandled event ${event || "(none)"}` };
  }
};
