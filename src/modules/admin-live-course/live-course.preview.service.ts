// Live courses: the 3-minute live preview (watch-time metering, heartbeat, stop).
import { buildPreviewTrackingId } from "../../utils/previewTracking";
import { prisma } from "../../config/prisma";
import { firstEntitledLiveCourseId } from "./live-course.client.service";

// Live-session preview/trial window length, in seconds.
export const PREVIEW_SECONDS = 180;
const LIVE_PREVIEW_SECONDS = PREVIEW_SECONDS;

/**
 /**
  * Heartbeat interval while playback is active, published in the join response so it
  * is a server decision rather than an app constant.
  */
export const PREVIEW_HEARTBEAT_SECONDS = 10;

/**
 /**
  * The most watch time one heartbeat may ever charge. Consumption is charged as
  * (now − last_heartbeat_at), so if the app dies without /preview/stop the cursor
  * freezes; without a cap, returning an hour later would bill the hour. Capping at one
  * missed interval plus slack makes an abandoned window self-limit, no sweeper needed.
  * Must stay > PREVIEW_HEARTBEAT_SECONDS or ordinary jitter under-charges every tick.
  */
export const PREVIEW_STALE_SECONDS = 20;

export type LivePreviewStateSql = {
  accessLevel: "full" | "preview" | "preview_ended";
  previewSecondsRemaining: number;
  /** The linked course that granted `full` (null on preview/preview_ended). */
  accessGrantedByLiveCourseId: number | null;
};

/**
 /**
  * Watch time owed by a still-open window but not yet committed to `consumed_seconds`.
  * Reads include it, or a client that heartbeats and re-joins would see its remaining
  * time snap back up. Capped by PREVIEW_STALE_SECONDS like the heartbeat charge, so the
  * two agree and an abandoned window stops growing. Computed only, never persisted:
  * only a heartbeat or stop advances `consumed_seconds`.
  */
const pendingPreviewCharge = (lastHeartbeatAt: Date | null | undefined, now: Date): number => {
  if (!lastHeartbeatAt) return 0; // window closed → nothing accruing
  const elapsed = Math.floor((now.getTime() - lastHeartbeatAt.getTime()) / 1000);
  return Math.max(0, Math.min(PREVIEW_STALE_SECONDS, elapsed));
};

/** Remaining trial for a row, including any uncommitted open-window time. */
const previewRemainingFrom = (
  consumedSeconds: number,
  lastHeartbeatAt: Date | null | undefined,
  now: Date
): number => {
  const consumed = Math.max(0, consumedSeconds) + pendingPreviewCharge(lastHeartbeatAt, now);
  return Math.max(0, LIVE_PREVIEW_SECONDS - Math.min(LIVE_PREVIEW_SECONDS, consumed));
};

/** The trial row for one (customer, session), oldest wins (see resolveLivePreviewStateSql). */
const oldestPreviewRow = (customerId: number, liveSessionId: number) =>
  prisma.liveSessionPreview.findFirst({ where: { customerId, liveSessionId }, orderBy: { id: "asc" } });

/**
 * Access decision for one live session and caller. `liveCourseIds` is the entitlement
 * scope: opened from a course → `[thatCourseId]` only, so owning a different course
 * linked to the same shared session does not unlock it; opened from Live Now → every
 * linked course, any active one grants full access.
 *
 * The trial row is keyed on (customer, session), not course, so re-entering via another
 * unpurchased course, device or reinstall continues the same window.
 *
 * `track` (session is not SCHEDULED) gates row creation only. A new row starts at
 * consumed_seconds = 0 with no open window; consumption begins at the first heartbeat.
 * Reads never charge, so re-joining without heartbeats never moves the number.
 */
