// Receipts and solution PDFs: loads order/exam data, renders EJS, prints via Puppeteer.
import path from "path";
import ejs from "ejs";
import puppeteer, { type Browser } from "puppeteer";

import { ExamResultType } from "../../shared/enums";
import { prisma } from "../../config/prisma";
import { normalizeTiming } from "../../modules/client-exam/client-exam.service";
import { formatPaymentMethod, resolvePaymentReference } from "../../utils/paymentMethod";
import { resolveOrderLines, orderLineBookIds } from "../../modules/book-order/book-order.transformer";

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

// One shared headless Chromium; each render opens and closes its own page.
const BROWSER_LAUNCH_OPTIONS = {
  headless: true as const,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
};

let browserPromise: Promise<Browser> | null = null;

// Lazy singleton; cleared on disconnect so the next render relaunches.
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch(BROWSER_LAUNCH_OPTIONS).then((browser) => {
      browser.on("disconnected", () => {
        browserPromise = null;
      });
      return browser;
    });
    browserPromise.catch(() => {
      browserPromise = null;
    });
  }
  return browserPromise;
}

// Optional shutdown hook; safe to leave uncalled.
export async function closePdfBrowser(): Promise<void> {
  const pending = browserPromise;
  browserPromise = null;
  if (!pending) return;
  try {
    const browser = await pending;
    await browser.close();
  } catch {
    // never came up — nothing to close
  }
}

// Bounds concurrent pages on the shared browser; slots are released in a finally.
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

/**
 * `offline` is for HTML we did not write (a student's response-sheet link): page
 * scripts are off and every request except inline `data:` is aborted, so the page
 * can never make the server fetch anything.
 */
