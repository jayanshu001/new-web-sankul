/**
 * DB-free check of the client payment handlers (create-order x5 + verify) after the
 * CODE_QUALITY_AUDIT S1/S2 dedupe. Error paths are part of the contract: course/ebook
 * errors reach errorHandler, the other types answer locally. Every service module is stubbed, so this drives the
 * real handler code with fake req/res and asserts status, charged amount, persisted
 * breakdown and verify's table order. No DB, Redis or Razorpay needed.
 * Run: npx tsx scripts/verify-payment-handlers.ts
 */
import crypto from "crypto";
import Module from "module";

process.env.RAZORPAY_KEY_SECRET = "test_secret";
process.env.RAZORPAY_KEY_ID = "rzp_test";

// ---- stubs -----------------------------------------------------------------
const calls: Array<[string, any[]]> = [];
const rec = (name: string, impl: (...a: any[]) => any = () => undefined) => (...a: any[]) => { calls.push([name, a]); return impl(...a); };
let state: Record<string, any> = {};
const reset = (s: Record<string, any> = {}) => { calls.length = 0; state = s; };
const called = (name: string) => calls.filter(([n]) => n === name);

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const stubs: Record<string, any> = {
  "utils/logger": { __esModule: true, default: quiet },
  "utils/crm": { queueCRMLead: rec("crm") },
  "middlewares/autoFlush": { flushUserRouteCache: rec("flush", async () => {}) },
  "config/prisma": { prisma: { package: { findFirst: rec("package.findFirst", async () => state.pkg ?? null) } } },
  "client/payment/razorpay": {
    PAYMENT_ORDER_ECHO_KEYS: ["bookOrderId", "ebookOrderId", "testSeriesOrderId", "subscriptionId", "receiptId", "course", "ebook", "package", "liveCourse", "testSeries", "plan", "promo"],
    getRazorpay: () => (state.noRazorpay ? null : {}),
    createRazorpayOrder: rec("rzp.create", async (_rp: any, p: any) => ({ id: "order_T", amount: p.amount, currency: p.currency })),
    razorpayResponseFor: (o: any) => ({ orderId: o.id, keyId: "rzp_test", amount: o.amount, currency: o.currency }),
  },
  "modules/promo-code/promo-code.service": {
    resolvePromoForPlanSql: rec("promo", async () => state.promo ?? { error: "Invalid promo code." }),
    findActiveByCode: async () => null, promoCovers: () => false, loadLivePlanDiscountsSql: async () => new Map(),
    loadTestSeriesPlanDiscountsSql: async () => new Map(), resolveReferralCode: async () => null, referralCovers: () => false,
  },
  "modules/referral/referral.service": { resolveWalletUsage: rec("wallet", async (_c: number, coin: number | undefined) => state.wallet ?? { coin: coin ?? 0 }) },
  "modules/customer-shipping/customer-shipping.service": { resolveShippingIdForAddress: rec("shipping", async () => state.shipping ?? { ok: true, shippingId: 900 }) },
  "modules/customer-address/customer-address.repository": { customerAddressRepository: { findActiveOwned: async () => ("addressOwned" in state ? state.addressOwned : { id: 1 }) } },
  "modules/order-code-snapshot/order-code-snapshot.service": { buildOrderCodeSnapshots: rec("snapshot", async () => state.snapshot ?? { promocode: null, refferalcode: null }) },
  "modules/commerce-order/commerce-order.service": {
    findCoursePlanForOrder: async () => state.plan ?? null,
    findPackagePlanForOrder: async () => state.plan ?? null,
    createCourseOrderMysql: rec("createCourseOrder", async () => ({ orderId: 11 })),
    createPackageOrderMysql: rec("createPackageOrder", async () => ({ orderId: 12 })),
    findCourseOrderForVerify: rec("find:course", async () => state.own === "course" ? { id: 1, paymentStatus: "pending" } : null),
    verifyCourseOrderMysql: rec("verify:course", async () => ({ _id: "s1", customerId: 7, courseId: 3, packageId: 4, paidAmount: 99, endAt: new Date() })),
    findPackageOrderForVerify: rec("find:package", async () => state.own === "package" ? { id: 2, paymentStatus: "complete" } : null),
    verifyPackageOrderMysql: rec("verify:package", async () => ({ _id: "s2", customerId: 7, targetPackageId: 5, packageId: 6, paidAmount: 50, endAt: new Date() })),
  },
  "modules/catalog-course/catalog-course.service": { findCourseById: async () => state.course ?? null },
  "modules/catalog-ebook/catalog-ebook.service": { findActiveEbookById: async () => state.ebook ?? null },
  "modules/ebook-order/ebook-order.service": {
    findEbookPlanForOrder: async () => state.plan ?? null,
    createEbookOrderMysql: rec("createEbookOrder", async () => ({ orderId: 13 })),
    findEbookOrderForVerify: rec("find:ebook", async () => state.own === "ebook" ? { id: 3, status: "pending" } : null),
    verifyEbookOrderMysql: rec("verify:ebook", async () => ({ customerId: 7, ebookId: 8 })),
  },
  "modules/book-order/book-order.service": {
    findBookOrderForVerify: rec("find:book", async () => state.own === "book" ? { id: 4, status: "pending" } : null),
    verifyBookOrderMysql: rec("verify:book", async () => ({ customerId: 7, tracking: { trackingId: "T" } })),
  },
  "modules/live-course-order/live-course-order.service": {
    findLiveCoursePlanForOrder: async () => state.plan ?? null,
    findLiveCourse: async () => state.liveCourse ?? null,
    listPlansForLiveCourse: async () => [],
    createLiveCourseOrderMysql: rec("createLiveOrder", async () => ({ orderId: 14 })),
    findLiveCourseOrderForVerify: rec("find:live", async () => state.own === "live" ? { id: 5, status: null } : null),
    verifyLiveCourseOrderMysql: rec("verify:live", async () => ({ _id: "s5", customerId: 7, liveCourseId: 9, planId: 10, paidAmount: 70, endAt: new Date() })),
  },
  "modules/test-series-order/test-series-order.service": {
    findPlanForOrder: async () => state.plan ?? null,
    findSeries: async () => state.series ?? null,
    listPlansForSeries: async () => [],
    createOrderMysql: rec("createTsOrder", async () => ({ orderId: 15 })),
    findOrderForVerify: rec("find:ts", async () => state.own === "ts" ? { id: 6, status: "pending" } : null),
    verifyOrderMysql: rec("verify:ts", async () => ({ _id: "s6", customerId: 7, testSeriesId: 2, planId: 3, price: 40, endAt: new Date() })),
  },
  "client/testSeries/testSeries.controller": {
    _shared: { computeBreakdown: (price: number, discount: number) => ({ price, discount, totalAmount: price - discount }) },
  },
};
const origLoad = (Module as any)._load;
(Module as any)._load = function (request: string, parent: any, ...rest: any[]) {
  if (request.startsWith(".")) {
    const abs = require("path").resolve(require("path").dirname(parent?.filename ?? ""), request).replace(/\\/g, "/");
    const key = Object.keys(stubs).find((k) => abs.endsWith("/src/" + k));
    if (key) return stubs[key];
  }
  return origLoad.call(this, request, parent, ...rest);
};

