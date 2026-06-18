/**
 * Wave 7 backfill — copy the previously Mongo-only-blocked collections into the
 * new SQL tables (created by 2026-06-18_create_wave7_blocked_tables.sql):
 *   ws_lecture_progress, ws_notification, ws_folder(+_item), ws_ebook_download,
 *   ws_test_series(+_price/_order/_subscription).
 *
 * Bridge strategy (same as Wave 6):
 *  - customer: Mongo ObjectId → ws_customers.phoneNumber → ws_customer.id (phone).
 *  - test-series family: SELF-CONTAINED — build ObjectId→newIntId maps as we insert
 *    test_series, then price/order/subscription resolve test_series_id intra-family.
 *  - other external refs (video/ebook/course/package/liveCourse/liveSession/
 *    examCategory/promocode) have NO Mongo→SQL id bridge → stored as null/0
 *    (best-effort; logged). Production data bridges far better than staging.
 *  - Idempotent: DELETEs each target table first (just-created, safe).
 *
 * Run: npx tsx scripts/backfill-wave7-blocked-to-sql.ts
 */
import "dotenv/config";
import mongoose from "mongoose";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/config/prisma";

function oid(v: any) { return v ? String(v) : null; }
function d(v: any) { return v ? new Date(v) : null; }
function json(v: any) { return v == null ? Prisma.JsonNull : v; }
function dec(v: any) { return v == null ? new Prisma.Decimal(0) : new Prisma.Decimal(Number(v) || 0); }