export async function renderPdfFromHtml(html: string, { offline = false }: { offline?: boolean } = {}): Promise<Buffer> {
  await acquirePageSlot();
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      if (offline) {
        await page.setJavaScriptEnabled(false);
        await page.setRequestInterception(true);
        page.on("request", (request) =>
          request.url().startsWith("data:") ? request.continue() : request.abort()
        );
      }
      await page.setContent(html, { waitUntil: "load" });
      // Wait for web fonts so the PDF never rasterises with a fallback font lacking
      // Gujarati/Hindi glyphs; capped at 5s so a slow font CDN can't hang the render.
      // The callback runs inside Chromium and must NOT be `async`: tsc (target es2016)
      // downlevels it to `__awaiter`, which is undefined in the browser context.
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
      // Close only the page, never the shared browser.
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

interface ReceiptItem {
  name: string;
  validity: string;
  amount: string;
}
interface ReceiptData {
  paymentMethod: string;
  razorpayPaymentId: string;
  /** "Payment Id" for gateway payments, "Transaction Id" for bank transfers. */
  paymentIdLabel: string;
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

  // ws_book_order_item is keyed by the string order_id (= BookOrder.receiptId),
  // not a FK to BookOrder.id.
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
      orderItems: true,
      user: { select: { fullName: true, phoneNumber: true, emailAddress: true } },
    },
  });
  if (!order) throw new Error("Order not found.");
  // Offline / free book orders (cash, bank, QR, Backend, free) never carry a
  // gatewayPaymentId — they are settled manually. Gate on the order status
  // instead, matching the paid states the purchase-history listing exposes.
  if (order.status !== "verified") {
    throw new Error("Order has not been paid yet.");
  }
  if (!order.user) throw new Error("Customer not found.");

  // order_items JSON preferred, child rows as fallback (book-order resolveOrderLines).
  const childRows = await prisma.bookOrderItem.findMany({ where: { order_id: order.receiptId } });
  const lines = resolveOrderLines(order.orderItems, childRows);
  const bookIds = orderLineBookIds(lines);
  const bookNames = new Map(
    (bookIds.length ? await prisma.book.findMany({ where: { id: { in: bookIds } }, select: { id: true, name: true } }) : [])
      .map((b) => [b.id, b.name])
  );

  const items: ReceiptItem[] = lines.map((it) => {
    const name = it.name || (it.bookId != null ? bookNames.get(it.bookId) : null) || "Book";
    return {
      name: `${name}${it.qty > 1 ? ` × ${it.qty}` : ""}`,
      validity: "-",
      amount: (it.price * it.qty + (it.shippingPrice || 0)).toFixed(2),
    };
  });

  const amount = Number(order.amount);

  // ws_book_order has no bank transaction id, so a bank-paid order prints "-".
  const bookMethod = formatPaymentMethod(String(order.paymentMethod || "Online"));
  const bookRef = resolvePaymentReference(bookMethod, order.gatewayPaymentId, null);

  return {
    paymentMethod: bookMethod,
    razorpayPaymentId: bookRef.paymentId,
    paymentIdLabel: bookRef.paymentIdLabel,
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
    paymentIdLabel: loaded.paymentIdLabel,
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

  // ws_ebook_order has no ebook_id: hop plan_id → ws_package_course_ebook_price → ws_ebook.
  const order = await prisma.eBookOrder.findFirst({
    where: { id: ordId, userId: custId },
    select: {
      planId: true,
      orderPrice: true,
      paymentMethod: true,
      gatewayPaymentId: true,
      bankTransactionId: true,
      gatewayOrderId: true,
      status: true,
      createdAt: true,
      Customer: { select: { fullName: true, phoneNumber: true, emailAddress: true } },
    },
  });
  if (!order) throw new Error("Order not found.");
  // Gate on status, not gatewayPaymentId, so manual/free purchases can download.
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

  const ebookMethod = formatPaymentMethod(String(order.paymentMethod || "Online"));
  const ebookRef = resolvePaymentReference(ebookMethod, order.gatewayPaymentId, order.bankTransactionId);

  return {
    paymentMethod: ebookMethod,
    razorpayPaymentId: ebookRef.paymentId,
    paymentIdLabel: ebookRef.paymentIdLabel,
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

// Shared receipt shape for course/package, live-course and test-series invoices.
// `duration` is in DAYS.
interface CourseReceiptData {
  paymentMethod: string;
  razorpayPaymentId: string;
  /** "Payment Id" for gateway payments, "Transaction Id" for bank transfers. */
  paymentIdLabel: string;
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

// Resolves by ws_package_course_order.id: the purchase-history list emits the ORDER
// id as each course/package row's `_id`. Also covers orders with no subscription row.
async function loadCourseReceiptFromOrderMysql(
  ordId: number,
  custId: number,
): Promise<CourseReceiptData | null> {
  const ord = await prisma.packageCourseOrder.findFirst({
    where: { id: ordId, userId: custId },
    select: {
      id: true,
      uniqueId: true,
      status: true,
      amount: true,
      paymentMethod: true,
      gatewayPaymentId: true,
      bankTransactionId: true,
      gatewayOrderId: true,
      createdAt: true,
      planId: true,
    },
  });
  if (!ord) return null;
  if (ord.status !== "complete") throw new Error("Order has not been paid yet.");

  const plan = ord.planId
    ? await prisma.packageCourseEbookPrice.findFirst({
        where: { id: ord.planId },
        select: { name: true, duration: true, withMaterial: true, courseId: true, packageId: true },
      })
    : null;

  const courseId = plan?.courseId && plan.courseId > 0 ? plan.courseId : null;
  const packageId = plan?.packageId && plan.packageId > 0 ? plan.packageId : null;
  const [course, pkg, customer] = await Promise.all([
    courseId
      ? prisma.course.findFirst({ where: { id: courseId }, select: { name: true } })
      : Promise.resolve(null),
    packageId
      ? prisma.package.findFirst({ where: { id: packageId }, select: { name: true } })
      : Promise.resolve(null),
    prisma.customer.findFirst({
      where: { id: custId },
      select: { fullName: true, phoneNumber: true, emailAddress: true },
    }),
  ]);

  const rawAmount = ord.amount != null ? Number(ord.amount) : 0;

  const orderMethod = formatPaymentMethod(String(ord.paymentMethod || "Online"));
  const orderRef = resolvePaymentReference(orderMethod, ord.gatewayPaymentId, ord.bankTransactionId);

  return {
    paymentMethod: orderMethod,
    razorpayPaymentId: orderRef.paymentId,
    paymentIdLabel: orderRef.paymentIdLabel,
    receipt: ord.gatewayOrderId || ord.uniqueId || String(ord.id),
    createdDate: formatDate(ord.createdAt ?? undefined),
    userName: (customer?.fullName || "").trim() || "-",
    userPhone: customer?.phoneNumber || "-",
    userEmailAddress: customer?.emailAddress || "-",
    productName: course?.name || pkg?.name || plan?.name || "Course",
    withMaterial: !!plan?.withMaterial,
    duration: plan?.duration ?? null,
    amount: Number.isFinite(rawAmount) ? rawAmount : 0,
  };
}

// Resolves by ws_package_course_subscription.id (legacy "pcs_" rows). Returns null
// when no subscription owned by this customer matches, so callers can fall back.
async function loadCourseReceiptFromSubMysql(
  subId: number,
  custId: number,
): Promise<CourseReceiptData | null> {
  // Payment fields live on the parent PackageCourseOrder, not the subscription.
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
          bankTransactionId: true,
          gatewayOrderId: true,
          status: true,
          amount: true,
          createdAt: true,
        },
      },
    },
  });
  if (!sub) return null;

  const ord = sub.packageCourseOrder;
  // Legacy/manually-granted subs have no order row and render from the subscription
  // alone; an existing order that isn't `complete` is unpaid and stays blocked.
  if (ord && ord.status !== "complete") throw new Error("Order has not been paid yet.");

  const plan = sub.packageCourseEbookPrice;
  const productName =
    sub.course?.name || sub.package?.name || plan?.name || "Course";

  const rawAmount =
    sub.amount != null ? Number(sub.amount) : ord?.amount != null ? Number(ord.amount) : 0;
  const amount = Number.isFinite(rawAmount) ? rawAmount : 0;

  const subMethod = formatPaymentMethod(String(ord?.paymentMethod || "Online"));
  const subRef = resolvePaymentReference(subMethod, ord?.gatewayPaymentId, ord?.bankTransactionId);

  return {
    paymentMethod: subMethod,
    razorpayPaymentId: subRef.paymentId,
    paymentIdLabel: subRef.paymentIdLabel,
    receipt: ord?.gatewayOrderId || String(subId),
    createdDate: formatDate(ord?.createdAt ?? sub.createdAt ?? undefined),
    userName: (sub.customer?.fullName || "").trim() || "-",
    userPhone: sub.customer?.phoneNumber || "-",
    userEmailAddress: sub.customer?.emailAddress || "-",
    productName,
    withMaterial: !!plan?.withMaterial,
    duration: plan?.duration ?? null,
    amount,
  };
}

