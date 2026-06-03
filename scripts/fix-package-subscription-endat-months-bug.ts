/**
 * One-shot repair: fix PackageCourseSubscription rows whose `endAt` was
 * computed with MONTH semantics by the buggy /payment/verify package-course
 * branch (now fixed to use DAYS via `asDays:true`).
 *
 * Background
 * ----------
 * Plan `duration` on PackageCourseEbookPrice is stored in DAYS. The webhook,
 * ebook, and test-series activation paths all apply setDate (days). The verify
 * package-course branch previously applied setMonth, so a package bought with
 * `duration: 89` got `endAt = startAt + 89 MONTHS` (~7.4 years / ~2710 days)
 * instead of `startAt + 89 DAYS`. Symptom: "My Subscriptions" shows an absurd
 * `daysLeft` like 2710.
 *
 * Detection (conservative — "exact month-match only")
 * ----------------------------------------------------
 * We ONLY repair a row when its stored `endAt` EXACTLY equals
 * `startAt + duration MONTHS` (millisecond-exact, the bug's signature) AND
 * that value differs from `startAt + duration DAYS`. This means:
 *   - Webhook-fulfilled rows (already days-correct) are untouched.
 *   - Extended/stacked rows (extendEndAt) won't match a clean startAt-based
 *     month computation, so they are NOT auto-fixed — they're reported as
 *     ambiguous for manual review instead of guessed at.
 *
 * For each repaired row, `endAt` is rewritten to `startAt + duration DAYS`
 * using the SAME computeEndAt helper the app uses, so the result is identical
 * to what a correct purchase would have produced.
 *
 * Usage (from repo root)
 * ----------------------
 *   npx ts-node scripts/fix-package-subscription-endat-months-bug.ts            # DRY RUN (default): reports only
 *   npx ts-node scripts/fix-package-subscription-endat-months-bug.ts --apply    # writes the fixes
 *
 * Idempotent. Safe to re-run (a repaired row no longer matches the month
 * signature). Logs full candidate detail + counts.
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../src/config/db";
import { PackageCourseSubscription } from "../src/models/customer/PackageCourseSubscription.model";
import { PackageCourseEbookPrice } from "../src/models/course/PackageCourseEbookPrice.model";
import { computeEndAt } from "../src/utils/planDuration";

const APPLY = process.argv.includes("--apply");

interface Candidate {
  id: string;
  customerId: string;
  durationDays: number;
  startAt: Date;
  currentEndAt: Date;
  proposedEndAt: Date;
}

async function main() {
  await connectDB();

  // Only verified, active package/course subscriptions with both a startAt and
  // an endAt can carry the bug. (A row with no startAt was never activated; a
  // null endAt is a lifetime grant we never touch.)
  const subs = await PackageCourseSubscription.find({
    paymentStatus: "verified",
    startAt: { $ne: null },
    endAt: { $ne: null },
  })
    .select("_id customerId packageId startAt endAt status")
    .lean();

  console.log(`Scanning ${subs.length} verified package/course subscription(s) with startAt+endAt...`);

  // Resolve each row's plan duration. `packageId` on the subscription is the
  // PackageCourseEbookPrice (plan) _id — see the model's field comment.
  const planIds = Array.from(
    new Set(subs.map((s: any) => String(s.packageId)).filter(Boolean))
  );
  const plans = await PackageCourseEbookPrice.find({ _id: { $in: planIds } })
    .select("_id duration")
    .lean();
  const planDuration = new Map<string, number>();
  for (const p of plans as any[]) planDuration.set(String(p._id), Number(p.duration));

  const toFix: Candidate[] = [];
  let missingPlan = 0;
  let alreadyCorrect = 0;
  let ambiguous = 0; // verified+active rows that don't match either clean formula (likely extended)

  for (const s of subs as any[]) {
    const duration = planDuration.get(String(s.packageId));
    if (duration == null || !Number.isFinite(duration) || duration <= 0) {
      missingPlan += 1;
      continue;
    }

    const startAt = new Date(s.startAt);
    const currentEndAt = new Date(s.endAt);

    // Recompute both interpretations from startAt, using the app's own helper
    // so arithmetic matches exactly (setMonth vs setDate edge cases included).
    const daysEndAt = computeEndAt({ startAt, durationMonths: duration, asDays: true });
    const monthsEndAt = computeEndAt({ startAt, durationMonths: duration, asDays: false });

    const cur = currentEndAt.getTime();
    const matchesDays = cur === daysEndAt.getTime();
    const matchesMonths = cur === monthsEndAt.getTime();

    if (matchesDays) {
      // Already correct (webhook path, or previously repaired). Leave it.
      alreadyCorrect += 1;
      continue;
    }

    if (matchesMonths && monthsEndAt.getTime() !== daysEndAt.getTime()) {
      // Bug signature: endAt is exactly startAt + duration MONTHS. Repair.
      toFix.push({
        id: String(s._id),
        customerId: String(s.customerId),
        durationDays: duration,
        startAt,
        currentEndAt,
        proposedEndAt: daysEndAt,
      });
      continue;
    }

    // Neither clean formula matched — almost certainly an extended/stacked row
    // (extendEndAt) or a manual admin override. We do NOT touch these; report
    // so a human can review.
    ambiguous += 1;
  }

  // ---- Report ----
  console.log("");
  console.log(`  already days-correct : ${alreadyCorrect}`);
  console.log(`  plan missing/invalid : ${missingPlan}`);
  console.log(`  ambiguous (skipped)  : ${ambiguous}  (extended/stacked or manual — review manually)`);
  console.log(`  month-bug to repair  : ${toFix.length}`);
  console.log("");

  if (toFix.length) {
    console.log("Rows matching the month-semantics bug:");
    for (const c of toFix) {
      const curDays = Math.ceil((c.currentEndAt.getTime() - c.startAt.getTime()) / 86_400_000);
      const newDays = Math.ceil((c.proposedEndAt.getTime() - c.startAt.getTime()) / 86_400_000);
      console.log(
        `  - ${c.id}  cust=${c.customerId}  dur=${c.durationDays}d  ` +
          `startAt=${c.startAt.toISOString()}  ` +
          `endAt ${c.currentEndAt.toISOString()} (${curDays}d) -> ${c.proposedEndAt.toISOString()} (${newDays}d)`
      );
    }
  }

  if (!APPLY) {
    console.log("");
    console.log("DRY RUN — no changes written. Re-run with --apply to persist the fixes above.");
    await mongoose.disconnect();
    return;
  }

  let updated = 0;
  for (const c of toFix) {
    await PackageCourseSubscription.updateOne(
      { _id: c.id, endAt: c.currentEndAt }, // guard: only write if endAt unchanged since scan
      { $set: { endAt: c.proposedEndAt } }
    );
    updated += 1;
  }

  console.log("");
  console.log(`APPLIED. Updated ${updated} subscription row(s).`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
