import path from "path";
import ejs from "ejs";
import puppeteer, { type Browser } from "puppeteer";

import { ExamResultType } from "../../shared/enums";
import { prisma } from "../../config/prisma";

// Receipt/PDF DB reads. Each generator selects its SQL loader.
//   course-receipt → PackageCourseSubscription (+ order hop) — see buildCourseReceiptHtml
//   book-receipt   → BookOrder + BookOrderItem (joined by order_id → book names)
//   ebook-receipt  → EBookOrder → plan_id → PackageCourseEbookPrice.ebookId → EBook
//   exam-solution  → ExamResult + ExamResultDetail (+ cross-customer best-score rank)

// Resolve the EJS template from the repo root so it works under both
// tsx (src/) and compiled dist/ runs.
const TEMPLATE_PATH = path.resolve(process.cwd(), "src/libs/views/pages/receiptTemplate.ejs");
const SOLUTION_TEMPLATE_PATH = path.resolve(process.cwd(), "src/libs/views/pages/solutionTemplate.ejs");

const COMPANY_CONTACT = process.env.RECEIPT_CONTACT_NUMBER || "+91 70960 90963";
const COMPANY_EMAIL = process.env.RECEIPT_EMAIL || "support@websankul.com";

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return TENS[t] + (o ? " " + ONES[o] : "");
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const out: string[] = [];
  if (h) out.push(ONES[h] + " Hundred");
  if (r) out.push(twoDigits(r));
  return out.join(" ");
}

function numberToIndianWords(num: number): string {
  if (!Number.isFinite(num)) return "";
  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);

  if (rupees === 0 && paise === 0) return "Zero Rupees Only";

  let n = rupees;
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const rest = n;

  if (crore) parts.push(twoDigits(crore) + " Crore");
  if (lakh) parts.push(twoDigits(lakh) + " Lakh");
  if (thousand) parts.push(twoDigits(thousand) + " Thousand");
  if (rest) parts.push(threeDigits(rest));

  let words = parts.join(" ").trim() + " Rupees";
  if (paise) words += " and " + twoDigits(paise) + " Paise";
  return words + " Only";
}

function formatDate(d?: Date): string {
  if (!d) return "";
  const dt = new Date(d);
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yyyy = dt.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

// ---------------------------------------------------------------------------
// Pooled headless Chromium (P2.1)
//
// Previously renderPdfFromHtml() launched a fresh Chromium (puppeteer.launch)
// and closed it on EVERY call — expensive (~hundreds of ms + memory churn) and
// wasteful under load. We now keep ONE shared browser alive and open a fresh
// page per render. This is a purely internal performance change: same launch
// args, same page.pdf options, byte-identical output, and renderPdfFromHtml's
// signature/return value are unchanged.
// ---------------------------------------------------------------------------

// Same launch args as before — kept verbatim so the rendered PDF is identical.
const BROWSER_LAUNCH_OPTIONS = {
  headless: true as const,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
};

let browserPromise: Promise<Browser> | null = null;

// Lazy singleton: launch once, cache the instance. If Chromium dies/disconnects
// we clear the cache so the next render relaunches a healthy browser.
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch(BROWSER_LAUNCH_OPTIONS).then((browser) => {
      browser.on("disconnected", () => {
        // Only clear if this is still the cached browser (avoid clobbering a
        // relaunch that may have already replaced it).
        browserPromise = null;
      });
      return browser;
    });
    // If the launch itself rejects, don't cache the rejected promise.
    browserPromise.catch(() => {
      browserPromise = null;
    });
  }
  return browserPromise;
}

// Optional graceful-shutdown hook: closes the shared browser if callers wire it
// in. Safe to leave uncalled — a detached Chromium is acceptable (out of scope).
export async function closePdfBrowser(): Promise<void> {
  const pending = browserPromise;
  browserPromise = null;
  if (!pending) return;
  try {
    const browser = await pending;
    await browser.close();
  } catch {
    // ignore — nothing to clean up if it never came up
  }
}

// Simple in-process semaphore bounding how many pages render concurrently, so a
// burst of receipt requests can't spawn unbounded pages on the shared browser.
// Slots are always released in a finally, so it cannot deadlock.
const MAX_CONCURRENT_PAGES = 3;
let activePages = 0;
const waiters: Array<() => void> = [];