// Unprefixed ids: subscription and order ids are overlapping PK spaces, so try the
// subscription first (back-compat, wins on a tie) and the order second.
async function loadCourseReceiptFromMysql(
  orderId: string,
  customerId: string,
): Promise<CourseReceiptData> {
  const id = Number(orderId);
  const custId = Number(customerId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid order id.");

  const bySub = await loadCourseReceiptFromSubMysql(id, custId);
  if (bySub) return bySub;

  const byOrder = await loadCourseReceiptFromOrderMysql(id, custId);
  if (byOrder) return byOrder;

  throw new Error("Order not found.");
}

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
    paymentIdLabel: loaded.paymentIdLabel,
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

// "pcs_" ids — legacy package/course subscription with no order row. Strict
// subscription lookup: no order fallback, so the id space stays unambiguous.
export async function buildCourseReceiptHtmlBySub(subId: string, customerId: string): Promise<string> {
  const id = Number(subId);
  const custId = Number(customerId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid order id.");

  const loaded = await loadCourseReceiptFromSubMysql(id, custId);
  if (!loaded) throw new Error("Order not found.");
  return renderReceiptHtml(loaded);
}

async function loadLiveCourseReceiptFromMysql(
  orderId: string,
  customerId: string,
): Promise<CourseReceiptData> {
  const subId = Number(orderId);
  const custId = Number(customerId);
  if (!Number.isInteger(subId) || subId <= 0) throw new Error("Invalid order id.");

  const row = await prisma.liveCourseSubscription.findFirst({
    where: { id: subId, customerId: custId },
    select: {
      createdAt: true, withMaterial: true, liveCourseId: true, planId: true,
      // Fallback total for a legacy row with no order; when `order` exists the spread
      // below shadows it with the authoritative ws_live_course_order amount.
      amount: true,
      // All payment fields live on ws_live_course_order.
      order: true,
    },
  });
  if (!row) throw new Error("Order not found.");
  // Order fields shadow the subscription's.
  const sub: any = { ...row, ...(row.order ?? {}) };
  if (row.order?.status !== "complete" && !sub.razorpayPaymentId) {
    throw new Error("Order has not been paid yet.");
  }

  const [course, plan, customer] = await Promise.all([
    prisma.liveCourse.findFirst({ where: { id: sub.liveCourseId }, select: { name: true } }),
    sub.planId ? prisma.liveCoursePlan.findFirst({ where: { id: sub.planId }, select: { duration: true } }) : Promise.resolve(null),
    prisma.customer.findFirst({ where: { id: custId }, select: { fullName: true, phoneNumber: true, emailAddress: true } }),
  ]);

  // Charged amount (order discount_price via the spread), the same figure the
  // package/course invoice, purchase-history list and JSON receipt use.
  const rawAmount = sub.amount != null ? Number(sub.amount) : 0;

  // "Online" only as a fallback for rows predating payment_method.
  const liveMethod = formatPaymentMethod(String(sub.paymentMethod || "Online"));
  const liveRef = resolvePaymentReference(liveMethod, sub.razorpayPaymentId, sub.bankTransactionId);

  return {
    paymentMethod: liveMethod,
    razorpayPaymentId: liveRef.paymentId,
    paymentIdLabel: liveRef.paymentIdLabel,
    receipt: sub.razorpayOrderId || String(subId),
    // The order's created_at (via the spread) is the payment instant.
    createdDate: formatDate(sub.createdAt ?? undefined),
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

// Payment ids/method come from the parent ws_test_series_order; duration is DAYS.
async function loadTestSeriesReceiptFromSubMysql(
  subId: number,
  custId: number,
): Promise<CourseReceiptData | null> {
  const sub = await prisma.testSeriesSubscription.findFirst({
    where: { id: subId, customerId: custId },
    select: { amount: true, createdAt: true, testSeriesId: true, planId: true, orderId: true, paymentType: true },
  });
  if (!sub) return null;

  const [ts, plan, order, customer] = await Promise.all([
    prisma.testSeries.findFirst({ where: { id: sub.testSeriesId }, select: { title: true } }),
    sub.planId ? prisma.testSeriesPrice.findFirst({ where: { id: sub.planId }, select: { durationDays: true } }) : Promise.resolve(null),
    sub.orderId ? prisma.testSeriesOrder.findFirst({ where: { id: sub.orderId }, select: { paymentMethod: true, razorpayPaymentId: true, razorpayOrderId: true, bankTransactionId: true } }) : Promise.resolve(null),
    prisma.customer.findFirst({ where: { id: custId }, select: { fullName: true, phoneNumber: true, emailAddress: true } }),
  ]);

  const rawAmount = sub.amount != null ? Number(sub.amount) : 0;

  const tsSubMethod = formatPaymentMethod(String(order?.paymentMethod || sub.paymentType || "Online"));
  const tsSubRef = resolvePaymentReference(tsSubMethod, order?.razorpayPaymentId, order?.bankTransactionId);

  return {
    paymentMethod: tsSubMethod,
    razorpayPaymentId: tsSubRef.paymentId,
    paymentIdLabel: tsSubRef.paymentIdLabel,
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

// "ts_" ids are test-series ORDER ids, a different PK space from the subscription.
async function loadTestSeriesReceiptFromOrderMysql(
  ordId: number,
  custId: number,
): Promise<CourseReceiptData | null> {
  const ord = await prisma.testSeriesOrder.findFirst({
    where: { id: ordId, customerId: custId },
    select: {
      id: true,
      amount: true,
      createdAt: true,
      testSeriesId: true,
      planId: true,
      paymentMethod: true,
      razorpayOrderId: true,
      razorpayPaymentId: true,
      bankTransactionId: true,
      status: true,
    },
  });
  if (!ord) return null;
  // Free/manual orders settle with no razorpay payment id, so gate on status alone.
  if (ord.status !== "complete") throw new Error("Order has not been paid yet.");

  const [ts, plan, customer] = await Promise.all([
    prisma.testSeries.findFirst({ where: { id: ord.testSeriesId }, select: { title: true } }),
    ord.planId
      ? prisma.testSeriesPrice.findFirst({ where: { id: ord.planId }, select: { durationDays: true } })
      : Promise.resolve(null),
    prisma.customer.findFirst({
      where: { id: custId },
      select: { fullName: true, phoneNumber: true, emailAddress: true },
    }),
  ]);

  const rawAmount = ord.amount != null ? Number(ord.amount) : 0;

  const tsMethod = formatPaymentMethod(String(ord.paymentMethod || "Online"));
  const tsRef = resolvePaymentReference(tsMethod, ord.razorpayPaymentId, ord.bankTransactionId);

  return {
    paymentMethod: tsMethod,
    razorpayPaymentId: tsRef.paymentId,
    paymentIdLabel: tsRef.paymentIdLabel,
    receipt: ord.razorpayOrderId || String(ord.id),
    createdDate: formatDate(ord.createdAt ?? undefined),
    userName: (customer?.fullName || "").trim() || "-",
    userPhone: customer?.phoneNumber || "-",
    userEmailAddress: customer?.emailAddress || "-",
    productName: ts?.title || "Test Series",
    withMaterial: false,
    duration: plan?.durationDays ?? null,
    amount: Number.isFinite(rawAmount) ? rawAmount : 0,
  };
}

// "ts_" ids — order first (what the list emits), subscription second for safety.
export async function buildTestSeriesReceiptHtml(orderId: string, customerId: string): Promise<string> {
  const id = Number(orderId);
  const custId = Number(customerId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid order id.");

  const byOrder = await loadTestSeriesReceiptFromOrderMysql(id, custId);
  if (byOrder) return renderReceiptHtml(byOrder);

  const bySub = await loadTestSeriesReceiptFromSubMysql(id, custId);
  if (bySub) return renderReceiptHtml(bySub);

  throw new Error("Order not found.");
}

// "tss_" ids — legacy test-series subscription with no order row. Strict lookup.
export async function buildTestSeriesReceiptHtmlBySub(subId: string, customerId: string): Promise<string> {
  const id = Number(subId);
  const custId = Number(customerId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid order id.");

  const loaded = await loadTestSeriesReceiptFromSubMysql(id, custId);
  if (!loaded) throw new Error("Order not found.");
  return renderReceiptHtml(loaded);
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

  // ws_exam_result has no submittedAt/attemptNumber: latest row by id, created_at as
  // the submission time, attemptNumber fixed at 1.
  const target = attId
    ? await prisma.examResult.findFirst({
        where: { id: attId, customerId: custId, examId: exId, status: true },
      })
    : await prisma.examResult.findFirst({
        where: { customerId: custId, examId: exId, status: true },
        orderBy: { id: "desc" },
      });
  if (!target) throw new Error("No submitted attempt found.");

  const detailSelect = {
    answerId: true,
    result: true,
    point: true,
    ExamQuestion: { select: { id: true, name: true, answer: true } },
  } as const;
  const [exam, customer, linkedDetails] = await Promise.all([
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
      select: detailSelect,
    }),
  ]);
  // Legacy attempts' detail rows carry a NULL qresult_detail_qresult_id and link
  // only by (customer, exam) — same fallback as client-exam `detailsForAttempt`.
  const details = linkedDetails.length
    ? linkedDetails
    : await prisma.examResultDetail.findMany({
        where: { examResultId: null, customerId: custId, examId: exId },
        orderBy: { id: "asc" },
        select: detailSelect,
      });
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
    timing: normalizeTiming(target.timing) || "00:00",
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