// ---- harness ---------------------------------------------------------------
let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail: unknown = "") => {
  if (cond) pass++; else { fail++; console.log(`  ✗ ${label}`, detail); }
};
const call = async (handler: any, body: any, userId: any = "7") => {
  const out: { status?: number; body?: any; threw?: any } = {};
  const res: any = { status(c: number) { out.status = c; return res; }, json(b: any) { out.body = b; return res; } };
  try {
    await handler({ body, user: userId == null ? undefined : { id: userId }, traceId: "t", originalUrl: "/x", ip: "1.2.3.4", headers: {} }, res);
  } catch (e) {
    out.threw = e; // reaches errorHandler in the app
  }
  return out;
};
const sign = (o: string, p: string) => crypto.createHmac("sha256", "test_secret").update(`${o}|${p}`).digest("hex");

async function main() {
  const { createCourseOrderPayment } = await import("../src/client/payment/course-payment.controller");
  const { createPackageOrderPayment } = await import("../src/client/payment/package-payment.controller");
  const { createEbookOrderPayment } = await import("../src/client/payment/ebook-payment.controller");
  const { createLiveCourseOrderPayment } = await import("../src/client/payment/live-course-payment.controller");
  const { createTestSeriesOrderPayment } = await import("../src/client/payment/test-series-payment.controller");
  const { verifyPayment } = await import("../src/client/payment/verify.controller");

  const promoOk = { result: { finalAmount: 800, promo: { _id: "42" }, originalAmount: 1000, discountAmount: 200, referrerId: null } };

  // course: promo 1000→800, wallet 100 → charged 700
  reset({ plan: { courseId: 3, price: 1000, duration: 30 }, course: { _id: "3", name: "C" }, promo: promoOk, wallet: { coin: 100 } });
  let r = await call(createCourseOrderPayment, { packageId: 4, promocode: "SAVE", coin: 100, customerShippingId: 55 });
  check("course 201", r.status === 201, r);
  check("course razorpay paise", called("rzp.create")[0]?.[1][1].amount === 70000);
  const co = called("createCourseOrder")[0]?.[1][0];
  check("course order breakdown", co?.price === 700 && co?.originalPrice === 1000 && co?.codeDiscount === 200 && co?.coin === 100 && co?.customerShippingId === 900 && co?.customerId === 7, co);
  check("course amountInRupees", r.body?.data?.amountInRupees === 700 && r.body?.data?.razorpay?.amount === 70000);
  check("course receipt prefix", /^course-\d+-[a-z0-9]+$/.test(co?.uniqueId));
  check("course crm", called("crm")[0]?.[1][0].params.amount === 700);

  // course: an invalid body goes to errorHandler (its envelope is the response contract)
  reset();
  r = await call(createCourseOrderPayment, { packageId: "x" });
  check("course zod -> errorHandler", r.status === undefined && r.threw?.name === "ZodError", r);
  // course: promo rejected / below minimum / wallet rejected / auth / no razorpay
  reset({ plan: { courseId: 3, price: 1000 }, course: { _id: "3" }, promo: { error: "Promo code expired." } });
  r = await call(createCourseOrderPayment, { packageId: 4, promocode: "OLD" });
  check("course promo error", r.status === 400 && r.body?.message === "Promo code expired.", r);
  reset({ plan: { courseId: 3, price: 1000 }, course: { _id: "3" }, promo: { result: { ...promoOk.result, finalAmount: 0 } } });
  r = await call(createCourseOrderPayment, { packageId: 4, promocode: "FREE" });
  check("course promo below min", r.status === 400 && /below the minimum payable amount/.test(r.body?.message));
  reset({ plan: { courseId: 3, price: 1000 }, course: { _id: "3" }, wallet: { error: "Insufficient wallet balance", coin: 0 } });
  r = await call(createCourseOrderPayment, { packageId: 4, coin: 5 });
  check("course wallet error", r.status === 400 && r.body?.message === "Insufficient wallet balance", r);
  check("course no razorpay on reject", called("rzp.create").length === 0);
  reset({ plan: { courseId: 3, price: 1000 }, course: { _id: "3" }, wallet: { coin: 1000 } });
  r = await call(createCourseOrderPayment, { packageId: 4, coin: 1000 });
  check("course wallet below min", r.status === 400 && /Please reduce wallet usage/.test(r.body?.message), r);
  reset();
  check("course 401", (await call(createCourseOrderPayment, {}, null)).status === 401);
  reset({ noRazorpay: true });
  check("course 500 no razorpay", (await call(createCourseOrderPayment, {})).status === 500);
  reset();
  check("course non-int 400", (await call(createCourseOrderPayment, {}, "abc")).body?.message === "Invalid customer id.");
  reset({ plan: null });
  check("course plan 404", (await call(createCourseOrderPayment, { packageId: 4 })).status === 404);

  // package: shipping failure message, then happy path without promo
  reset({ shipping: { ok: false, reason: "address_incomplete" } });
  r = await call(createPackageOrderPayment, { packageId: 6, customerShippingId: 1 });
  check("package shipping 400", r.status === 400 && r.body?.message === "Delivery address is incomplete. Please update it and try again.", r);
  reset({ plan: { packageId: 5, price: 500, duration: 90 }, pkg: { id: 5, name: "P" } });
  r = await call(createPackageOrderPayment, { packageId: 6 });
  const po = called("createPackageOrder")[0]?.[1][0];
  check("package 201 + list price charged", r.status === 201 && po?.price === 500 && po?.codeDiscount === 0 && po?.customerShippingId === null && po?.coin === 0, po);
  reset({ plan: { packageId: 5, price: 500 }, pkg: null });
  check("package inactive 404", (await call(createPackageOrderPayment, { packageId: 6 })).status === 404);

  // ebook: referral snapshot lands in the single `code` column
  reset({ plan: { ebookId: 8, price: 300, duration: 365 }, ebook: { _id: "8", name: "E" }, snapshot: { promocode: null, refferalcode: { code: "REF" } }, promo: { result: { finalAmount: 270, promo: { _id: "" }, originalAmount: 300, discountAmount: 30, referrerId: 77 } } });
  r = await call(createEbookOrderPayment, { planId: 1, promocode: "REF" });
  const eo = called("createEbookOrder")[0]?.[1][0];
  check("ebook 201", r.status === 201 && eo?.orderPrice === 270 && eo?.referrerId === 77 && eo?.code?.code === "REF", eo);
  check("ebook paise", called("rzp.create")[0]?.[1][1].amount === 27000);
  reset();
  r = await call(createEbookOrderPayment, { planId: 0 });
  check("ebook zod -> errorHandler", r.status === undefined && r.threw?.name === "ZodError", r);
  // package keeps its own local 400 for a bad body
  reset();
  r = await call(createPackageOrderPayment, { packageId: "x" });
  check("package zod local 400", r.status === 400 && r.body?.message === "Please select a valid plan." && !!r.body?.errors, r);

  // live course: address-book ownership check only for material plans; live- receipt
  reset({ plan: { liveCourseId: 9, price: 2000, duration: 30, withMaterial: true }, liveCourse: { name: "L", status: true }, addressOwned: null });
  r = await call(createLiveCourseOrderPayment, { planId: 10, customerShippingId: 3 });
  check("live address 400", r.status === 400 && r.body?.message === "Delivery address does not belong to this customer.", r);
  reset({ plan: { liveCourseId: 9, price: 2000, duration: 30, withMaterial: false }, liveCourse: { name: "L", status: true } });
  r = await call(createLiveCourseOrderPayment, { planId: 10, customerShippingId: 3 });
  const lo = called("createLiveOrder")[0]?.[1][0];
  check("live 201", r.status === 201 && lo?.amount === 2000 && lo?.originalAmount === null && lo?.customerShippingId === null && /^live-\d+-/.test(lo?.uniqueId), lo);
  check("live snapshot planKind", called("snapshot")[0]?.[1][0].planKind === "livePlan");
  reset({ plan: { liveCourseId: 9, price: 2000 }, liveCourse: { status: false } });
  check("live inactive 404", (await call(createLiveCourseOrderPayment, { planId: 10 })).status === 404);

  // test series: breakdown total minus wallet; wallet message wins over the final check
  reset({ plan: { testSeriesId: 2, price: 400, durationDays: 30 }, series: { id: 2, title: "T" }, wallet: { coin: 100 } });
  r = await call(createTestSeriesOrderPayment, { planId: 3, coin: 100 });
  const to = called("createTsOrder")[0]?.[1][0];
  check("ts 201", r.status === 201 && to?.bd.totalAmount === 300 && to?.coin === 100 && r.body?.data?.amountInRupees === 300, r);
  check("ts paise + receipt", called("rzp.create")[0]?.[1][1].amount === 30000 && /^ts-/.test(to?.uniqueId));
  reset({ plan: { testSeriesId: 2, price: 400 }, series: { id: 2 }, wallet: { coin: 400 } });
  r = await call(createTestSeriesOrderPayment, { planId: 3, coin: 400 });
  check("ts wallet below min", r.status === 400 && /Please reduce wallet usage/.test(r.body?.message), r);
  reset({ plan: { testSeriesId: 2, price: 400 }, series: { id: 2 }, promo: { result: { discountAmount: 400, promo: { _id: "1" } } } });
  r = await call(createTestSeriesOrderPayment, { planId: 3, promocode: "ALL" });
  check("ts final below min", r.status === 400 && r.body?.message === "Final amount is below the minimum payable. Please contact support.", r);

  // verify
  const body = (o: string) => ({ razorpay_order_id: o, razorpay_payment_id: "pay_1", razorpay_signature: sign(o, "pay_1") });
  reset({ own: "course" });
  r = await call(verifyPayment, { ...body("order_A"), razorpay_signature: "bad" });
  check("verify bad signature 400", r.status === 400 && r.body?.message === "Signature verification failed.");
  check("verify bad signature crm failed", called("crm").length === 1);
  reset({ own: "course" });
  r = await call(verifyPayment, body("order_A"));
  check("verify course 200", r.status === 200 && r.body?.success === true && called("flush").length === 1 && called("crm")[0]?.[1][0].params.courseId === 3, r);
  check("verify course stops early", called("find:package").length === 0);
  reset({ own: "package" });
  r = await call(verifyPayment, body("order_B"));
  check("verify settled package still verifies", r.status === 200 && called("verify:package").length === 1 && called("crm")[0]?.[1][0].params.packageId === 5);
  reset({ own: "ebook" });
  r = await call(verifyPayment, body("order_C"));
  check("verify ebook 200 no crm", r.status === 200 && called("crm").length === 0 && called("flush").length === 1);
  reset({ own: "ts" });
  r = await call(verifyPayment, body("order_D"));
  const order = calls.filter(([n]) => n.startsWith("find:")).map(([n]) => n);
  check("verify table order", JSON.stringify(order) === JSON.stringify(["find:course", "find:package", "find:ebook", "find:book", "find:live", "find:ts"]), order);
  check("verify ts crm amount", r.status === 200 && called("crm")[0]?.[1][0].params.amount === 40);
  reset({ own: "live" });
  check("verify live 200", (await call(verifyPayment, body("order_E"))).status === 200 && called("verify:live").length === 1);
  reset({});
  r = await call(verifyPayment, body("order_F"));
  check("verify none 404", r.status === 404 && r.body?.message === "No local order found for this Razorpay order id.");
  reset({ own: "course" });
  r = await call(verifyPayment, body("order_G"), "abc");
  check("verify non-int customer 404", r.status === 404 && called("find:course").length === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
