/**
 * Race check for paid-order fulfillment.
 *
 * Razorpay's webhook and the app's /payment/verify call routinely arrive together.
 * Both read the order while it is still "pending", so both used to fulfil it: two
 * subscriptions, and for books / material kits two dispatch rows (two parcels).
 *
 * For each of the five order types this clones a real order as a fresh PENDING
 * row, fires the fulfillment twice CONCURRENTLY with the same pending snapshot
 * (exactly what the two callers hold), and asserts ONE entitlement came out.
 * Everything it writes is deleted again.
 *
 *   npx tsx scripts/verify-order-claim-race.ts
 *
 * Local database only — refuses to run against a non-local DATABASE_URL.
 */
import "dotenv/config";
import { prisma } from "../src/config/prisma";
import { verifyCourseOrderMysql, verifyPackageOrderMysql } from "../src/modules/commerce-order/commerce-order.service";
import { toCourseOrderRow } from "../src/modules/commerce-order/commerce-order.transformer";
import { verifyEbookOrderMysql, fulfillEbookWebhookMysql } from "../src/modules/ebook-order/ebook-order.service";
import { toEbookOrderRow } from "../src/modules/ebook-order/ebook-order.transformer";
import { verifyBookOrderMysql, fulfillBookWebhookMysql } from "../src/modules/book-order/book-order.service";
import { toBookOrderRow } from "../src/modules/book-order/book-order.transformer";
import { verifyLiveCourseOrderMysql, fulfillLiveCourseWebhookMysql } from "../src/modules/live-course-order/live-course-order.service";
import * as ts from "../src/modules/test-series-order/test-series-order.service";

const stamp = Date.now();
const rzp = (kind: string) => `order_RACE_${kind}_${stamp}`;
const pay = (kind: string) => `pay_RACE_${kind}_${stamp}`;
// A clone never carries a code, a referrer or wallet coins: the check is about the
// entitlement count, and those would credit / debit a real customer's wallet.
const clean = { id: undefined, promocode: undefined, refferalcode: undefined, referrerId: null };

let failed = 0;
const report = (kind: string, what: string, count: number) => {
  const ok = count === 1;
  if (!ok) failed++;
  console.log(`  [${ok ? "OK  " : "FAIL"}] ${kind}: ${count} ${what} for one order (want 1)`);
};
const settle = async (kind: string, calls: Promise<unknown>[]) => {
  for (const r of await Promise.allSettled(calls)) {
    if (r.status === "rejected") {
      failed++;
      console.log(`  [FAIL] ${kind}: a caller threw — ${String(r.reason?.message ?? r.reason).split("\n")[0]}`);
    }
  }
};

async function commerce(kind: "course" | "package") {
  // Any order is a usable template; the PLAN decides whether it is a course or a
  // package order, so point the clone at a plan of the kind under test.
  const tpl = await prisma.packageCourseOrder.findFirst({ orderBy: { id: "desc" } });
  const plan = await prisma.packageCourseEbookPrice.findFirst({
    where: kind === "course" ? { courseId: { not: null } } : { packageId: { not: null }, courseId: null },
    orderBy: { id: "desc" },
    select: { id: true },
  });
  if (!tpl || !plan) return console.log(`  [SKIP] ${kind}: no template order / plan in this database`);
  const o = await prisma.packageCourseOrder.create({
    data: { ...tpl, ...clean, planId: plan.id, shipping: null, wsCoin: 0, status: "pending", gatewayOrderId: rzp(kind), gatewayPaymentId: null, uniqueId: rzp(kind) },
  });
  try {
    const verify = kind === "course" ? verifyCourseOrderMysql : verifyPackageOrderMysql;
    // No webhook branch exists for course/package — the race here is a retried /verify.
    await settle(kind, [verify(toCourseOrderRow(o), pay(kind)), verify(toCourseOrderRow(o), pay(kind))]);
    report(kind, "subscription(s)", await prisma.packageCourseSubscription.count({ where: { orderId: o.id } }));
  } finally {
    await prisma.packageCourseSubscription.deleteMany({ where: { orderId: o.id } });
    await prisma.packageCourseSubscriptionTracking.deleteMany({ where: { orderId: o.id } });
    await prisma.packageCourseOrder.delete({ where: { id: o.id } });
  }
}