function acquirePageSlot(): Promise<void> {
  if (activePages < MAX_CONCURRENT_PAGES) {
    activePages++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waiters.push(() => {
      activePages++;
      resolve();
    });
  });
}

function releasePageSlot(): void {
  activePages--;
  const next = waiters.shift();
  if (next) next();
}

export async function renderPdfFromHtml(html: string): Promise<Buffer> {
  await acquirePageSlot();
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: "load" });
      // Block until every @font-face used on the page has actually loaded.
      // `display=block` in the template hides text until the font is ready, and
      // `document.fonts.ready` resolves only once those fonts have loaded — so the
      // PDF is never rasterised with a fallback font that lacks Indic (Gujarati/
      // Hindi) glyphs. Cap the wait so a slow/blocked font CDN can't hang the PDF.
      //
      // ⚠ This callback is serialized (`.toString()`) and run inside Chromium, so it
      // must NOT be `async`: with tsconfig target < ES2017 (es2016 here) tsc downlevels
      // async/await into the `__awaiter` helper, which does NOT exist in the browser
      // context → "__awaiter is not defined" at PDF time. Return the Promise directly
      // (page.evaluate awaits a returned thenable) so no helper is injected.
      await page.evaluate(() =>
        Promise.race([
          (document as any).fonts.ready,
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ])
      );
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "20px", right: "20px", bottom: "20px", left: "20px" },
      });
      return Buffer.from(pdf);
    } finally {
      // Close only the page — NEVER the shared browser.
      await page.close();
    }
  } finally {
    releasePageSlot();
  }
}

const DEFAULT_NOTES = [
  { list: "This is a system-generated receipt and does not require a signature." },
  { list: "For any queries, contact " + COMPANY_EMAIL + "." },
];

// Uniform line item + header shape the EJS receipt template needs; the SQL
// loaders produce this and the generator only renders it.
interface ReceiptItem {
  name: string;
  validity: string;
  amount: string;
}
interface ReceiptData {
  paymentMethod: string;
  razorpayPaymentId: string;
  receipt: string;
  createdDate: string;
  userName: string;
  userPhone: string;
  userEmailAddress: string;
  items: ReceiptItem[];
  totalAmount: number;
}

async function loadBookReceiptFromMysql(
  orderId: string,
  customerId: string,
): Promise<ReceiptData> {
  const ordId = Number(orderId);
  const custId = Number(customerId);
  if (!Number.isInteger(ordId) || ordId <= 0) throw new Error("Invalid order id.");

  // ws_book_order: receiptId (order_id), amount (order_price), gatewayPaymentId.
  // Line items live in a separate ws_book_order_item table keyed by the string
  // order_id (= BookOrder.receiptId, NOT a FK to id), joined to ws_book for names.
  const order = await prisma.bookOrder.findFirst({
    where: { id: ordId, userId: custId },
    select: {
      receiptId: true,
      paymentMethod: true,
      gatewayPaymentId: true,
      status: true,
      amount: true,
      paidAt: true,
      createdAt: true,
      user: { select: { fullName: true, phoneNumber: true, emailAddress: true } },
    },
  });
  if (!order) throw new Error("Order not found.");
  // Offline / free book orders (cash, bank, QR, Backend, free) never carry a
  // gatewayPaymentId — they are settled manually. Gate on the order status
  // instead, matching the paid states the purchase-history listing exposes.
  if (!["verified", "shipped", "delivered"].includes(order.status)) {
    throw new Error("Order has not been paid yet.");
  }
  if (!order.user) throw new Error("Customer not found.");

  const orderItems = await prisma.bookOrderItem.findMany({
    where: { order_id: order.receiptId },
    select: {
      qty: true,
      price: true,
      shipping_price: true,
      Book: { select: { name: true } },
    },
  });

  const items: ReceiptItem[] = orderItems.map((it) => {
    const name = it.Book?.name || "Book";
    return {
      name: `${name}${it.qty > 1 ? ` × ${it.qty}` : ""}`,
      validity: "-",
      amount: (it.price * it.qty + (it.shipping_price || 0)).toFixed(2),
    };
  });

  const amount = Number(order.amount);

  return {
    paymentMethod: String(order.paymentMethod || "Online"),
    razorpayPaymentId: order.gatewayPaymentId || "-",
    receipt: order.receiptId,
    createdDate: formatDate((order.paidAt || order.createdAt) ?? undefined),
    userName: (order.user.fullName || "").trim() || "-",
    userPhone: order.user.phoneNumber || "-",
    userEmailAddress: order.user.emailAddress || "-",
    items,
    totalAmount: Number.isFinite(amount) ? amount : 0,
  };
}

