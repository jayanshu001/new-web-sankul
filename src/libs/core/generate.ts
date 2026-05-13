import path from "path";
import ejs from "ejs";
import puppeteer from "puppeteer";
import { Types } from "mongoose";

import { BookOrder } from "../../models/book/BookOrder.model";
import { EbookOrder } from "../../models/ebook/EbookOrder.model";
import { EbookPrice } from "../../models/ebook/EbookPrice.model";
import { Ebook } from "../../models/ebook/Ebook.model";
import { Customer } from "../../models/customer/Customer.model";
import { Exam } from "../../models/exam/Exam.model";
import { ExamQuestion } from "../../models/exam/ExamQuestion.model";
import { ExamQuestionOption } from "../../models/exam/ExamQuestionOption.model";
import { ExamResult } from "../../models/exam/ExamResult.model";
import { ExamResultDetail } from "../../models/exam/ExamResultDetail.model";
import { ExamResultType } from "../../models/enums";

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

async function renderPdfFromHtml(html: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20px", right: "20px", bottom: "20px", left: "20px" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

const DEFAULT_NOTES = [
  { list: "This is a system-generated receipt and does not require a signature." },
  { list: "For any queries, contact " + COMPANY_EMAIL + "." },
];

function fullName(c: { firstName?: string; middleName?: string; lastName?: string }): string {
  return [c.firstName, c.middleName, c.lastName].filter(Boolean).join(" ").trim();
}

export async function generateBookReceipt(orderId: string, customerId: string): Promise<Buffer> {
  if (!Types.ObjectId.isValid(orderId)) throw new Error("Invalid order id.");
  const order = await BookOrder.findOne({ _id: orderId, customerId }).lean();
  if (!order) throw new Error("Order not found.");
  if (!order.razorpayPaymentId) throw new Error("Order has not been paid yet.");

  const customer = await Customer.findById(customerId).lean();
  if (!customer) throw new Error("Customer not found.");

  const items = order.items.map((it) => ({
    name: `${it.name}${it.qty > 1 ? ` × ${it.qty}` : ""}`,
    validity: "-",
    amount: (it.price * it.qty + (it.shippingPrice || 0)).toFixed(2),
  }));

  const data = {
    contactNumber: COMPANY_CONTACT,
    email: COMPANY_EMAIL,
    paymentMethod: order.paymentMethod || "Online",
    razorpayPaymentId: order.razorpayPaymentId || "-",
    receipt: order.receiptId,
    createdDate: formatDate(order.paidAt || order.createdAt),
    userName: fullName(customer) || "-",
    userPhone: customer.phoneNumber || "-",
    userEmailAddress: customer.emailAddress || "-",
    items,
    totalAmount: order.amount.toFixed(2),
    totalAmountInWord: numberToIndianWords(order.amount),
    notes: DEFAULT_NOTES,
  };

  const html = await ejs.renderFile(TEMPLATE_PATH, data);
  return renderPdfFromHtml(html);
}

export async function generateEbookReceipt(orderId: string, customerId: string): Promise<Buffer> {
  if (!Types.ObjectId.isValid(orderId)) throw new Error("Invalid order id.");
  const order = await EbookOrder.findOne({ _id: orderId, customerId }).lean();
  if (!order) throw new Error("Order not found.");
  if (!order.razorpayPaymentId) throw new Error("Order has not been paid yet.");

  const [customer, ebook, plan] = await Promise.all([
    Customer.findById(customerId).lean(),
    Ebook.findById(order.ebookId).lean(),
    order.planId ? EbookPrice.findById(order.planId).lean() : Promise.resolve(null),
  ]);
  if (!customer) throw new Error("Customer not found.");

  const validity = plan?.duration
    ? `${plan.duration} month${plan.duration > 1 ? "s" : ""}`
    : "-";

  const items = [
    {
      name: (ebook as any)?.name || "Ebook",
      validity,
      amount: order.orderPrice.toFixed(2),
    },
  ];

  const data = {
    contactNumber: COMPANY_CONTACT,
    email: COMPANY_EMAIL,
    paymentMethod: order.paymentMethod || "Online",
    razorpayPaymentId: order.razorpayPaymentId || "-",
    receipt: order.razorpayOrderId || String(order._id),
    createdDate: formatDate(order.createdAt),
    userName: fullName(customer) || "-",
    userPhone: customer.phoneNumber || "-",
    userEmailAddress: customer.emailAddress || "-",
    items,
    totalAmount: order.orderPrice.toFixed(2),
    totalAmountInWord: numberToIndianWords(order.orderPrice),
    notes: DEFAULT_NOTES,
  };

  const html = await ejs.renderFile(TEMPLATE_PATH, data);
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

export async function generateExamSolutionPdf(
  examId: string,
  customerId: string,
  attemptId?: string,
): Promise<{ pdf: Buffer; fileName: string }> {
  if (!Types.ObjectId.isValid(examId)) throw new Error("Invalid exam id.");
  if (attemptId && !Types.ObjectId.isValid(attemptId)) throw new Error("Invalid attempt id.");

  const target = attemptId
    ? await ExamResult.findOne({ _id: attemptId, customerId, examId, status: true }).lean()
    : await ExamResult.findOne({ customerId, examId, status: true })
        .sort({ submittedAt: -1, attemptNumber: -1 })
        .lean();
  if (!target) throw new Error("No submitted attempt found.");

  const [exam, customer, details] = await Promise.all([
    Exam.findById(examId).lean<any>(),
    Customer.findById(customerId).lean(),
    ExamResultDetail.find({ examResultId: target._id })
      .populate({ path: "questionId", model: ExamQuestion })
      .lean(),
  ]);
  if (!exam) throw new Error("Exam not found.");
  if (!customer) throw new Error("Customer not found.");

  const qIds = details.map((d: any) => d.questionId?._id).filter(Boolean);
  const options = await ExamQuestionOption.find({ questionId: { $in: qIds } })
    .sort({ orderBy: 1, createdAt: 1 })
    .lean();
  const optsByQ: Record<string, any[]> = {};
  options.forEach((o: any) => {
    (optsByQ[String(o.questionId)] ||= []).push(o);
  });

  const norm = (s: string) => (s ?? "").trim().toLowerCase();

  const questions = details
    .filter((d: any) => d.questionId)
    .map((d: any) => {
      const q = d.questionId;
      const qOptions = (optsByQ[String(q._id)] || []).map((o: any) => ({
        name: o.name,
        isSelect: String(d.answerId) === String(o._id),
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
        title: q.title,
        options: qOptions,
        correctAnswer: q.answer,
        selectedAnswer: selectedOpt?.name || "",
        status,
        point: d.point ?? 0,
      };
    });

  const accuracy =
    target.total > 0 ? Math.round((target.success * 10000) / target.total) / 100 : 0;
  const totalMarks = target.total * (exam.positiveMarks || 1);

  const bestPerUser = await ExamResult.aggregate([
    { $match: { examId: new Types.ObjectId(examId), status: true } },
    { $group: { _id: "$customerId", best: { $max: "$score" } } },
  ]);
  const myBest = bestPerUser.find((u: any) => String(u._id) === String(customerId))?.best ?? target.score;
  const higher = bestPerUser.filter((u: any) => u.best > myBest).length;
  const rank = `${higher + 1}/${bestPerUser.length}`;

  const data = {
    contactNumber: COMPANY_CONTACT,
    email: COMPANY_EMAIL,
    generatedAt: formatDateTime(new Date()),
    examTitle: exam.title || "Quiz",
    attemptNumber: target.attemptNumber,
    submittedAt: formatDateTime(target.submittedAt as any),
    userName: fullName(customer) || "-",
    userPhone: customer.phoneNumber || "-",
    userEmailAddress: customer.emailAddress || "-",
    score: target.score,
    totalMarks,
    success: target.success,
    failed: target.failed,
    skip: target.skip,
    attempt: target.attempt,
    total: target.total,
    accuracy,
    rank,
    timing: target.timing || "00:00",
    questions,
  };

  const html = await ejs.renderFile(SOLUTION_TEMPLATE_PATH, data);
  const pdf = await renderPdfFromHtml(html);
  const safeTitle = (exam.title || "quiz").replace(/[^a-z0-9-_]+/gi, "_").slice(0, 40);
  const fileName = `${safeTitle}_attempt${target.attemptNumber}.pdf`;
  return { pdf, fileName };
}
