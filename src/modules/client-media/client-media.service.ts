// Client media: resolves an opaque mediaToken into an entitlement-checked media URL.
/**
 * Server side of the media-token contract (POST /client/media/resolve). Client endpoints
 * emit only an opaque `mediaToken`; this is the ONLY place a real media URL is produced,
 * and only after: (1) signature + expiry verified, (2) the token's customer matches the
 * caller, (3) entitlement re-checked live.
 *
 * Spaces objects are presigned with a short TTL; video/live URLs are natively time-limited.
 */
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { prisma } from "../../config/prisma";
import { s3Config, DO_BUCKET, isOwnBucketUrl } from "../../middlewares/upload";
import { resolveVideoSource } from "../../utils/videoResolver";
import { getDetails as getStreamDetails } from "../../libs/streamos/streamos.provider";
import { hasActiveCourseSub, hasActivePackageSub } from "../client-lecture/client-lecture.service";
import { hasAccessToAnyLiveCourse, resolveLivePreviewStateSql } from "../admin-live-course/admin-live-course.service";
import { hasActiveSub as hasActiveEbookSub } from "../client-ebook-download/client-ebook-download.service";
import { getPurchasedMaterialIds } from "../client-material/client-material.service";
import { verifyMediaToken, MediaClaims, MediaScope } from "../../utils/mediaToken";
import logger from "../../utils/logger";

const PRESIGN_TTL_SECONDS = Number(process.env.MEDIA_SIGNED_URL_TTL_SECONDS) || 5 * 60;

export type ResolveResult =
  | { ok: true; kind: MediaClaims["k"]; media: any }
  | { ok: false; status: number; message: string };