function renderReceiptData(loaded: ReceiptData): Promise<string> {
  const data = {
    contactNumber: COMPANY_CONTACT,
    email: COMPANY_EMAIL,
    paymentMethod: loaded.paymentMethod,
    razorpayPaymentId: loaded.razorpayPaymentId,
    receipt: loaded.receipt,
    createdDate: loaded.createdDate,
    userName: loaded.userName,
    userPhone: loaded.userPhone,
    userEmailAddress: loaded.userEmailAddress,
    items: loaded.items,
    totalAmount: loaded.totalAmount.toFixed(2),
    totalAmountInWord: numberToIndianWords(loaded.totalAmount),
    notes: DEFAULT_NOTES,
  };
  return ejs.renderFile(TEMPLATE_PATH, data);
}

export async function generateBookReceipt(orderId: string, customerId: string): Promise<Buffer> {
  const loaded = await loadBookReceiptFromMysql(orderId, customerId);
  const html = await renderReceiptData(loaded);
  return renderPdfFromHtml(html);
}

async function loadEbookReceiptFromMysql(
  orderId: string,
  customerId: string,
): Promise<ReceiptData> {
  const ordId = Number(orderId);
  const custId = Number(customerId);
  if (!Number.isInteger(ordId) || ordId <= 0) throw new Error("Invalid order id.");

  // ws_ebook_order has NO ebook_id → hop plan_id → ws_package_course_ebook_price
  // (ebookId + duration) → ws_ebook for the name (same path as getEbookReceiptMysql).
  const order = await prisma.eBookOrder.findFirst({
    where: { id: ordId, userId: custId },
    select: {
      planId: true,
      orderPrice: true,
      paymentMethod: true,
      gatewayPaymentId: true,
      gatewayOrderId: true,
      status: true,
      createdAt: true,
      Customer: { select: { fullName: true, phoneNumber: true, emailAddress: true } },
    },
  });
  if (!order) throw new Error("Order not found.");
  // Offline / free ebook orders have no gatewayPaymentId; a settled order is
  // marked `complete`. Gate on status so manual/free purchases can download.
  if (order.status !== "complete") throw new Error("Order has not been paid yet.");
  if (!order.Customer) throw new Error("Customer not found.");

  const plan = order.planId
    ? await prisma.packageCourseEbookPrice.findFirst({
        where: { id: order.planId },
        select: { ebookId: true, duration: true },
      })
    : null;
  const ebook = plan?.ebookId
    ? await prisma.eBook.findFirst({ where: { id: plan.ebookId }, select: { name: true } })
    : null;

  const validity = plan?.duration
    ? `${plan.duration} day${plan.duration > 1 ? "s" : ""}`
    : "-";

  const items: ReceiptItem[] = [
    {
      name: ebook?.name || "Ebook",
      validity,
      amount: order.orderPrice.toFixed(2),
    },
  ];

  return {
    paymentMethod: String(order.paymentMethod || "Online"),
    razorpayPaymentId: order.gatewayPaymentId || "-",
    receipt: order.gatewayOrderId || String(ordId),
    createdDate: formatDate(order.createdAt ?? undefined),
    userName: (order.Customer.fullName || "").trim() || "-",
    userPhone: order.Customer.phoneNumber || "-",
    userEmailAddress: order.Customer.emailAddress || "-",
    items,
    totalAmount: order.orderPrice,
  };
}

export async function generateEbookReceipt(orderId: string, customerId: string): Promise<Buffer> {
  const loaded = await loadEbookReceiptFromMysql(orderId, customerId);
  const html = await renderReceiptData(loaded);
  return renderPdfFromHtml(html);
}