export const resolveLivePreviewStateSql = async (
  customerId: number | null,
  liveSessionId: number,
  liveCourseIds: number[],
  track: boolean
): Promise<LivePreviewStateSql> => {
  // A session linked to no course is ungated.
  if (!liveCourseIds.length) return { accessLevel: "full", previewSecondsRemaining: 0, accessGrantedByLiveCourseId: null };
  const grantedBy = await firstEntitledLiveCourseId(customerId, liveCourseIds);
  // Full access short-circuits before any preview row is touched, so a paying student
  // never gets a tracking record.
  if (grantedBy != null) return { accessLevel: "full", previewSecondsRemaining: 0, accessGrantedByLiveCourseId: grantedBy };
  if (!customerId) return { accessLevel: "preview", previewSecondsRemaining: LIVE_PREVIEW_SECONDS, accessGrantedByLiveCourseId: null };

  const now = new Date();
  // Always the earliest row: if a race (or a pre-unique-index duplicate) wrote two, the
  // first still bounds the window, so a concurrent request can never restart the clock.
  let preview = await oldestPreviewRow(customerId, liveSessionId);

  if (!preview) {
    // Nothing watched yet. Don't create a row for a SCHEDULED (unplayable) session; report
    // the untouched allowance read-only.
    if (!track) return { accessLevel: "preview", previewSecondsRemaining: LIVE_PREVIEW_SECONDS, accessGrantedByLiveCourseId: null };
    // createMany({ skipDuplicates }) → INSERT IGNORE, so losing the race against
    // uq_live_session_preview_customer_session is a no-op rather than a logged P2002. It
    // relies on the DB constraint, not a schema.prisma @@unique; where the index is missing
    // a duplicate is inserted, which oldest-row-wins renders harmless.
    await prisma.liveSessionPreview.createMany({
      data: [{ customerId, liveSessionId, startedAt: now, consumedSeconds: 0, lastHeartbeatAt: null, createdAt: now }],
      skipDuplicates: true,
    });
    preview = await oldestPreviewRow(customerId, liveSessionId);
    if (!preview) return { accessLevel: "preview", previewSecondsRemaining: LIVE_PREVIEW_SECONDS, accessGrantedByLiveCourseId: null };
  }

  const remaining = previewRemainingFrom(preview.consumedSeconds, preview.lastHeartbeatAt, now);
  return remaining > 0
    ? { accessLevel: "preview", previewSecondsRemaining: remaining, accessGrantedByLiveCourseId: null }
    : { accessLevel: "preview_ended", previewSecondsRemaining: 0, accessGrantedByLiveCourseId: null };
};

export type LivePreviewTickSql = LivePreviewStateSql & { previewTrackingId: string | null };

/**
 /**
  * Commit the watch time owed by an open window, leaving it open (`keepOpen`, a
  * heartbeat) or closed (stop / pause).
  *
  * Compare-and-swap, not read-modify-write: two devices (or a heartbeat racing a retry)
  * can read the same cursor and both add the same charge, draining the trial at 2×.
  * Guarding the UPDATE on the cursor value read makes exactly one writer win; the loser
  * sees `count === 0` and re-reads without charging. Total consumption therefore never
  * exceeds the wall-clock time at least one device was playing.
  *
  * A single conditional UPDATE also stays correct under the IST middleware (it shifts
  * `where` and `data` alike); raw SQL would bypass the shift and mis-compare by 5.5h.
  */
const commitPreviewTick = async (
  customerId: number,
  liveSessionId: number,
  keepOpen: boolean
): Promise<LivePreviewStateSql> => {
  const now = new Date();
  let preview = await oldestPreviewRow(customerId, liveSessionId);

  if (!preview) {
    // First heartbeat with no prior join (or a SCHEDULED session that never made a row).
    // Open the window charging nothing: there is no cursor to measure from.
    if (!keepOpen) return { accessLevel: "preview", previewSecondsRemaining: LIVE_PREVIEW_SECONDS, accessGrantedByLiveCourseId: null };
    await prisma.liveSessionPreview.createMany({
      data: [{ customerId, liveSessionId, startedAt: now, consumedSeconds: 0, lastHeartbeatAt: now, createdAt: now }],
      skipDuplicates: true,
    });
    preview = await oldestPreviewRow(customerId, liveSessionId);
    if (!preview) return { accessLevel: "preview", previewSecondsRemaining: LIVE_PREVIEW_SECONDS, accessGrantedByLiveCourseId: null };
    // Lost the insert race: treat the winner's row as ours.
  }

  const charge = pendingPreviewCharge(preview.lastHeartbeatAt, now);
  const consumed = Math.min(LIVE_PREVIEW_SECONDS, Math.max(0, preview.consumedSeconds) + charge);
  // Once the allowance is gone the window closes regardless of `keepOpen`; a leftover
  // cursor would make the next read compute a phantom pending charge.
  const exhausted = consumed >= LIVE_PREVIEW_SECONDS;
  const nextCursor = keepOpen && !exhausted ? now : null;

  const written = await prisma.liveSessionPreview.updateMany({
    // CAS: `lastHeartbeatAt: <value read>` compiles to `= ?` or `IS NULL`, so a concurrent
    // writer that already moved the cursor makes this match 0 rows.
    where: { id: preview.id, lastHeartbeatAt: preview.lastHeartbeatAt ?? null },
    data: { consumedSeconds: consumed, lastHeartbeatAt: nextCursor },
  });

  if (written.count === 0) {
    // Someone else committed first; their charge covers this interval (shared cursor), so
    // report their result instead of double-billing.
    const fresh = await oldestPreviewRow(customerId, liveSessionId);
    const remaining = fresh
      ? previewRemainingFrom(fresh.consumedSeconds, fresh.lastHeartbeatAt, now)
      : LIVE_PREVIEW_SECONDS;
    return remaining > 0
      ? { accessLevel: "preview", previewSecondsRemaining: remaining, accessGrantedByLiveCourseId: null }
      : { accessLevel: "preview_ended", previewSecondsRemaining: 0, accessGrantedByLiveCourseId: null };
  }

  const remaining = Math.max(0, LIVE_PREVIEW_SECONDS - consumed);
  return remaining > 0
    ? { accessLevel: "preview", previewSecondsRemaining: remaining, accessGrantedByLiveCourseId: null }
    : { accessLevel: "preview_ended", previewSecondsRemaining: 0, accessGrantedByLiveCourseId: null };
};