async function ebook() {
  const tpl = await prisma.eBookOrder.findFirst({
    where: { PackageCourseEbookPrice: { ebookId: { not: null } } },
    orderBy: { id: "desc" },
  });
  if (!tpl) return console.log("  [SKIP] ebook: no template order in this database");
  const o = await prisma.eBookOrder.create({
    data: { ...tpl, ...clean, refferalcode: undefined, walletCoin: 0, status: "pending", gatewayOrderId: rzp("ebook"), gatewayPaymentId: null, uniqueId: rzp("ebook") } as any,
  });
  try {
    await settle("ebook", [verifyEbookOrderMysql(toEbookOrderRow(o), pay("ebook")), fulfillEbookWebhookMysql(rzp("ebook"), pay("ebook"))]);
    report("ebook", "subscription(s)", await prisma.eBookSubscription.count({ where: { orderId: o.id } }));
  } finally {
    await prisma.eBookSubscription.deleteMany({ where: { orderId: o.id } });
    await prisma.eBookOrder.delete({ where: { id: o.id } });
  }
}

async function book() {
  const tpl = await prisma.bookOrder.findFirst({ orderBy: { id: "desc" } });
  if (!tpl) return console.log("  [SKIP] book: no template order in this database");
  const key = `RACE-${stamp}`;
  // verifyBookTx deactivates the customer's active carts — put them back afterwards.
  const carts = await prisma.bookCart.findMany({ where: { userId: tpl.userId ?? 0, active: true }, select: { id: true } });
  const o = await prisma.bookOrder.create({
    data: { ...tpl, id: undefined, receiptId: key, status: "pending", trackingId: null, paidAt: null, gatewayOrderId: rzp("book"), gatewayPaymentId: null },
  });
  try {
    await settle("book", [verifyBookOrderMysql(toBookOrderRow(o), pay("book")), fulfillBookWebhookMysql(rzp("book"), pay("book"))]);
    report("book", "AWB tracking row(s)", await prisma.bookTracking.count({ where: { orderId: key } }));
  } finally {
    await prisma.bookOrder.delete({ where: { id: o.id } });
    await prisma.bookTracking.deleteMany({ where: { orderId: key } });
    if (carts.length) await prisma.bookCart.updateMany({ where: { id: { in: carts.map((c) => c.id) } }, data: { active: true } });
  }
}

async function liveCourse() {
  const tpl = await prisma.liveCourseOrder.findFirst({ where: { planId: { not: null } }, orderBy: { id: "desc" } });
  if (!tpl) return console.log("  [SKIP] live course: no template order in this database");
  const o = await prisma.liveCourseOrder.create({
    data: { ...tpl, ...clean, wsCoin: 0, status: "pending", razorpayOrderId: rzp("live"), razorpayPaymentId: null, uniqueId: rzp("live") },
  });
  try {
    await settle("live course", [verifyLiveCourseOrderMysql(o, pay("live")), fulfillLiveCourseWebhookMysql(rzp("live"), pay("live"))]);
    report("live course", "subscription(s)", await prisma.liveCourseSubscription.count({ where: { orderId: o.id } }));
  } finally {
    await prisma.liveCourseSubscription.deleteMany({ where: { orderId: o.id } });
    await prisma.liveCourseSubscriptionTracking.deleteMany({ where: { orderId: o.id } });
    await prisma.liveCourseOrder.delete({ where: { id: o.id } });
  }
}

async function testSeries() {
  const tpl = await prisma.testSeriesOrder.findFirst({ where: { planId: { not: null } }, orderBy: { id: "desc" } });
  if (!tpl) return console.log("  [SKIP] test series: no template order in this database");
  const o = await prisma.testSeriesOrder.create({
    data: { ...tpl, ...clean, wsCoin: 0, status: "pending", razorpayOrderId: rzp("ts"), razorpayPaymentId: null, uniqueId: rzp("ts") },
  });
  try {
    await settle("test series", [ts.verifyOrderMysql(o, pay("ts")), ts.fulfillWebhookMysql(rzp("ts"), pay("ts"))]);
    report("test series", "subscription(s)", await prisma.testSeriesSubscription.count({ where: { orderId: o.id } }));
  } finally {
    await prisma.testSeriesSubscription.deleteMany({ where: { orderId: o.id } });
    await prisma.testSeriesOrder.delete({ where: { id: o.id } });
  }
}

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "mysql://unset").hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`refusing to run against a non-local database (${host})`);
  }
  console.log("order claim race — two concurrent fulfillments per order\n");
  await commerce("course");
  await commerce("package");
  await ebook();
  await book();
  await liveCourse();
  await testSeries();
  console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
  process.exitCode = failed ? 1 : 0;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
