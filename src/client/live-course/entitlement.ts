import mongoose from "mongoose";
import { LiveCourseSubscription } from "../../models/customer/LiveCourseSubscription.model";
import { LiveSessionPreview } from "../../models/customer/LiveSessionPreview.model";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { LiveCoursePlan } from "../../models/course/LiveCoursePlan.model";
import { computeDaysLeft } from "../../utils/planDuration";

// Default per-viewer preview window for non-subscribers, in seconds.
export const PREVIEW_SECONDS = 180;

/**
 * Returns true if the customer holds an active, verified subscription to ANY
 * of the live courses the session belongs to. Multi-course sessions are
 * unlocked for a student as soon as they're paid up on one of them.
 */
export async function hasAccessToAnyLiveCourse(
  customerId: string | undefined,
  liveCourseIds: Array<mongoose.Types.ObjectId | string>
): Promise<boolean> {
  if (!customerId || !Array.isArray(liveCourseIds) || liveCourseIds.length === 0) return false;
  const now = new Date();
  const exists = await LiveCourseSubscription.exists({
    customerId,
    liveCourseId: { $in: liveCourseIds },
    status: true,
    paymentStatus: "verified",
    $or: [{ endAt: null }, { endAt: { $gte: now } }],
  });
  return Boolean(exists);
}

/**
 * Returns `daysLeft` for the longest-lived active+verified subscription a
 * customer has against ANY of the given live courses. Used so detail / schedule
 * / recordings endpoints can surface a single counter even when a session
 * spans multiple courses. `null` means lifetime (or no active sub).
 */
export async function getDaysLeftForLiveCourses(
  customerId: string | undefined,
  liveCourseIds: Array<mongoose.Types.ObjectId | string>
): Promise<number | null> {
  if (!customerId || !Array.isArray(liveCourseIds) || liveCourseIds.length === 0) return null;
  const now = new Date();
  const subs = await LiveCourseSubscription.find({
    customerId,
    liveCourseId: { $in: liveCourseIds },
    status: true,
    paymentStatus: "verified",
    $or: [{ endAt: null }, { endAt: { $gte: now } }],
  }).select("endAt").lean();
  if (!subs.length) return null;
  // Lifetime (endAt null) wins; otherwise pick the latest endAt.
  if (subs.some((s: any) => s.endAt == null)) return null;
  const latest = subs.reduce((acc: Date | null, s: any) => {
    const d = s.endAt as Date;
    return !acc || d.getTime() > acc.getTime() ? d : acc;
  }, null as Date | null);
  return computeDaysLeft(latest, now);
}

/**
 * Bulk variant of getDaysLeftForLiveCourses: returns a map keyed by
 * liveCourseId → daysLeft (`null` if not owned OR lifetime). Used by listing
 * endpoints that need per-row daysLeft without N+1 queries.
 */
export async function getDaysLeftMapForLiveCourses(
  customerId: string | undefined,
  liveCourseIds: Array<mongoose.Types.ObjectId | string>
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  if (!customerId || !Array.isArray(liveCourseIds) || liveCourseIds.length === 0) return out;
  const now = new Date();
  const subs = await LiveCourseSubscription.find({
    customerId,
    liveCourseId: { $in: liveCourseIds },
    status: true,
    paymentStatus: "verified",
    $or: [{ endAt: null }, { endAt: { $gte: now } }],
  }).select("liveCourseId endAt").lean();

  // Lifetime (null endAt) wins; otherwise pick the latest endAt per course.
  const lifetime = new Set<string>();
  const latestByCourse = new Map<string, Date>();
  for (const s of subs as any[]) {
    const key = String(s.liveCourseId);
    if (s.endAt == null) { lifetime.add(key); continue; }
    const prev = latestByCourse.get(key);
    if (!prev || (s.endAt as Date).getTime() > prev.getTime()) latestByCourse.set(key, s.endAt as Date);
  }
  for (const key of lifetime) out.set(key, null);
  for (const [key, endAt] of latestByCourse) {
    if (lifetime.has(key)) continue;
    out.set(key, computeDaysLeft(endAt, now));
  }
  return out;
}

export interface LivePurchaseOption {
  liveCourseId: string;
  name: string;
  image: string;
  plans: Array<{
    planId: string;
    name: string | null;
    duration: number;
    price: number;
    isDefault: boolean;
  }>;
}

/**
 * Build the "buy to unlock" payload for the purchase popup. A live session can
 * be attached to several courses at once; the student may buy ANY one of them
 * to unlock the session, so we return every attached course with its active
 * plans (cheapest first).
 */