// Full Spaces/CDN URL (virtual-host or path-style) → bucket object key. A bare key is returned unchanged.
const toObjectKey = (urlOrKey: string): string => {
  let s = urlOrKey.trim();
  // Some legacy rows store a scheme-less path-style URL ("blr1.digitaloceanspaces.com/<bucket>/…");
  // without a scheme the host+bucket would be mistaken for the key.
  if (!/^https?:\/\//i.test(s) && /^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?\//i.test(s)) {
    s = `https://${s}`;
  }
  if (!/^https?:\/\//i.test(s)) return s.replace(/^\/+/, ""); // truly a bare key
  try {
    let key = new URL(s).pathname.replace(/^\/+/, "");
    // Strip stray trailing quote artifacts seen on some StreamOS/Spaces paths.
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

// Legacy URLs may reference our bucket virtual-host style (https://<bucket>.<host>/<key>) or
// path-style (https://<host>/<bucket>/<key>). isOwnBucketUrl only recognizes the former, but
// both are private and must be presigned; only a truly external host (e.g. gpsconline.com) is
// passed through. A path-style own-bucket URL served raw 403s in the client.
const SPACES_HOST = (() => {
  try { return new URL(process.env.DO_ENDPOINT || "https://blr1.digitaloceanspaces.com").host; }
  catch { return "blr1.digitaloceanspaces.com"; }
})();
const pointsAtOurSpaces = (src: string): boolean => {
  if (isOwnBucketUrl(src)) return true; // virtual-host <bucket>.<endpoint-host>
  try {
    const host = new URL(/^https?:\/\//i.test(src) ? src : `https://${src}`).host;
    return host === SPACES_HOST || host.endsWith(`.${SPACES_HOST}`);
  } catch {
    return false;
  }
};

// HEAD the object before signing: a stale key would sign a URL that 404s on Spaces, which the
// app's PDF viewer saves as XML-as-PDF. Set MEDIA_VERIFY_EBOOK_OBJECT=false to skip the HEAD.
const MEDIA_VERIFY_EBOOK_OBJECT = process.env.MEDIA_VERIFY_EBOOK_OBJECT !== "false";

const objectExists = async (urlOrKey: string): Promise<boolean> => {
  const key = toObjectKey(urlOrKey);
  try {
    await (s3Config as any).send(new HeadObjectCommand({ Bucket: DO_BUCKET, Key: key }));
    return true;
  } catch (e: any) {
    const code = e?.$metadata?.httpStatusCode;
    if (code === 404 || e?.name === "NotFound" || e?.name === "NoSuchKey") return false;
    // Transient/permission error → don't block delivery; let the presign proceed.
    logger.warn("resolveMediaToken HEAD check inconclusive", { key, error: e?.name ?? String(e) });
    return true;
  }
};

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

export const resolveMediaToken = async (token: string, customerId: number): Promise<ResolveResult> => {
  let claims: MediaClaims;
  try {
    claims = verifyMediaToken(token);
  } catch (err: any) {
    return { ok: false, status: err?.expired ? 410 : 401, message: err?.message ?? "Invalid media token." };
  }

  // `bookDemo` is public demo content, so it skips the issuer match; every other kind is account-bound.
  if (claims.k !== "bookDemo" && claims.cust !== customerId) {
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
        // Offline download must use `hlsVariants` verbatim: a URL built from the quality label
        // ("…VOD480p.m3u8" vs the real "…VOD480p30.m3u8") is a missing key, which the CDN answers with 403.
        return { ok: true, kind: claims.k, media: { platform: v.platform, hlsUrl: src.hlsUrl, hlsVariants: src.hlsVariants, progressive: src.progressive, allow720: src.allow720 } };
      }
      case "liveRecording": {
        // Promoted recording: playable URLs live on the source live session.
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
        // Gated on full-or-preview access (same check as the detail endpoint); `preview_ended` is rejected.
        const links = await prisma.liveSessionCourse.findMany({ where: { liveSessionId: s.id }, select: { liveCourseId: true }, orderBy: { id: "asc" } });
        const linkedCourseIds = links.map((l) => l.liveCourseId).filter((n): n is number => n != null);
        // Honour the entry point the token was minted for (`lc`): a token issued inside an
        // unpurchased course must stay a preview, not upgrade because another linked course is
        // owned. Absent `lc` = Live Now (any course). A course unlinked since issue stops granting.
        let liveCourseIds = linkedCourseIds;
        if (claims.lc != null) {
          if (!linkedCourseIds.includes(claims.lc)) {
            return { ok: false, status: 404, message: "This live course is not linked to this live session." };
          }
          liveCourseIds = [claims.lc];
        }
        const state = await resolveLivePreviewStateSql(customerId, s.id, liveCourseIds, true);
        if (state.accessLevel !== "full" && state.accessLevel !== "preview") {
          return { ok: false, status: 403, message: "Active subscription required to access this live session." };
        }
        let hlsUrl = s.hlsUrl, hlsUrls: any = s.hlsUrls;
        if (s.streamId) {
          try {
            const d = await getStreamDetails(s);
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
        // `ebook`: no `active` filter, so an owner can still open a deactivated ebook they paid for.
        // `ebookDemo`: must be active. Demo tokens never expire (NON_EXPIRING_KINDS in
        // utils/mediaToken), so this filter is what stops a demo outliving a pulled ebook.
        const isDemo = claims.k === "ebookDemo";
        const e = await prisma.eBook.findFirst({
          where: isDemo ? { id: claims.id, active: true } : { id: claims.id },
          select: { bookUrl: true, bookDemoUrl: true },
        });
        if (!e) return { ok: false, status: 404, message: "Ebook not found." };
        const src = claims.k === "ebook" ? e.bookUrl : e.bookDemoUrl;
        if (!src) return { ok: false, status: 404, message: "This ebook has no downloadable PDF." };
        if (MEDIA_VERIFY_EBOOK_OBJECT && !(await objectExists(src))) {
          logger.warn("resolveMediaToken ebook object missing", { kind: claims.k, id: claims.id, key: toObjectKey(src) });
          return { ok: false, status: 404, message: "This e-book is not available." };
        }
        const url = await presign(src);
        return { ok: true, kind: claims.k, media: { url } };
      }
      case "bookDemo": {
        // Physical-book sample PDF; the token is `free`, so no entitlement check.
        const b = await prisma.book.findFirst({ where: { id: claims.id, active: true }, select: { demo_url: true } });
        if (!b) return { ok: false, status: 404, message: "Book not found." };
        const src = b.demo_url;
        if (!src) return { ok: false, status: 404, message: "This book has no demo PDF." };
        // Legacy demos on external hosts are already public; only our-bucket objects get HEAD + presign.
        if (/^https?:\/\//i.test(src) && !pointsAtOurSpaces(src)) {
          return { ok: true, kind: claims.k, media: { url: src } };
        }
        if (MEDIA_VERIFY_EBOOK_OBJECT && !(await objectExists(src))) {
          logger.warn("resolveMediaToken book demo object missing", { id: claims.id, key: toObjectKey(src) });
          return { ok: false, status: 404, message: "This book demo is not available." };
        }
        const url = await presign(src);
        return { ok: true, kind: claims.k, media: { url } };
      }
      case "material": {
        // Paid materials re-check ownership (a `free` token skips it) so a token can't outlive
        // an expired subscription.
        const m = await prisma.material.findFirst({
          where: { id: claims.id, status: true },
          select: { id: true, file: true, direct_link: true, fileMime: true, isPaid: true, materialCategoryId: true },
        });
        if (!m) return { ok: false, status: 404, message: "Material not found." };
        if (m.isPaid && !claims.free) {
          const owned = await getPurchasedMaterialIds(customerId, [{ _id: m.id, materialCategoryId: m.materialCategoryId as number, isPaid: true }]);
          if (!owned.has(m.id)) return { ok: false, status: 403, message: "Active subscription required to access this material." };
        }
        const src = m.file || m.direct_link;
        if (!src) return { ok: false, status: 404, message: "This material has no file." };
        const isDirectLink = !m.file && !!m.direct_link;
        // External direct links (not our Spaces bucket) are public — pass through.
        if (/^https?:\/\//i.test(src) && !pointsAtOurSpaces(src)) {
          return { ok: true, kind: claims.k, media: { url: src, mime: m.fileMime ?? null, isDirectLink } };
        }
        if (MEDIA_VERIFY_EBOOK_OBJECT && !(await objectExists(src))) {
          logger.warn("resolveMediaToken material object missing", { id: claims.id, key: toObjectKey(src) });
          return { ok: false, status: 404, message: "This material is not available." };
        }
        const url = await presign(src);
        return { ok: true, kind: claims.k, media: { url, mime: m.fileMime ?? null, isDirectLink } };
      }
      default:
        return { ok: false, status: 400, message: "Unsupported media kind." };
    }
  } catch (err) {
    logger.error("resolveMediaToken resolution failed", { kind: claims.k, id: claims.id, error: (err as Error).message });
    return { ok: false, status: 502, message: "Failed to resolve media." };
  }
};