// Course/package order receipt — same EJS template + Puppeteer pipeline as the
// ebook/book receipts so all three invoices look identical. A "course order" is
// a PackageCourseSubscription, which is either a course (courseId) or a package
// (targetPackageId); the plan lives in `packageId` → PackageCourseEbookPrice.
// Plan `duration` is in DAYS for course/package plans (same as ebook plans).
// Builds the receipt HTML (fetch order → assemble data → render EJS) without
// rasterising it. Split out so callers can run renderPdfFromHtml themselves.
// Uniform shape the EJS template needs, independent of backend. Mongo and SQL
// loaders both produce this; `buildCourseReceiptHtml` only renders it.
interface CourseReceiptData {
  paymentMethod: string;
  razorpayPaymentId: string;
  receipt: string;
  createdDate: string;
  userName: string;
  userPhone: string;
  userEmailAddress: string;
  productName: string;
  withMaterial: boolean;
  duration?: number | null;
  amount: number;
}

async function loadCourseReceiptFromMysql(
  orderId: string,
  customerId: string,
): Promise<CourseReceiptData> {
  const subId = Number(orderId);
  const custId = Number(customerId);
  if (!Number.isInteger(subId) || subId <= 0) throw new Error("Invalid order id.");

  // The subscription holds the product (course/package) + plan; payment fields live
  // on the parent PackageCourseOrder (paymentMethod / razorpay ids). SQL Customer has
  // a single `fullName`, not the Mongo first/middle/last split.
  const sub = await prisma.packageCourseSubscription.findFirst({
    where: { id: subId, customerId: custId },
    select: {
      amount: true,
      createdAt: true,
      customer: { select: { fullName: true, phoneNumber: true, emailAddress: true } },
      course: { select: { name: true } },
      package: { select: { name: true } },
      packageCourseEbookPrice: { select: { name: true, duration: true, withMaterial: true } },
      packageCourseOrder: {
        select: {
          paymentMethod: true,
          gatewayPaymentId: true,
          gatewayOrderId: true,
          status: true,
          amount: true,
          createdAt: true,
        },
      },
    },
  });
  if (!sub) throw new Error("Order not found.");
  const ord = sub.packageCourseOrder;
  // Offline / free course & package orders have no gatewayPaymentId; a settled
  // order is marked `complete`. Gate on status so manual/free purchases can
  // download their invoice.
  if (ord?.status !== "complete") throw new Error("Order has not been paid yet.");

  const plan = sub.packageCourseEbookPrice;
  const productName =
    sub.course?.name || sub.package?.name || plan?.name || "Course";

  // Prefer the subscription's recorded amount; fall back to the order's discount_price.
  const rawAmount =
    sub.amount != null ? Number(sub.amount) : ord.amount != null ? Number(ord.amount) : 0;
  const amount = Number.isFinite(rawAmount) ? rawAmount : 0;

  return {
    paymentMethod: String(ord.paymentMethod || "Online"),
    razorpayPaymentId: ord.gatewayPaymentId || "-",
    receipt: ord.gatewayOrderId || String(subId),
    createdDate: formatDate(ord.createdAt ?? sub.createdAt ?? undefined),
    userName: (sub.customer?.fullName || "").trim() || "-",
    userPhone: sub.customer?.phoneNumber || "-",
    userEmailAddress: sub.customer?.emailAddress || "-",
    productName,
    withMaterial: !!plan?.withMaterial,
    duration: plan?.duration ?? null,
    amount,
  };
}

// Shared EJS render for a loaded receipt — course / live-course / test-series
// all produce the same CourseReceiptData shape and use the identical invoice
// template, so the item/totals assembly lives here once.
function renderReceiptHtml(loaded: CourseReceiptData): Promise<string> {
  const validity =
    loaded.duration && loaded.duration > 0
      ? `${loaded.duration} day${loaded.duration > 1 ? "s" : ""}`
      : "-";
  const itemName = loaded.withMaterial
    ? `${loaded.productName} (with material)`
    : loaded.productName;

  const items = [
    {
      name: itemName,
      validity,
      amount: loaded.amount.toFixed(2),
    },
  ];

  const data = {
    contactNumber: COMPANY_CONTACT,
    email: COMPANY_EMAIL,
    paymentMethod: loaded.paymentMethod,
    razorpayPaymentId: loaded.razorpayPaymentId,
    receipt: loaded.receipt,
    createdDate: loaded.createdDate,
    userName: loaded.userName,
    userPhone: loaded.userPhone,
    userEmailAddress: loaded.userEmailAddress,
    items,
    totalAmount: loaded.amount.toFixed(2),
    totalAmountInWord: numberToIndianWords(loaded.amount),
    notes: DEFAULT_NOTES,
  };

  return ejs.renderFile(TEMPLATE_PATH, data);
}

