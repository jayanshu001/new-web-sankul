// src/admin/live/streamos.provider.ts
//
// One provider-agnostic surface over BOTH StreamOS platforms.
//
// Why a facade instead of swapping the client out: the choice is PER SESSION,
// not per deploy. Existing ws_live_session rows hold legacy stream ids and
// legacy CDN URLs; resolving one against the v1 API just 404s. So a row's own
// `streamProvider` decides where it resolves, and the STREAMOS_PROVIDER env flag
// only decides where NEW streams are created. Flipping the flag therefore never
// strands the back catalogue.
//
// Consumers should import from here, never from either client directly.
//
// Old→new comparison: docs/migration/STREAMOS_V1_CHANGE_MATRIX.md

import logger from "../../utils/logger";
import { isStreamosV1, streamosEnvTag } from "../../config/streamos";
import {
  StreamosError,
  createStream as legacyCreateStream,
  getStreamDetails as legacyGetStreamDetails,
  endStream as legacyEndStream,
  type StreamosRecording,
  type QualityHlsUrls,
} from "./streamos.service";
import * as v1 from "./streamos.v1.service";

export { StreamosError };
export type { StreamosRecording, QualityHlsUrls };

export type Provider = "legacy" | "v1";

/** Minimal shape the facade needs off a session row. */
export interface SessionRef {
  id?: number;
  status?: string | null;
  streamId?: string | null;
  streamProvider?: string | null;
  recordedAssetId?: string | null;
}

/**
 * Which API a session's `streamId` belongs to.
 * NULL/absent reads as "legacy" — every row predating the v1 platform is legacy,
 * which is what makes the column backfill-free.
 */
export const providerOf = (row: SessionRef | null | undefined): Provider =>
  row?.streamProvider === "v1" ? "v1" : "legacy";

/** Which API a NEW stream should be created against. */
export const providerForNewStreams = (): Provider => (isStreamosV1() ? "v1" : "legacy");

// ── Provisioning ────────────────────────────────────────────────────────────

export interface ProvisionResult {
  provider: Provider;
  streamId: string;
  streamKey: string | null;
  /** Null on a v1 SCHEDULED stream — ingest credentials are minted at start. */
  rtmpUrl: string | null;
  hlsUrl: string | null;
  hlsUrls: QualityHlsUrls | null;
  /** v1 only: ingest credentials die at this instant. */
  pushExpiresAt: Date | null;
}

const toDate = (iso: string | null): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
};

/**
 * Tags stamped on every v1 stream.
 *
 *  - `wsSessionId` — our session id, so a recording traces back to its class
 *    even on an event whose `stream` object is absent.
 *  - `wsEnv` — which deployment created the stream. Staging and production share
 *    ONE StreamOS organisation (confirmed by StreamOS), so both environments'
 *    streams sit in the same account and a webhook can receive the other's
 *    recordings. This is what lets the handler ignore what isn't its own.
 *
 * Always returns tags: `wsEnv` is worth stamping even without a session id.
 */
const sessionTags = (sessionId?: number): Record<string, string> => ({
  wsEnv: streamosEnvTag(),
  ...(sessionId != null ? { wsSessionId: String(sessionId) } : {}),
});

/**
 * Prepare a stream ahead of go-live.
 *
 * legacy → mints full ingest credentials immediately (they never expire).
 * v1     → reserves the stream only; `rtmpUrl` stays null because v1 ingest
 *          credentials expire ~24h after minting, so handing them out days
 *          early would guarantee a dead URL at go-live. `startStream` mints them.
 */
export async function provisionStream(input: {
  title: string;
  sessionId?: number;
  scheduledAt?: Date | null;
}): Promise<ProvisionResult> {
  if (providerForNewStreams() === "v1") {
    // v1 requires an ISO timestamp to schedule; without one there is nothing to
    // reserve against, so fall back to an immediately-pushable stream.
    const scheduledAt = input.scheduledAt ?? null;
    const stream = scheduledAt
      ? await v1.scheduleLiveStream({
          title: input.title,
          scheduledAt: scheduledAt.toISOString(),
          customTags: sessionTags(input.sessionId),
        })
      : await v1.createLiveStream({
          title: input.title,
          customTags: sessionTags(input.sessionId),
        });

    return {
      provider: "v1",
      streamId: stream.publicId,
      streamKey: stream.streamKey,
      rtmpUrl: stream.rtmpUrl,
      hlsUrl: stream.hlsUrl,
      hlsUrls: stream.hlsUrls,
      pushExpiresAt: toDate(stream.pushExpiresAt),
    };
  }

  const created = await legacyCreateStream(input.title);
  return {
    provider: "legacy",
    streamId: created.streamId,
    streamKey: null,
    rtmpUrl: created.rtmpUrl,
    hlsUrl: created.hlsUrl,
    hlsUrls: created.hlsUrls ?? null,
    pushExpiresAt: null,
  };
}

/** True when v1 ingest credentials have expired (or are about to, within 60s). */
export const pushCredentialsExpired = (pushExpiresAt: Date | null | undefined): boolean =>
  pushExpiresAt instanceof Date && pushExpiresAt.getTime() - 60_000 <= Date.now();

