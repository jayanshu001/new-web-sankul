// src/admin/live/streamos.v1.webhook.ts
//
// Handling for StreamOS v1 webhook deliveries.
//
// Three things make this materially different from the legacy callback:
//
//  1. RECORDINGS ARRIVE IN TWO EVENTS, minutes apart. LIVESTREAM_RECORDING_READY
//     says an asset exists but is still transcoding; VIDEO_TRANSCODING_COMPLETED
//     says it is playable. Marking a session READY on the first would publish a
//     recording that cannot be played.
//
//  2. DELIVERIES RETRY. Up to 6 times, same X-Streamos-Delivery id. Recording
//     handling promotes a recording into a course folder (creates Video rows),
//     so every delivery is claimed exactly once before any work happens.
//
//  3. CORRELATION IS VIA `data.stream.stream_key`. The v1 Video payload carries a
//     `stream` object documented as "Set when the asset is a live stream
//     recording, so you can tie it back to the broadcast". It holds the
//     stream_key — NOT the public_id we store as `streamId` — which is why
//     ws_live_session keeps `stream_key` as its own column.
//
//     `LIVESTREAM_RECORDING_READY` appears to carry only `recording.asset_id`
//     (its docs call that "the only place it is announced"), so the FIRST event
//     of the pair may not be correlatable. That is tolerable: it only stores a
//     pointer, while VIDEO_TRANSCODING_COMPLETED — the one that publishes the
//     recording — does carry the stream. `resolveSession` keeps the other keys
//     as fallbacks so a trimmed or differently-shaped delivery still lands.

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

/** Read a tag value out of whichever bag StreamOS echoed it back on. */
const tagValue = (data: Record<string, any> | undefined, key: string): string | null => {
  for (const bag of [data?.stream?.tags, data?.video?.tags, data?.recording?.tags, data?.tags]) {
    const v = asString(bag?.[key]);
    if (v) return v;
  }
  return null;
};

/**
 * Is this delivery ours?
 *
 * Staging and production share ONE StreamOS organisation and ONE API key, so a
 * webhook registered by either environment can receive the other's recordings.
 * Every stream we create is stamped with `wsEnv`; a delivery carrying a
 * DIFFERENT environment belongs to the other deployment and must be ignored —
 * not merely unmatched. Hunting for it among our sessions risks attaching a
 * staging test recording to a real class on an id collision.
 *
 * An UNTAGGED delivery is treated as ours: legacy streams, streams created
 * before this tag existed, and anything created from the StreamOS dashboard
 * carry no tag, and silently dropping those would lose real recordings.
 */
export const isForeignEnvironment = (body: V1WebhookBody): boolean => {
  const tag = tagValue(body.data, "wsEnv");
  return tag != null && tag !== streamosEnvTag();
};