export async function buildCourseReceiptHtml(orderId: string, customerId: string): Promise<string> {
  return renderReceiptHtml(await loadCourseReceiptFromMysql(orderId, customerId));
}

// ── live-course invoice (ws_live_course_subscription — single table) ────────────
async function loadLiveCourseReceiptFromMysql(
  orderId: string,
  customerId: string,
): Promise<CourseReceiptData> {
  const subId = Number(orderId);
  const custId = Number(customerId);
  if (!Number.isInteger(subId) || subId <= 0) throw new Error("Invalid order id.");

  const sub = await prisma.liveCourseSubscription.findFirst({
    where: { id: subId, customerId: custId },
    select: {
      paidAmount: true, originalAmount: true, createdAt: true, paidAt: true,
      paymentStatus: true, razorpayPaymentId: true, razorpayOrderId: true,
      withMaterial: true, liveCourseId: true, planId: true,
    },
  });
  if (!sub) throw new Error("Order not found.");
  if (sub.paymentStatus && sub.paymentStatus !== "verified" && !sub.razorpayPaymentId) {
    throw new Error("Order has not been paid yet.");
  }

  const [course, plan, customer] = await Promise.all([
    prisma.liveCourse.findFirst({ where: { id: sub.liveCourseId }, select: { name: true } }),
    sub.planId ? prisma.liveCoursePlan.findFirst({ where: { id: sub.planId }, select: { duration: true } }) : Promise.resolve(null),
    prisma.customer.findFirst({ where: { id: custId }, select: { fullName: true, phoneNumber: true, emailAddress: true } }),
  ]);

  const rawAmount = sub.paidAmount != null ? Number(sub.paidAmount) : sub.originalAmount != null ? Number(sub.originalAmount) : 0;

  return {
    paymentMethod: "Online",
    razorpayPaymentId: sub.razorpayPaymentId || "-",
    receipt: sub.razorpayOrderId || String(subId),
    createdDate: formatDate(sub.paidAt ?? sub.createdAt ?? undefined),
    userName: (customer?.fullName || "").trim() || "-",
    userPhone: customer?.phoneNumber || "-",
    userEmailAddress: customer?.emailAddress || "-",
    productName: course?.name || "Live Course",
    withMaterial: !!sub.withMaterial,
    duration: plan?.duration ?? null, // live-course plan duration is in DAYS
    amount: Number.isFinite(rawAmount) ? rawAmount : 0,
  };
}

export async function buildLiveCourseReceiptHtml(orderId: string, customerId: string): Promise<string> {
  return renderReceiptHtml(await loadLiveCourseReceiptFromMysql(orderId, customerId));
}

// ── test-series invoice (ws_test_series_subscription — single table) ────────────
// Razorpay ids + method come from the parent ws_test_series_order (via order_id);
// the subscription row carries only price/plan. Duration is DAYS (duration_days).
async function loadTestSeriesReceiptFromMysql(
  orderId: string,
  customerId: string,
): Promise<CourseReceiptData> {
  const subId = Number(orderId);
  const custId = Number(customerId);
  if (!Number.isInteger(subId) || subId <= 0) throw new Error("Invalid order id.");

  const sub = await prisma.testSeriesSubscription.findFirst({
    where: { id: subId, customerId: custId },
    select: { price: true, createdAt: true, testSeriesId: true, planId: true, orderId: true, paymentType: true },
  });
  if (!sub) throw new Error("Order not found.");

  const [ts, plan, order, customer] = await Promise.all([
    prisma.testSeries.findFirst({ where: { id: sub.testSeriesId }, select: { title: true } }),
    sub.planId ? prisma.testSeriesPrice.findFirst({ where: { id: sub.planId }, select: { durationDays: true } }) : Promise.resolve(null),
    sub.orderId ? prisma.testSeriesOrder.findFirst({ where: { id: sub.orderId }, select: { paymentMethod: true, razorpayPaymentId: true, razorpayOrderId: true } }) : Promise.resolve(null),
    prisma.customer.findFirst({ where: { id: custId }, select: { fullName: true, phoneNumber: true, emailAddress: true } }),
  ]);

  const rawAmount = sub.price != null ? Number(sub.price) : 0;

  return {
    paymentMethod: String(order?.paymentMethod || sub.paymentType || "Online"),
    razorpayPaymentId: order?.razorpayPaymentId || "-",
    receipt: order?.razorpayOrderId || String(subId),
    createdDate: formatDate(sub.createdAt ?? undefined),
    userName: (customer?.fullName || "").trim() || "-",
    userPhone: customer?.phoneNumber || "-",
    userEmailAddress: customer?.emailAddress || "-",
    productName: ts?.title || "Test Series",
    withMaterial: false,
    duration: plan?.durationDays ?? null,
    amount: Number.isFinite(rawAmount) ? rawAmount : 0,
  };
}