/**
 * Go live.
 *
 * legacy → nothing to mint; credentials were issued at provision time and do not
 *          expire, so this returns null and the caller keeps what it has.
 * v1     → mints ingest credentials now. Also re-mints for an already-started
 *          stream whose 24h window lapsed.
 */
export async function startStream(session: SessionRef & { title?: string | null }): Promise<ProvisionResult | null> {
  if (providerOf(session) !== "v1") return null;
  if (!session.streamId) return null;

  const stream = await v1.startLiveStream(session.streamId);
  return {
    provider: "v1",
    streamId: stream.publicId || session.streamId,
    streamKey: stream.streamKey,
    rtmpUrl: stream.rtmpUrl,
    hlsUrl: stream.hlsUrl,
    hlsUrls: stream.hlsUrls,
    pushExpiresAt: toDate(stream.pushExpiresAt),
  };
}

/** Ends the stream. On v1 this also frees the org's concurrency slot. */
export async function endStream(session: SessionRef): Promise<void> {
  if (!session.streamId) return;
  if (providerOf(session) === "v1") {
    await v1.endLiveStream(session.streamId);
    return;
  }
  await legacyEndStream(session.streamId);
}

// ── Details / recordings ────────────────────────────────────────────────────

export interface UnifiedDetails {
  isLive: boolean;
  hlsUrl?: string;
  hlsUrls?: QualityHlsUrls;
  /** Per-quality HLS ladder. */
  recordings: StreamosRecording[];
  /** Plain MP4 variants. Always empty on v1 — it produces no MP4 ladder. */
  mp4Recordings: StreamosRecording[];
  recordedAssetId?: string | null;
  /** v1 only: true while the recording is still transcoding (not yet playable). */
  recordingProcessing?: boolean;
  raw: unknown;
}

/**
 * v1 exposes NO liveness signal — the docs state a stream in progress still
 * reads READY_TO_STREAM because nothing reports when an encoder connects. The
 * closest honest approximation: an admin pressed Go Live (our status is CREATED)
 * and StreamOS has not ended the stream.
 *
 * This is intentionally optimistic. It can show "live" for a session whose
 * encoder never connected or already dropped; only a provider-side signal or an
 * HLS manifest probe can do better. Tracked as Q5.
 */
const deriveIsLiveV1 = (session: SessionRef, providerStatus: string): boolean =>
  session.status === "CREATED" && providerStatus !== "ENDED";

const rendsToRecordings = (rends: v1.AssetRendition[]): StreamosRecording[] =>
  rends
    .map((r) => ({ quality: r.quality, path: String(r.url ?? r.dashUrl ?? "") }))
    .filter((r) => r.path.length > 0);

/** Liveness + playback URLs + any finished recording, in one provider-agnostic shape. */
export async function getDetails(session: SessionRef): Promise<UnifiedDetails> {
  if (!session.streamId) {
    return { isLive: false, recordings: [], mp4Recordings: [], raw: null };
  }

  if (providerOf(session) !== "v1") {
    const d = await legacyGetStreamDetails(session.streamId);
    return {
      isLive: d.isLive,
      hlsUrl: d.hlsUrl,
      hlsUrls: d.hlsUrls,
      recordings: d.recordings,
      mp4Recordings: d.mp4Recordings,
      raw: d.raw,
    };
  }

  const stream = await v1.getLiveStream(session.streamId);
  const assetId = stream.recordedAssetId ?? session.recordedAssetId ?? null;

  const base: UnifiedDetails = {
    isLive: deriveIsLiveV1(session, String(stream.status)),
    hlsUrl: stream.hlsUrl ?? undefined,
    hlsUrls: stream.hlsUrls ?? undefined,
    recordings: [],
    // v1 has no MP4 ladder — one download_url at one quality.
    mp4Recordings: [],
    recordedAssetId: assetId,
    raw: stream.raw,
  };

  if (!assetId) return base;

  // Recording exists — resolve it. A failure here must not sink the liveness
  // answer, so it degrades to "no recording yet" rather than throwing.
  try {
    const asset = await v1.getAsset(assetId);
    const ready = String(asset.status).toUpperCase() === "COMPLETED";
    const ladder = rendsToRecordings(asset.renditions);

    // The master playlist is the playable URL; renditions are per-quality.
    // Prepend the master so callers that take recordings[0] get the ABR stream.
    const recordings: StreamosRecording[] = ready
      ? [
          ...(asset.hlsManifestUrl ? [{ quality: "auto", path: asset.hlsManifestUrl }] : []),
          ...ladder,
        ]
      : [];

    return { ...base, recordings, recordingProcessing: !ready, raw: { stream: stream.raw, asset: asset.raw } };
  } catch (err) {
    logger.warn("StreamOS v1 asset resolve failed", {
      streamId: session.streamId,
      assetId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ...base, recordingProcessing: true };
  }
}

/** Resolves a finished recording (VOD) directly by asset id. */
export async function getRecordingByAssetId(assetId: string): Promise<{
  hlsUrl: string | null;
  durationSeconds: number | null;
  hls: StreamosRecording[];
  mp4: StreamosRecording[];
}> {
  const asset = await v1.getAsset(assetId);
  return {
    hlsUrl: asset.hlsManifestUrl,
    durationSeconds: asset.durationSeconds,
    hls: rendsToRecordings(asset.renditions),
    mp4: [],
  };
}
