/**
 * Media resolve — the server side of the short-lived media-token contract.
 *
 * Client list/detail endpoints emit only an opaque `mediaToken` (see
 * utils/mediaToken.ts). The client posts it to POST /client/media/resolve, which
 * calls resolveMediaToken() here. This is the ONLY place a real media URL is
 * produced, and only after: (1) token signature + expiry verified,
 * (2) the token's customer matches the caller, (3) entitlement re-checked live.
 *
 * Returned URLs are short-lived: S3/Spaces objects (audio notes, ebook PDFs) are
 * freshly PRESIGNED with a short TTL; video/live URLs are StreamOS/VideoCrypt/
 * YouTube URLs which are themselves natively time-limited.
 */
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { prisma } from "../../config/prisma";
import { s3Config, DO_BUCKET } from "../../middlewares/upload";
import { resolveVideoSource } from "../../utils/videoResolver";
import { getStreamDetails } from "../../admin/live/streamos.service";
import { hasActiveCourseSub, hasActivePackageSub } from "../client-lecture/client-lecture.service";
import { hasAccessToAnyLiveCourse, resolveLivePreviewStateSql } from "../admin-live-course/admin-live-course.service";
import { hasActiveSub as hasActiveEbookSub } from "../client-ebook-download/client-ebook-download.service";
import { verifyMediaToken, MediaClaims, MediaScope } from "../../utils/mediaToken";
import logger from "../../utils/logger";

const PRESIGN_TTL_SECONDS = Number(process.env.MEDIA_SIGNED_URL_TTL_SECONDS) || 5 * 60;

export type ResolveResult =
  | { ok: true; kind: MediaClaims["k"]; media: any }
  | { ok: false; status: number; message: string };

