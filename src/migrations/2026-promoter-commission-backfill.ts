/**
 * One-shot migration: backfill promoter commission on PAST subscriptions.
 *
 * Context: promoter commission (promoterPercentage / promoterCommission) was
 * recorded on NEITHER subscription until 2026-06-16 — only the per-plan link
 * row (`PromotedPackageCourseEbook.promoterPercentage`) held the %. This fills
 * the gap for already-sold subscriptions so promoter dashboards show historical
 * commission.
 *
 * For each subscription that has a `promocodeId` but no `promoterCommission`:
 *   1. Find the (promocodeId, planId) link row → its `promoterPercentage`.
 *   2. Set promoterId (from the promo), promoterPercentage (from link),
 *      promoterCommission = amountCharged × promoterPercentage / 100.
 *
 * Plan-id field per model:
 *   - PackageCourseSubscription: `packageId`  (= PackageCourseEbookPrice._id)
 *   - TestSeriesSubscription:    `planId`
 *   - LiveCourseSubscription:    `planId`
 *   - EbookSubscription:         no planId on the sub → joined via EbookOrder.planId
 * Amount field per model: Package/Live use `paidAmount`; Ebook/Test use `price`.
 *
 * Idempotent: rows that already have `promoterCommission` set are skipped.
 *
 *   npx tsx src/migrations/2026-promoter-commission-backfill.ts
 */

import mongoose from "mongoose";
import { PromoCode } from "../models/course/PromoCode.model";
import { PromotedPackageCourseEbook } from "../models/course/PromotedPackageCourseEbook.model";
import { PackageCourseSubscription } from "../models/customer/PackageCourseSubscription.model";
import { EbookSubscription } from "../models/ebook/EbookSubscription.model";
import { EbookOrder } from "../models/ebook/EbookOrder.model";
import { TestSeriesSubscription } from "../models/testSeries/TestSeriesSubscription.model";
import { LiveCourseSubscription } from "../models/customer/LiveCourseSubscription.model";

export interface PromoterCommissionBackfillStats {
  packageCourse: number;
  ebook: number;
  testSeries: number;
  liveCourse: number;
  skippedNoLink: number;
}

// Build a (promocodeId|planId) → promoterPercentage lookup once, plus a
// promocodeId → promoterId map. Returns helpers for the per-model passes.
async function buildLinkLookups() {
  const links = await PromotedPackageCourseEbook.find({})
    .select("promocodeId planId promoterPercentage")
    .lean();
  const pctByKey = new Map<string, number>();
  for (const l of links as any[]) {
    pctByKey.set(`${String(l.promocodeId)}|${String(l.planId)}`, Number(l.promoterPercentage ?? 0));
  }

  const promos = await PromoCode.find({}).select("_id promoterId").lean();
  const promoterByCode = new Map<string, string | null>();
  for (const p of promos as any[]) {
    promoterByCode.set(String(p._id), p.promoterId ? String(p.promoterId) : null);
  }
  return { pctByKey, promoterByCode };
}

const commissionOf = (amount: number, pct: number) =>
  Math.max(0, Math.round((Number(amount || 0) * Number(pct || 0)) / 100));

export async function runPromoterCommissionBackfill(): Promise<PromoterCommissionBackfillStats> {
  if (!mongoose.connection.db) throw new Error("Mongo connection is not open.");
  const { pctByKey, promoterByCode } = await buildLinkLookups();
  const stats: PromoterCommissionBackfillStats = {
    packageCourse: 0,
    ebook: 0,
    testSeries: 0,
    liveCourse: 0,
    skippedNoLink: 0,
  };

  // ── Package / Course (planId = packageId; amount = paidAmount) ──────────────
  const pcRows = await PackageCourseSubscription.find({
    promocodeId: { $ne: null },
    promoterCommission: null,
  }).select("_id promocodeId packageId paidAmount");
  for (const s of pcRows as any[]) {
    const pct = pctByKey.get(`${String(s.promocodeId)}|${String(s.packageId)}`);
    if (pct === undefined) { stats.skippedNoLink++; continue; }
    s.promoterId = promoterByCode.get(String(s.promocodeId)) ?? s.promoterId ?? null;
    s.promoterPercentage = pct;
    s.promoterCommission = commissionOf(s.paidAmount, pct);
    await s.save();
    stats.packageCourse++;
  }

  // ── Test Series (planId = planId; amount = price) ──────────────────────────
  const tsRows = await TestSeriesSubscription.find({
    promocodeId: { $ne: null },
    promoterCommission: null,
  }).select("_id promocodeId planId price");
  for (const s of tsRows as any[]) {
    if (!s.planId) { stats.skippedNoLink++; continue; }
    const pct = pctByKey.get(`${String(s.promocodeId)}|${String(s.planId)}`);
    if (pct === undefined) { stats.skippedNoLink++; continue; }
    s.promoterId = promoterByCode.get(String(s.promocodeId)) ?? null;
    s.promoterPercentage = pct;
    s.promoterCommission = commissionOf(s.price, pct);
    await s.save();
    stats.testSeries++;
  }

  // ── Live Course (planId = planId; amount = paidAmount) ─────────────────────
  const lcRows = await LiveCourseSubscription.find({
    promocodeId: { $ne: null },
    promoterCommission: null,
  }).select("_id promocodeId planId paidAmount");
  for (const s of lcRows as any[]) {
    const pct = pctByKey.get(`${String(s.promocodeId)}|${String(s.planId)}`);
    if (pct === undefined) { stats.skippedNoLink++; continue; }
    s.promoterId = promoterByCode.get(String(s.promocodeId)) ?? null;
    s.promoterPercentage = pct;
    s.promoterCommission = commissionOf(s.paidAmount, pct);
    await s.save();
    stats.liveCourse++;
  }

  // ── Ebook (planId joined via EbookOrder.planId; amount = price) ────────────
  const ebRows = await EbookSubscription.find({
    promocodeId: { $ne: null },
    promoterCommission: null,
  }).select("_id promocodeId orderId price");
  // Resolve planId per row through its order in one batched lookup.
  const orderIds = ebRows.map((s: any) => s.orderId).filter(Boolean);
  const orders = orderIds.length
    ? await EbookOrder.find({ _id: { $in: orderIds } }).select("_id planId").lean()
    : [];
  const planByOrder = new Map<string, string | null>();
  for (const o of orders as any[]) planByOrder.set(String(o._id), o.planId ? String(o.planId) : null);
  for (const s of ebRows as any[]) {
    const planId = s.orderId ? planByOrder.get(String(s.orderId)) : null;
    if (!planId) { stats.skippedNoLink++; continue; }
    const pct = pctByKey.get(`${String(s.promocodeId)}|${planId}`);
    if (pct === undefined) { stats.skippedNoLink++; continue; }
    s.promoterId = promoterByCode.get(String(s.promocodeId)) ?? s.promoterId ?? null;
    s.promoterPercentage = pct;
    s.promoterCommission = commissionOf(s.price, pct);
    await s.save();
    stats.ebook++;
  }

  return stats;
}

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is required.");
    process.exit(1);
  }
  await mongoose.connect(uri);
  try {
    const stats = await runPromoterCommissionBackfill();
    console.log("Promoter commission backfill complete:", stats);
  } finally {
    await mongoose.disconnect();
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