/** Pull our session id out of whichever tag bag StreamOS echoed it back on. */
const sessionIdFromTags = (data: Record<string, any> | undefined): number | null => {
  const raw = tagValue(data, "wsSessionId");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * The v1 channel key. THIS IS THE DOCUMENTED CORRELATION FIELD: the Video
 * payload carries `data.stream`, described as "Set when the asset is a live
 * stream recording, so you can tie it back to the broadcast", and it holds
 * `stream_key`. Note it is the KEY, not the `public_id` we store as `streamId`
 * — which is why ws_live_session keeps `stream_key` as its own column.
 */
const streamKeyFromBody = (data: Record<string, any> | undefined): string | null =>
  asString(data?.stream?.stream_key) ?? asString(data?.recording?.stream_key);

/** Stream public_id, wherever an event happens to carry it. Fallback only. */
const streamIdFromBody = (data: Record<string, any> | undefined): string | null =>
  asString(data?.stream?.public_id) ??
  asString(data?.stream?.id) ??
  asString(data?.recording?.stream_public_id) ??
  asString(data?.video?.stream_public_id) ??
  asString(data?.livestream?.public_id);

/** The library asset this event is about. */
export const assetIdFromBody = (data: Record<string, any> | undefined): string | null =>
  asString(data?.recording?.asset_id) ?? asString(data?.video?.id) ?? asString(data?.asset?.public_id);

/**
 * Find the session an event belongs to, trying each correlation key in order of
 * reliability. Returns null when none match — the caller acks 200 (so StreamOS
 * stops retrying) and logs loudly, because a recording we cannot attribute is a
 * wiring problem, not a transient failure.
 */
export const resolveSession = async (body: V1WebhookBody): Promise<LiveSession | null> => {
  const data = body.data;

  /**
   * Which key matched is the answer to the open question in
   * STREAMOS_V1_QUESTIONS.md — the docs are abbreviated, so until a real
   * delivery lands we do not know whether `stream_key` is actually present.
   * Logging the winner turns the first live recording into the experiment that
   * settles it; once known, the losing branches can be deleted.
   */
  const found = (via: string, session: LiveSession): LiveSession => {
    logger.info("StreamOS v1 webhook correlated", {
      via,
      event: body.event ?? null,
      sessionId: session.id,
    });
    return session;
  };

  // 1. data.stream.stream_key — the mechanism StreamOS documents for exactly
  //    this ("so you can tie it back to the broadcast"). Tried first.
  const streamKey = streamKeyFromBody(data);
  if (streamKey) {
    const byKey = await adminLiveSql.findSessionByStreamKey(streamKey);
    if (byKey) return found("stream_key", byKey);
  }

  // 2. Our own id, echoed back through customTags. Independent of their schema,
  //    so it still resolves an event whose `stream` object is absent.
  const taggedId = sessionIdFromTags(data);
  if (taggedId != null) {
    const byId = await adminLiveSql.findSessionByAnyId(String(taggedId));
    if (byId) return found("customTags.wsSessionId", byId);
  }

  // 3. The stream's public_id, if this event names it.
  const streamId = streamIdFromBody(data);
  if (streamId) {
    const byStream = await adminLiveSql.findSessionByAnyId(streamId);
    if (byStream) return found("stream.public_id", byStream);
  }

  // 4. The asset id — works once LIVESTREAM_ENDED or RECORDING_READY has stamped
  //    recorded_asset_id on the session, which is how the second event of the
  //    pair finds its way home.
  const assetId = assetIdFromBody(data);
  if (assetId) {
    const byAsset = await adminLiveSql.findSessionByRecordedAssetId(assetId);
    if (byAsset) return found("recorded_asset_id", byAsset);
  }

  // Nothing matched. Log what WAS on the payload so the gap is diagnosable from
  // one log line instead of needing the delivery replayed.
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
 * Apply one v1 event to a session. Callers MUST have claimed the delivery id
 * first — this function is not itself idempotent.
 *
 * Kept free of network calls except the asset fetch on the completion event, so
 * the handler stays inside StreamOS's 10-second acknowledgement budget.
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
      // The stream is over. A recording may or may not follow; store the pointer
      // when one is named so the later transcoding event can correlate on it.
      await adminLiveSql.updateSession(session.id, {
        status: session.status === "READY" ? session.status : "ENDED",
        ...(assetId ? { recordedAssetId: assetId } : {}),
      });
      return { handled: true, reason: "stream ended", sessionId: session.id };
    }

    case "LIVESTREAM_RECORDING_READY": {
      // Asset exists but is still transcoding — NOT playable yet. Record the
      // pointer and leave status alone; READY is set by the completion event.
      if (!assetId) return { handled: false, reason: "recording event carried no asset id" };
      await adminLiveSql.updateSession(session.id, { recordedAssetId: assetId });
      return { handled: true, reason: "recording pointer stored (transcoding)", sessionId: session.id };
    }

    case "VIDEO_TRANSCODING_COMPLETED": {
      if (!assetId) return { handled: false, reason: "completion event carried no asset id" };

      // Prefer URLs already in the payload; fall back to fetching the asset when
      // the delivery was trimmed via the webhook `fields` selector.
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

      // ── DRM guard ──────────────────────────────────────────────────────────
      // A DRM recording is DASH (.mpd) with a null HLS manifest, and StreamOS
      // has no licence server yet — their own docs say such assets "currently
      // cannot be played". Publishing one would show students a player that
      // simply fails.
      //
      // So: keep the asset pointer (nothing is lost, and it becomes playable the
      // moment a licence server exists or the stream is re-encoded), but do NOT
      // flip to READY and do NOT auto-promote. A missing recording is recoverable;
      // a broken one that looks fine is not. Logged at error so it surfaces.
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

      // File the recording into each linked course's chosen folder. Claiming the
      // delivery id above is what stops a retry duplicating these Video rows.
      await adminLiveSql.maybeAutoPromoteRecordingSql({
        sessionId: session.id,
        sessionTitle: session.title ?? null,
        recordings,
      });

      return { handled: true, reason: `recording ready (${recordings.length} url(s))`, sessionId: session.id };
    }

    case "VIDEO_TRANSCODING_FAILED": {
      // No recording is coming. Leave the session ENDED rather than READY so the
      // UI doesn't advertise a replay that will never exist.
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