// Strip a full Spaces/CDN URL down to the bucket object key so it can be
// re-presigned. Handles both virtual-host (bucket in the host) and path-style
// (bucket as the first path segment) layouts. A value that is already a bare key
// (no scheme) is returned unchanged.
const toObjectKey = (urlOrKey: string): string => {
  if (!/^https?:\/\//i.test(urlOrKey)) return urlOrKey.replace(/^\/+/, "");
  try {
    let key = new URL(urlOrKey).pathname.replace(/^\/+/, "");
    // Also strip stray trailing quote artifacts seen on some StreamOS/Spaces paths.
    key = key.replace(/(?:"|%22|%2522)+$/i, "");
    if (DO_BUCKET && key.startsWith(`${DO_BUCKET}/`)) key = key.slice(DO_BUCKET.length + 1);
    return decodeURIComponent(key);
  } catch {
    return urlOrKey;
  }
};

const presign = (urlOrKey: string): Promise<string> =>
  getSignedUrl(
    s3Config as any,
    new GetObjectCommand({ Bucket: DO_BUCKET, Key: toObjectKey(urlOrKey) }),
    { expiresIn: PRESIGN_TTL_SECONDS }
  );

// Re-check entitlement for the token's scope. `free` tokens skip; a "trusted"
// scope relies on the issue-time gate plus the token's short TTL.
const entitled = async (customerId: number, claims: MediaClaims): Promise<boolean> => {
  if (claims.free) return true;
  const scope: MediaScope | null | undefined = claims.scope;
  if (!scope) return true;
  switch (scope.kind) {
    case "course": return hasActiveCourseSub(customerId, scope.id);
    case "package": return hasActivePackageSub(customerId, scope.id);
    case "liveCourse": return hasAccessToAnyLiveCourse(customerId, [scope.id]);
    case "ebook": return hasActiveEbookSub(customerId, scope.id);
    case "trusted": return true;
    default: return false;
  }
};

const sanitizeRecs = (raw: unknown): Array<{ quality: string | null; file_size: number | null; path: string }> =>
  (Array.isArray(raw) ? raw : [])
    .filter((r: any) => typeof r?.path === "string" && r.path.length > 0)
    .map((r: any) => ({
      quality: typeof r.quality === "string" ? r.quality : null,
      file_size: typeof r.file_size === "number" ? r.file_size : null,
      path: String(r.path).replace(/(?:"|%22|%2522)+$/i, ""),
    }));

/**
 * Verify a media token and resolve the actual (short-lived) media for `customerId`.
 * Returns a discriminated result the controller maps to HTTP.
 */
export const resolveMediaToken = async (token: string, customerId: number): Promise<ResolveResult> => {
  let claims: MediaClaims;
  try {
    claims = verifyMediaToken(token);
  } catch (err: any) {
    return { ok: false, status: err?.expired ? 410 : 401, message: err?.message ?? "Invalid media token." };
  }

  if (claims.cust !== customerId) {
    return { ok: false, status: 403, message: "This media token was issued to a different account." };
  }
  if (!(await entitled(customerId, claims))) {
    return { ok: false, status: 403, message: "Active subscription required to access this media." };
  }

  try {
    switch (claims.k) {
      case "video": {
        const v = await prisma.video.findFirst({
          where: { id: claims.id },
          select: { id: true, status: true, platform: true, youtube_id: true, aws_id: true, vimeo_id: true },
        });
        if (!v || !v.status) return { ok: false, status: 404, message: "Media not found." };
        const src = await resolveVideoSource(v as any);
        return { ok: true, kind: claims.k, media: { platform: v.platform, hlsUrl: src.hlsUrl, progressive: src.progressive, allow720: src.allow720 } };
      }
      case "liveRecording": {
        // Promoted live-course recording. Playable URLs live on the source
        // live session (StreamOS recordings columns).
        const v = await prisma.video.findFirst({ where: { id: claims.id }, select: { id: true, status: true, liveSessionId: true } });
        if (!v || !v.status) return { ok: false, status: 404, message: "Media not found." };
        if (v.liveSessionId == null) return { ok: false, status: 404, message: "Recording has no source session." };
        const s = await prisma.liveSession.findFirst({ where: { id: v.liveSessionId }, select: { recordings: true, mp4Recordings: true } });
        const hls = sanitizeRecs(s?.recordings);
        const mp4 = sanitizeRecs(s?.mp4Recordings);
        return { ok: true, kind: claims.k, media: { hlsRecordings: hls, mp4Recordings: mp4, hlsUrl: hls[0]?.path ?? null, mp4Url: mp4[0]?.path ?? null } };
      }
      case "liveSession": {
        const s = await prisma.liveSession.findFirst({ where: { id: claims.id }, select: { id: true, streamId: true, hlsUrl: true, hlsUrls: true } });
        if (!s) return { ok: false, status: 404, message: "Live session not found." };
        // Live sessions gate on full-OR-preview access, not pure entitlement —
        // re-run the same preview-state check the list endpoint used. `preview`
        // (trial) is allowed; `preview_ended`/no-access is rejected.
        const links = await prisma.liveSessionCourse.findMany({ where: { liveSessionId: s.id }, select: { liveCourseId: true } });
        const liveCourseIds = links.map((l) => l.liveCourseId).filter((n): n is number => n != null);
        const state = await resolveLivePreviewStateSql(customerId, s.id, liveCourseIds, true);
        if (state.accessLevel !== "full" && state.accessLevel !== "preview") {
          return { ok: false, status: 403, message: "Active subscription required to access this live session." };
        }
        let hlsUrl = s.hlsUrl, hlsUrls: any = s.hlsUrls;
        if (s.streamId) {
          try {
            const d = await getStreamDetails(String(s.streamId));
            if (d.hlsUrl) hlsUrl = d.hlsUrl;
            if (d.hlsUrls && Object.keys(d.hlsUrls).length) hlsUrls = d.hlsUrls;
          } catch (e) {
            logger.warn("resolveMediaToken streamos detail failed", { sessionId: s.id, error: (e as Error).message });
          }
        }
        return { ok: true, kind: claims.k, media: { hlsUrl: hlsUrl ?? null, hlsUrls: hlsUrls ?? null } };
      }
      case "audioNote": {
        const n = await prisma.lectureAudioNote.findFirst({ where: { id: claims.id, customerId }, select: { audioUrl: true, audioKey: true, mimeType: true, durationSec: true } });
        if (!n || !(n.audioKey || n.audioUrl)) return { ok: false, status: 404, message: "Audio note not found." };
        const url = await presign(n.audioKey || n.audioUrl!);
        return { ok: true, kind: claims.k, media: { url, mimeType: n.mimeType ?? null, durationSec: n.durationSec ?? null } };
      }
      case "ebook":
      case "ebookDemo": {
        const e = await prisma.eBook.findFirst({ where: { id: claims.id, active: true }, select: { bookUrl: true, bookDemoUrl: true } });
        if (!e) return { ok: false, status: 404, message: "Ebook not found." };
        const src = claims.k === "ebook" ? e.bookUrl : e.bookDemoUrl;
        if (!src) return { ok: false, status: 404, message: "This ebook has no downloadable PDF." };
        const url = await presign(src);
        return { ok: true, kind: claims.k, media: { url } };
      }
      default:
        return { ok: false, status: 400, message: "Unsupported media kind." };
    }
  } catch (err) {
    logger.error("resolveMediaToken resolution failed", { kind: claims.k, id: claims.id, error: (err as Error).message });
    return { ok: false, status: 502, message: "Failed to resolve media." };
  }
};
