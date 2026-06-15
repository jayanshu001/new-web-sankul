/**
 * One-shot migration: fix `endAt` on live-course subscriptions that were computed
 * with `setMonth` while `LiveCoursePlan.duration` is actually DAYS.
 *
 * Bug: every live-course fulfillment path (verify, webhook, admin grant) fed
 * `plan.duration` into `computeEndAt` WITHOUT `asDays:true`, so a "180 day" plan
 * produced `startAt + 180 MONTHS` (~15 years) instead of `startAt + 180 days`.
 * The client live-courses API then surfaced `daysLeft` values like 5479.
 *
 * Fix (code) switches all those callsites to `asDays:true`. This migration
 * repairs already-written rows by recomputing `endAt = startAt + plan.duration
 * days` for verified, time-boxed subscriptions whose stored window is clearly the
 * months-bug result.
 *
 * Guards / safety:
 *   - Only `paymentStatus: "verified"` rows with BOTH `startAt` and `endAt` set.
 *   - Lifetime grants (`endAt: null`) are skipped — nothing to recompute.
 *   - Only rows where the stored span EXCEEDS the day-based expectation by a wide
 *     margin (≥ 2× and at least 31 days over) are treated as corrupted. This makes
 *     the migration IDEMPOTENT (already-correct rows are skipped) and avoids
 *     touching rows an admin set by an explicit `endAt`/`startAt` window.
 *   - Rows whose plan is missing or has no usable duration are left untouched and
 *     reported.
 *
 * NOTE on extended subscriptions: rows that were stacked (extend-on-active) had
 * their stacked time ALSO computed in months, so they're corrupt too — but the
 * original stack count can't be reconstructed. We recompute to a single
 * `startAt + duration days` window, which is the correct value for the common
 * single-purchase case. Every modified row is logged (old → new) so stacked rows
 * can be manually topped up if any customer disputes their validity.
 *
 * Forward-only. Idempotent. No down migration.
 *
 * Usage:
 *     MONGODB_URI="<uri>" npx tsx src/migrations/2026-livecourse-fix-endat-days.ts
 *
 *     // Dry run (report only, no writes):
 *     DRY_RUN=1 MONGODB_URI="<uri>" npx tsx src/migrations/2026-livecourse-fix-endat-days.ts
 */

import "dotenv/config";
import mongoose from "mongoose";

const DAY_MS = 86_400_000;

interface MigrationStats {
  scanned: number;
  fixed: number;
  skippedAlreadyCorrect: number;
  skippedNoPlanDuration: number;
  skippedLifetimeOrUnbounded: number;
}

export async function runLiveCourseFixEndAtDaysMigration(
  opts: { dryRun?: boolean } = {}
): Promise<MigrationStats> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Mongo connection is not open.");

  const subs = db.collection("ws_live_course_subscriptions");
  const plans = db.collection("ws_live_course_plans");

  const stats: MigrationStats = {
    scanned: 0,
    fixed: 0,
    skippedAlreadyCorrect: 0,
    skippedNoPlanDuration: 0,
    skippedLifetimeOrUnbounded: 0,
  };

  const cursor = subs.find({ paymentStatus: "verified" });

  while (await cursor.hasNext()) {
    const doc: any = await cursor.next();
    stats.scanned += 1;

    const startAt: Date | null = doc.startAt ? new Date(doc.startAt) : null;
    const endAt: Date | null = doc.endAt ? new Date(doc.endAt) : null;
    if (!startAt || !endAt) {
      stats.skippedLifetimeOrUnbounded += 1;
      continue;
    }

    const plan: any = doc.planId ? await plans.findOne({ _id: doc.planId }, { projection: { duration: 1 } }) : null;
    const durationDays = Number(plan?.duration ?? 0);
    if (!durationDays || durationDays < 1) {
      stats.skippedNoPlanDuration += 1;
      continue;
    }

    // Correct window: startAt + durationDays (setDate semantics ≈ + N*DAY_MS for
    // a plain day count; DST edge of ±1h is immaterial to a day-granularity field).
    const correctEndAt = new Date(startAt.getTime());
    correctEndAt.setDate(correctEndAt.getDate() + durationDays);

    const storedSpanDays = (endAt.getTime() - startAt.getTime()) / DAY_MS;

    // Corruption signature: stored window is far larger than the day expectation.
    const isCorrupted =
      storedSpanDays >= durationDays * 2 && storedSpanDays - durationDays >= 31;

    if (!isCorrupted) {
      stats.skippedAlreadyCorrect += 1;
      continue;
    }

    console.log(
      `[fix] sub=${doc._id} plan=${doc.planId} durationDays=${durationDays} ` +
        `startAt=${startAt.toISOString()} oldEndAt=${endAt.toISOString()} ` +
        `(${Math.round(storedSpanDays)}d) -> newEndAt=${correctEndAt.toISOString()}`
    );

    if (!opts.dryRun) {
      await subs.updateOne({ _id: doc._id }, { $set: { endAt: correctEndAt } });
    }
    stats.fixed += 1;
  }

  return stats;
}

// One-shot script — invoked directly via `npx tsx`, never imported by the app.
// Run unconditionally (see sibling migrations for why guards don't work across
// the ESM-runtime / CJS-build split).
(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is required.");
    process.exit(1);
  }
  const dryRun = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
  await mongoose.connect(uri);
  try {
    const stats = await runLiveCourseFixEndAtDaysMigration({ dryRun });
    console.log(`Live-course endAt fix ${dryRun ? "(DRY RUN) " : ""}complete:`, stats);
  } finally {
    await mongoose.disconnect();
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