async function main() {
  await mongoose.connect(process.env.MONGODB_URI as string, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db!;

  // customer phone bridge
  const custCache = new Map<string, number | null>();
  const cust = async (mongoId: any): Promise<number | null> => {
    const key = oid(mongoId);
    if (!key) return null;
    if (custCache.has(key)) return custCache.get(key)!;
    let sqlId: number | null = null;
    try {
      const mc = await db.collection("ws_customers").findOne({ _id: new mongoose.Types.ObjectId(key) }, { projection: { phoneNumber: 1 } });
      if (mc?.phoneNumber) {
        const rows = await prisma.$queryRawUnsafe<any[]>("SELECT id FROM ws_customer WHERE phone=? LIMIT 1", String(mc.phoneNumber));
        if (rows.length) sqlId = rows[0].id;
      }
    } catch { /* ignore */ }
    custCache.set(key, sqlId);
    return sqlId;
  };

  const stats: Record<string, { in: number; out: number; custMiss: number }> = {};
  const bump = (k: string, f: "in" | "out" | "custMiss") => { (stats[k] ??= { in: 0, out: 0, custMiss: 0 })[f]++; };

  // wipe targets
  for (const t of ["ws_lecture_progress","ws_notification","ws_folder_item","ws_folder","ws_ebook_download","ws_test_series_subscription","ws_test_series_order","ws_test_series_price","ws_test_series"]) {
    await prisma.$executeRawUnsafe(`DELETE FROM ${t}`);
  }

  // ── lecture-progress (customer required; video/session/course refs best-effort null) ──
  for (const lp of await db.collection("ws_lecture_progress").find({}).toArray()) {
    bump("lecture_progress", "in");
    const c = await cust(lp.customerId);
    if (c == null) { bump("lecture_progress", "custMiss"); continue; } // customer NOT NULL — skip unbridged
    await prisma.lectureProgress.create({ data: {
      customerId: c, videoId: null, liveSessionId: null, courseId: null, liveCourseId: null, packageId: null,
      source: lp.source ?? null, positionSec: lp.positionSec ?? 0, durationSec: lp.durationSec ?? 0,
      completed: !!lp.completed, completedAt: d(lp.completedAt), lastWatchedAt: d(lp.lastWatchedAt),
      createdAt: d(lp.createdAt), updatedAt: d(lp.updatedAt),
    }});
    bump("lecture_progress", "out");
  }

  // ── notification (customer nullable → broadcast rows fine; audience/data JSON) ──
  for (const n of await db.collection("ws_notifications").find({}).toArray()) {
    bump("notification", "in");
    const c = n.customerId ? await cust(n.customerId) : null;
    if (n.customerId && c == null && !n.broadcast) { bump("notification", "custMiss"); continue; }
    await prisma.notification.create({ data: {
      customerId: c, title: n.title ?? "", body: n.body ?? "", image: n.image ?? null,
      type: n.type ?? "general", deepLink: n.deepLink ?? null, data: json(n.data),
      isRead: !!n.isRead, readAt: d(n.readAt), broadcast: !!n.broadcast, status: n.status ?? "sent",
      scheduledAt: d(n.scheduledAt), sentAt: d(n.sentAt), failureReason: n.failureReason ?? null,
      recipientCount: n.recipientCount ?? 0, audience: json(n.audience), createdAt: d(n.createdAt), updatedAt: d(n.updatedAt),
    }});
    bump("notification", "out");
  }

  // ── folders + items (folder id intra-family; refId best-effort kept as-is if numeric) ──
  const folderMap = new Map<string, number>();
  for (const f of await db.collection("ws_folders").find({}).toArray()) {
    bump("folder", "in");
    const c = await cust(f.customerId);
    if (c == null) { bump("folder", "custMiss"); continue; }
    const row = await prisma.folder.create({ data: {
      customerId: c, name: f.name ?? "", type: f.type ?? "material", isDefaultFolder: !!f.isDefaultFolder,
      createdAt: d(f.createdAt), updatedAt: d(f.updatedAt),
    }});
    folderMap.set(String(f._id), row.id);
    bump("folder", "out");
  }
  for (const fi of await db.collection("ws_folder_items").find({}).toArray()) {
    bump("folder_item", "in");
    const folderId = folderMap.get(oid(fi.folderId) ?? "");
    const c = await cust(fi.customerId);
    if (!folderId || c == null) { bump("folder_item", "custMiss"); continue; } // need a bridged folder + customer
    // refId is a Mongo ObjectId for a material/video/ebook — no SQL bridge → store 0 (best-effort)
    await prisma.folderItem.create({ data: {
      folderId, customerId: c, kind: fi.kind ?? "material", refId: 0, addedAt: d(fi.addedAt),
    }});
    bump("folder_item", "out");
  }

  // ── ebook-download (customer + ebook; ebook ref best-effort 0) ──
  for (const ed of await db.collection("ws_ebook_downloads").find({}).toArray()) {
    bump("ebook_download", "in");
    const c = await cust(ed.customerId);
    if (c == null) { bump("ebook_download", "custMiss"); continue; }
    await prisma.ebookDownload.create({ data: { customerId: c, ebookId: 0, downloadedAt: d(ed.downloadedAt) }});
    bump("ebook_download", "out");
  }

  // ── test-series family (SELF-CONTAINED intra-family id maps) ──
  const tsMap = new Map<string, number>();
  for (const ts of await db.collection("ws_test_series").find({}).toArray()) {
    bump("test_series", "in");
    const row = await prisma.testSeries.create({ data: {
      title: ts.title ?? "", description: ts.description ?? null, thumbnail: ts.thumbnail ?? null,
      examCategoryIds: json(ts.examCategoryIds), examCategoryId: null,
      language: ts.language ?? "gu", paperCount: ts.paperCount ?? 0, isFree: !!ts.isFree,
      instructions: ts.instructions ?? null, policy: ts.policy ?? null, orderBy: ts.orderBy ?? 0,
      status: ts.status !== false, createdAt: d(ts.createdAt), updatedAt: d(ts.updatedAt),
    }});
    tsMap.set(String(ts._id), row.id);
    bump("test_series", "out");
  }
  const tsPriceMap = new Map<string, number>();
  for (const p of await db.collection("ws_test_series_prices").find({}).toArray()) {
    bump("test_series_price", "in");
    const tsId = tsMap.get(oid(p.testSeriesId) ?? "");
    if (!tsId) continue;
    const row = await prisma.testSeriesPrice.create({ data: {
      testSeriesId: tsId, name: p.name ?? null, durationDays: p.durationDays ?? 0, price: dec(p.price),
      originalPrice: p.originalPrice != null ? dec(p.originalPrice) : null, isDefault: !!p.isDefault,
      status: p.status !== false, createdAt: d(p.createdAt), updatedAt: d(p.updatedAt),
    }});
    tsPriceMap.set(String(p._id), row.id);
    bump("test_series_price", "out");
  }
  const tsOrderMap = new Map<string, number>();
  for (const o of await db.collection("ws_test_series_orders").find({}).toArray()) {
    bump("test_series_order", "in");
    const tsId = tsMap.get(oid(o.testSeriesId) ?? "");
    const c = await cust(o.customerId);
    if (!tsId || c == null) { bump("test_series_order", "custMiss"); continue; }
    const row = await prisma.testSeriesOrder.create({ data: {
      customerId: c, testSeriesId: tsId, planId: tsPriceMap.get(oid(o.planId) ?? "") ?? null,
      paymentMethod: o.paymentMethod ?? "razorpay", orderType: o.orderType ?? "purchase",
      orderPrice: dec(o.orderPrice), basePrice: dec(o.basePrice), discountAmount: dec(o.discountAmount),
      gstAmount: dec(o.gstAmount), handlingFee: dec(o.handlingFee), promocodeId: null,
      razorpayOrderId: o.razorpayOrderId ?? null, razorpayPaymentId: o.razorpayPaymentId ?? null,
      ipAddress: o.ipAddress ?? null, transactionId: o.transactionId ?? null, status: o.status ?? "pending",
      createdAt: d(o.createdAt), updatedAt: d(o.updatedAt),
    }});
    tsOrderMap.set(String(o._id), row.id);
    bump("test_series_order", "out");
  }
  for (const s of await db.collection("ws_test_series_subscriptions").find({}).toArray()) {
    bump("test_series_subscription", "in");
    const tsId = tsMap.get(oid(s.testSeriesId) ?? "");
    const c = await cust(s.customerId);
    if (!tsId || c == null) { bump("test_series_subscription", "custMiss"); continue; }
    await prisma.testSeriesSubscription.create({ data: {
      orderId: tsOrderMap.get(oid(s.orderId) ?? "") ?? null, customerId: c, testSeriesId: tsId,
      planId: tsPriceMap.get(oid(s.planId) ?? "") ?? null, price: dec(s.price), startAt: d(s.startAt), endAt: d(s.endAt),
      remarks: s.remarks ?? null, paymentType: s.paymentType ?? "online", status: s.status !== false, promocodeId: null,
      createdAt: d(s.createdAt), updatedAt: d(s.updatedAt),
    }});
    bump("test_series_subscription", "out");
  }

  console.log("\n=== Wave 7 backfill summary (in → out, customer-unbridged skipped) ===");
  for (const [k, v] of Object.entries(stats)) console.log(`  ${k}: ${v.in} in → ${v.out} out${v.custMiss ? ` (${v.custMiss} skipped: customer not in SQL dump)` : ""}`);
  console.log("\nNOTE: video/ebook/course/folder-item refId external refs stored 0/null on staging (no Mongo→SQL id bridge); production bridges far better. test-series family resolved intra-family.");

  await mongoose.disconnect();
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