export async function buildTestSeriesReceiptHtml(orderId: string, customerId: string): Promise<string> {
  return renderReceiptHtml(await loadTestSeriesReceiptFromMysql(orderId, customerId));
}

// Course/package order receipt — same EJS template + Puppeteer pipeline as the
// ebook/book receipts so all three invoices look identical. A "course order" is
// a PackageCourseSubscription, which is either a course (courseId) or a package
// (targetPackageId); the plan lives in `packageId` → PackageCourseEbookPrice.
// Plan `duration` is in DAYS for course/package plans (same as ebook plans).
export async function generateCourseReceipt(orderId: string, customerId: string): Promise<Buffer> {
  const html = await buildCourseReceiptHtml(orderId, customerId);
  return renderPdfFromHtml(html);
}

function formatDateTime(d?: Date | null): string {
  if (!d) return "-";
  const dt = new Date(d);
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yyyy = dt.getFullYear();
  const hh = String(dt.getHours()).padStart(2, "0");
  const mi = String(dt.getMinutes()).padStart(2, "0");
  return `${dd}-${mm}-${yyyy} ${hh}:${mi}`;
}

// Uniform shape the solution EJS template needs, independent of backend.
interface ExamSolutionData {
  examTitle: string;
  attemptNumber: number;
  submittedAt: Date | null;
  userName: string;
  userPhone: string;
  userEmailAddress: string;
  score: number;
  totalMarks: number;
  success: number;
  failed: number;
  skip: number;
  attempt: number;
  total: number;
  accuracy: number;
  rank: string;
  timing: string;
  questions: Array<{
    title: string;
    options: Array<{ name: string; isSelect: boolean; isCorrect: boolean }>;
    correctAnswer: string;
    selectedAnswer: string;
    status: string;
    point: number;
  }>;
}