export async function buildPurchaseOptions(
  liveCourseIds: Array<mongoose.Types.ObjectId | string>
): Promise<LivePurchaseOption[]> {
  if (!Array.isArray(liveCourseIds) || liveCourseIds.length === 0) return [];

  const [courses, plans] = await Promise.all([
    LiveCourse.find({ _id: { $in: liveCourseIds }, status: true })
      .select("_id name image")
      .lean(),
    LiveCoursePlan.find({ liveCourseId: { $in: liveCourseIds }, status: true })
      .sort({ price: 1 })
      .lean(),
  ]);

  const plansByCourse = new Map<string, typeof plans>();
  for (const p of plans) {
    const key = String(p.liveCourseId);
    if (!plansByCourse.has(key)) plansByCourse.set(key, []);
    plansByCourse.get(key)!.push(p);
  }

  return courses.map((c) => ({
    liveCourseId: String(c._id),
    name: c.name,
    image: c.image,
    plans: (plansByCourse.get(String(c._id)) ?? []).map((p) => ({
      planId: String(p._id),
      name: p.name ?? null,
      duration: p.duration,
      price: p.price,
      isDefault: p.isDefault,
    })),
  }));
}

export type LiveAccessLevel = "full" | "preview" | "preview_ended";

export interface LivePreviewState {
  // "full"          → subscriber (or open session): play with no cutoff.
  // "preview"       → non-subscriber inside their 3-minute trial window.
  // "preview_ended" → non-subscriber whose trial has elapsed; withhold URLs.
  accessLevel: LiveAccessLevel;
  // null for "full", and for non-tracked states (e.g. a SCHEDULED session
  // that hasn't started — we don't burn the trial before there's anything
  // to watch).
  previewExpiresAt: Date | null;
  // Whole seconds left in the trial; 0 unless accessLevel === "preview".
  previewSecondsRemaining: number;
}

// findOneAndUpdate(upsert) can race two concurrent first-views into a
// duplicate-key error. When that happens the row now exists — just read it.
async function getOrCreatePreview(
  customerId: string,
  liveSessionId: mongoose.Types.ObjectId | string,
  now: Date
) {
  try {
    return await LiveSessionPreview.findOneAndUpdate(
      { customerId, liveSessionId },
      { $setOnInsert: { startedAt: now } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  } catch (err: any) {
    if (err?.code === 11000) {
      return LiveSessionPreview.findOne({ customerId, liveSessionId });
    }
    throw err;
  }
}

/**
 * Resolve a customer's access to a live session.
 *
 * - Open sessions (attached to no live course) → "full" for any logged-in user.
 * - Active subscribers → "full".
 * - Everyone else gets a PER-VIEWER 3-minute trial tracked in
 *   LiveSessionPreview. The clock starts the first time they open the session
 *   and cannot be reset. Once it elapses the state flips to "preview_ended"
 *   and the caller must withhold playback URLs.
 *
 * `track` should be false when there is nothing to play yet (e.g. a SCHEDULED
 * session) — in that case a non-subscriber gets "preview" with no clock so the
 * trial isn't consumed before the stream starts.
 */
export async function resolveLivePreviewState(
  customerId: string | undefined,
  liveSessionId: mongoose.Types.ObjectId | string,
  liveCourseIds: Array<mongoose.Types.ObjectId | string>,
  track: boolean
): Promise<LivePreviewState> {
  // Open session — no paywall.
  if (!Array.isArray(liveCourseIds) || liveCourseIds.length === 0) {
    return { accessLevel: "full", previewExpiresAt: null, previewSecondsRemaining: 0 };
  }

  const subscribed = await hasAccessToAnyLiveCourse(customerId, liveCourseIds);
  if (subscribed) {
    return { accessLevel: "full", previewExpiresAt: null, previewSecondsRemaining: 0 };
  }

  // Non-subscriber. Without a customerId we can't track a per-viewer clock —
  // treat as a fresh (untracked) preview. In practice the client route guards
  // requireRole("customer") so this is just defensive.
  if (!track || !customerId) {
    return { accessLevel: "preview", previewExpiresAt: null, previewSecondsRemaining: 0 };
  }

  const now = new Date();
  const preview = await getOrCreatePreview(customerId, liveSessionId, now);
  // Extremely unlikely (the row was just upserted), but stay safe.
  if (!preview) {
    return { accessLevel: "preview", previewExpiresAt: null, previewSecondsRemaining: 0 };
  }

  const previewExpiresAt = new Date(preview.startedAt.getTime() + PREVIEW_SECONDS * 1000);
  if (now.getTime() >= previewExpiresAt.getTime()) {
    return { accessLevel: "preview_ended", previewExpiresAt, previewSecondsRemaining: 0 };
  }

  const previewSecondsRemaining = Math.ceil(
    (previewExpiresAt.getTime() - now.getTime()) / 1000
  );
  return { accessLevel: "preview", previewExpiresAt, previewSecondsRemaining };
}