/**
 * POST /client/live-sessions/:id/preview/heartbeat ("still watching").
 * `isPlaying: false` is treated as a stop, so a pause is metered even if the app never
 * sends /preview/stop. `liveCourseIds` is the entitlement scope as on join: judging a
 * heartbeat from an unpurchased entry point against every linked course would report
 * `full` and stop metering a trial the student is consuming.
 */
export const previewHeartbeatSql = async (
  customerId: number,
  liveSessionId: number,
  liveCourseIds: number[],
  isPlaying: boolean
): Promise<LivePreviewTickSql> => {
  const trackingId = buildPreviewTrackingId(customerId, liveSessionId);
  // Ungated session, or a genuine purchase → no trial to meter, no row created.
  if (!liveCourseIds.length) return { accessLevel: "full", previewSecondsRemaining: 0, accessGrantedByLiveCourseId: null, previewTrackingId: null };
  const grantedBy = await firstEntitledLiveCourseId(customerId, liveCourseIds);
  if (grantedBy != null) return { accessLevel: "full", previewSecondsRemaining: 0, accessGrantedByLiveCourseId: grantedBy, previewTrackingId: null };

  const state = await commitPreviewTick(customerId, liveSessionId, isPlaying);
  return { ...state, previewTrackingId: state.accessLevel === "preview" ? trackingId : null };
};

/**
 * POST /client/live-sessions/:id/preview/stop (pause, background, navigate away).
 * Idempotent: commits what the open window owes and clears the cursor; a second call
 * finds `last_heartbeat_at` NULL, so `pendingPreviewCharge` is 0 and the CAS rewrites
 * the same values. Stopping a never-started trial is a no-op.
 */
export const previewStopSql = async (
  customerId: number,
  liveSessionId: number,
  liveCourseIds: number[]
): Promise<LivePreviewTickSql> => {
  const trackingId = buildPreviewTrackingId(customerId, liveSessionId);
  if (!liveCourseIds.length) return { accessLevel: "full", previewSecondsRemaining: 0, accessGrantedByLiveCourseId: null, previewTrackingId: null };
  const grantedBy = await firstEntitledLiveCourseId(customerId, liveCourseIds);
  if (grantedBy != null) return { accessLevel: "full", previewSecondsRemaining: 0, accessGrantedByLiveCourseId: grantedBy, previewTrackingId: null };

  const state = await commitPreviewTick(customerId, liveSessionId, false);
  return { ...state, previewTrackingId: state.accessLevel === "preview" ? trackingId : null };
};

/**
 * Read-only batch preview lookup for list endpoints (Live Now): the accessLevel a
 * non-owner would get, without starting anyone's clock. Only
 * resolveLivePreviewStateSql(track=true), i.e. opening the player, may create a row.
 */
export const previewLevelMapSql = async (
  customerId: number | null,
  liveSessionIds: number[]
): Promise<Map<number, { accessLevel: "preview" | "preview_ended"; previewSecondsRemaining: number }>> => {
  const out = new Map<number, { accessLevel: "preview" | "preview_ended"; previewSecondsRemaining: number }>();
  if (!customerId || !liveSessionIds.length) return out;
  const rows = await prisma.liveSessionPreview.findMany({
    where: { customerId, liveSessionId: { in: liveSessionIds } },
    select: { liveSessionId: true, consumedSeconds: true, lastHeartbeatAt: true },
    orderBy: { id: "asc" },
  });
  const now = new Date();
  for (const r of rows) {
    if (r.liveSessionId == null || out.has(r.liveSessionId)) continue; // first (oldest) row wins
    // Same watch-time rule as the detail endpoint, including an open window's uncommitted
    // time, so a card never advertises a trial the player would end at once. Never charges.
    const remaining = previewRemainingFrom(r.consumedSeconds, r.lastHeartbeatAt, now);
    out.set(r.liveSessionId, { accessLevel: remaining > 0 ? "preview" : "preview_ended", previewSecondsRemaining: remaining });
  }
  return out;
};