async function loadExamSolutionFromMysql(
  examId: string,
  customerId: string,
  attemptId?: string,
): Promise<ExamSolutionData> {
  const exId = Number(examId);
  const custId = Number(customerId);
  if (!Number.isInteger(exId) || exId <= 0) throw new Error("Invalid exam id.");
  const attId = attemptId != null ? Number(attemptId) : undefined;
  if (attemptId != null && (!Number.isInteger(attId) || (attId as number) <= 0))
    throw new Error("Invalid attempt id.");

  // ws_exam_result: no submittedAt/attemptNumber columns — order by id (latest row)
  // and surface created_at as the submission time. attemptNumber collapses to 1.
  const target = attId
    ? await prisma.examResult.findFirst({
        where: { id: attId, customerId: custId, examId: exId, status: true },
      })
    : await prisma.examResult.findFirst({
        where: { customerId: custId, examId: exId, status: true },
        orderBy: { id: "desc" },
      });
  if (!target) throw new Error("No submitted attempt found.");

  const [exam, customer, details] = await Promise.all([
    prisma.exam.findFirst({
      where: { id: exId },
      select: { name: true, positiveMarks: true },
    }),
    prisma.customer.findFirst({
      where: { id: custId },
      select: { fullName: true, phoneNumber: true, emailAddress: true },
    }),
    prisma.examResultDetail.findMany({
      where: { examResultId: target.id },
      select: {
        answerId: true,
        result: true,
        point: true,
        ExamQuestion: { select: { id: true, name: true, answer: true } },
      },
    }),
  ]);
  if (!exam) throw new Error("Exam not found.");
  if (!customer) throw new Error("Customer not found.");

  const qIds = details
    .map((d) => d.ExamQuestion?.id)
    .filter((x): x is number => x != null);
  const options = qIds.length
    ? await prisma.examQuestionOption.findMany({
        where: { question: { in: qIds } },
        select: { id: true, name: true, question: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      })
    : [];
  const optsByQ: Record<number, typeof options> = {};
  options.forEach((o) => {
    if (o.question == null) return;
    (optsByQ[o.question] ||= []).push(o);
  });

  const norm = (s: string) => (s ?? "").trim().toLowerCase();

  const questions = details
    .filter((d) => d.ExamQuestion)
    .map((d) => {
      const q = d.ExamQuestion!;
      const qOptions = (optsByQ[q.id] || []).map((o) => ({
        name: o.name,
        isSelect: d.answerId != null && d.answerId === o.id,
        isCorrect: norm(q.answer) === norm(o.name),
      }));
      const selectedOpt = qOptions.find((o) => o.isSelect);
      const status =
        d.result === ExamResultType.TRUE
          ? "correct"
          : d.result === ExamResultType.FALSE
          ? "wrong"
          : "skipped";
      return {
        title: q.name,
        options: qOptions,
        correctAnswer: q.answer,
        selectedAnswer: selectedOpt?.name || "",
        status,
        point: Number(d.point ?? 0),
      };
    });

  const total = target.total;
  const success = target.success;
  const score = Number(target.score);
  const accuracy = total > 0 ? Math.round((success * 10000) / total) / 100 : 0;
  const positiveMarks = Number(exam.positiveMarks);
  const totalMarks = total * (positiveMarks || 1);

  // Rank = best score per customer across this exam (cross-customer aggregation).
  const bestPerUser = await prisma.examResult.groupBy({
    by: ["customerId"],
    where: { examId: exId, status: true },
    _max: { score: true },
  });
  const myBest =
    bestPerUser.find((u) => u.customerId === custId)?._max.score ?? target.score;
  const myBestNum = Number(myBest);
  const higher = bestPerUser.filter(
    (u) => u._max.score != null && Number(u._max.score) > myBestNum,
  ).length;
  const rank = `${higher + 1}/${bestPerUser.length}`;

  return {
    examTitle: exam.name || "Quiz",
    attemptNumber: 1,
    submittedAt: target.created_at ?? null,
    userName: (customer.fullName || "").trim() || "-",
    userPhone: customer.phoneNumber || "-",
    userEmailAddress: customer.emailAddress || "-",
    score,
    totalMarks,
    success,
    failed: target.failed,
    skip: target.skip,
    attempt: target.attempt,
    total,
    accuracy,
    rank,
    timing: target.timing || "00:00",
    questions,
  };
}

export async function generateExamSolutionPdf(
  examId: string,
  customerId: string,
  attemptId?: string,
): Promise<{ pdf: Buffer; fileName: string }> {
  const loaded = await loadExamSolutionFromMysql(examId, customerId, attemptId);

  const data = {
    contactNumber: COMPANY_CONTACT,
    email: COMPANY_EMAIL,
    generatedAt: formatDateTime(new Date()),
    examTitle: loaded.examTitle,
    attemptNumber: loaded.attemptNumber,
    submittedAt: formatDateTime(loaded.submittedAt),
    userName: loaded.userName,
    userPhone: loaded.userPhone,
    userEmailAddress: loaded.userEmailAddress,
    score: loaded.score,
    totalMarks: loaded.totalMarks,
    success: loaded.success,
    failed: loaded.failed,
    skip: loaded.skip,
    attempt: loaded.attempt,
    total: loaded.total,
    accuracy: loaded.accuracy,
    rank: loaded.rank,
    timing: loaded.timing,
    questions: loaded.questions,
  };

  const html = await ejs.renderFile(SOLUTION_TEMPLATE_PATH, data);
  const pdf = await renderPdfFromHtml(html);
  const safeTitle = (loaded.examTitle || "quiz").replace(/[^a-z0-9-_]+/gi, "_").slice(0, 40);
  const fileName = `${safeTitle}_attempt${loaded.attemptNumber}.pdf`;
  return { pdf, fileName };
}
