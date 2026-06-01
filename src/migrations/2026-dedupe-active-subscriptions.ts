/**
 * One-shot migration: collapse DUPLICATE active subscriptions so each customer
 * has at most one active row per target (course / package / live course).
 *
 * Why: "extend availability" used to insert a new subscription row instead of
 * extending the existing one, so a customer could accumulate two+ active rows
 * for the same course. The "My Subscription" screen then showed the same course
 * twice with different availability dates. The write paths are now fixed to
 * extend-in-place; this backfill cleans up the rows already in the database.
 *
 * Strategy per (customerId, target) group of active+verified rows:
 *   - Keep the row with the FURTHEST-OUT endAt (the most generous access).
 *   - Deactivate the rest with status:false (kept on disk for the audit trail,
 *     hidden from listings). We do NOT delete — payments/receipts reference them.
 *
 * Usage (with the app's Mongo connection already open):
 *
 *     import { runDedupeActiveSubscriptionsMigration } from "./migrations/2026-dedupe-active-subscriptions";
 *     await runDedupeActiveSubscriptionsMigration();
 *
 * Or directly:
 *
 *     npx ts-node -T src/migrations/2026-dedupe-active-subscriptions.ts
 *     npx ts-node -T src/migrations/2026-dedupe-active-subscriptions.ts --dry-run
 *
 * Safe to run multiple times — once collapsed, each group has a single active
 * row and is skipped.
 */

import mongoose from "mongoose";
import { PackageCourseSubscription } from "../models/customer/PackageCourseSubscription.model";
import { LiveCourseSubscription } from "../models/customer/LiveCourseSubscription.model";

interface DedupeStats {
  courseGroupsCollapsed: number;
  courseRowsDeactivated: number;
  liveGroupsCollapsed: number;
  liveRowsDeactivated: number;
}

const endAtMs = (d: Date | null | undefined): number =>
  d ? new Date(d).getTime() : Number.POSITIVE_INFINITY; // null endAt = lifetime; treat as furthest-out

export async function runDedupeActiveSubscriptionsMigration(opts?: {
  dryRun?: boolean;
}): Promise<DedupeStats> {
  const dryRun = !!opts?.dryRun;
  const stats: DedupeStats = {
    courseGroupsCollapsed: 0,
    courseRowsDeactivated: 0,
    liveGroupsCollapsed: 0,
    liveRowsDeactivated: 0,
  };

  // ── Course / Package subscriptions ──────────────────────────────────────────
  {
    const rows = await PackageCourseSubscription.find({
      status: true,
      paymentStatus: "verified",
    })
      .select("_id customerId courseId targetPackageId endAt")
      .lean();

    // Group by (customer, target). Course subs key on courseId; package subs on
    // targetPackageId. Rows with neither are left alone (their own _id key).
    const groups = new Map<string, any[]>();
    for (const r of rows as any[]) {
      const target = r.courseId
        ? `c:${String(r.courseId)}`
        : r.targetPackageId
        ? `p:${String(r.targetPackageId)}`
        : `s:${String(r._id)}`;
      const key = `${String(r.customerId)}|${target}`;
      const arr = groups.get(key);
      if (arr) arr.push(r);
      else groups.set(key, [r]);
    }

    const toDeactivate: any[] = [];
    for (const [, arr] of groups) {
      if (arr.length < 2) continue;
      arr.sort((a, b) => endAtMs(b.endAt) - endAtMs(a.endAt)); // furthest-out first
      const losers = arr.slice(1);
      toDeactivate.push(...losers.map((l) => l._id));
      stats.courseGroupsCollapsed += 1;
    }

    stats.courseRowsDeactivated = toDeactivate.length;
    if (!dryRun && toDeactivate.length) {
      await PackageCourseSubscription.updateMany(
        { _id: { $in: toDeactivate } },
        { $set: { status: false } }
      );
    }
  }

  // ── Live course subscriptions ───────────────────────────────────────────────
  {
    const rows = await LiveCourseSubscription.find({
      status: true,
      paymentStatus: "verified",
    })
      .select("_id customerId liveCourseId endAt")
      .lean();

    const groups = new Map<string, any[]>();
    for (const r of rows as any[]) {
      const key = `${String(r.customerId)}|${String(r.liveCourseId)}`;
      const arr = groups.get(key);
      if (arr) arr.push(r);
      else groups.set(key, [r]);
    }

    const toDeactivate: any[] = [];
    for (const [, arr] of groups) {
      if (arr.length < 2) continue;
      arr.sort((a, b) => endAtMs(b.endAt) - endAtMs(a.endAt));
      const losers = arr.slice(1);
      toDeactivate.push(...losers.map((l) => l._id));
      stats.liveGroupsCollapsed += 1;
    }

    stats.liveRowsDeactivated = toDeactivate.length;
    if (!dryRun && toDeactivate.length) {
      await LiveCourseSubscription.updateMany(
        { _id: { $in: toDeactivate } },
        { $set: { status: false } }
      );
    }
  }

  return stats;
}

// Allow direct execution: `npx ts-node -T src/migrations/2026-dedupe-active-subscriptions.ts`
if (require.main === module) {
  (async () => {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      console.error("MONGODB_URI is required.");
      process.exit(1);
    }
    const dryRun = process.argv.includes("--dry-run");
    await mongoose.connect(uri);
    try {
      const stats = await runDedupeActiveSubscriptionsMigration({ dryRun });
      console.log(
        `Dedupe active subscriptions ${dryRun ? "(DRY RUN) " : ""}complete:`,
        stats
      );
    } finally {
      await mongoose.disconnect();
    }
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
