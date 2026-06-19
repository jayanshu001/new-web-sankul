import PDFDocument from "pdfkit";
import { Types } from "mongoose";
import { PackageCourseSubscription } from "../models/customer/PackageCourseSubscription.model";
import { Course } from "../models/course/Course.model";
import { PackageCourseEbookPrice } from "../models/course/PackageCourseEbookPrice.model";
import { isMysqlModule } from "../config/migration";
import { prisma } from "../config/prisma";

/**
 * Course order receipt PDF (pdfkit).
 *
 * Reads a PackageCourseSubscription and resolves its Course (name) + plan
 * (PackageCourseEbookPrice: name/duration/price/withMaterial/materialPrice),
 * then renders a fixed-layout receipt. The pdfkit rendering is backend-agnostic;
 * only the three DB reads are dual-pathed behind `isMysqlModule("pdf-course-receipt")`.
 *
 * SQL note: in MySQL the subscription id is an int (Mongo used an ObjectId string),
 * and the Course/plan are resolved via Prisma relations on the same int FKs. The
 * fields rendered (name/duration/price/withMaterial/materialPrice) all exist on the
 * SQL tables, so the receipt output is identical.
 */
const RECEIPT_MODULE = "pdf-course-receipt";

type ReceiptParts = {
  course: { name?: string | null } | null;
  plan:
    | {
        name?: string | null;
        duration?: number | null;
        price?: number | null;
        withMaterial?: boolean | null;
        materialPrice?: number | null;
      }
    | null;
};

async function loadFromMysql(subscriptionId: string): Promise<ReceiptParts> {
  const id = Number(subscriptionId);
  if (!Number.isInteger(id) || id <= 0) return { course: null, plan: null };
  const sub = await prisma.packageCourseSubscription.findUnique({
    where: { id },
    select: {
      course: { select: { name: true } },
      packageCourseEbookPrice: {
        select: {
          name: true,
          duration: true,
          price: true,
          withMaterial: true,
          materialPrice: true,
        },
      },
    },
  });
  return {
    course: sub?.course ?? null,
    plan: sub?.packageCourseEbookPrice ?? null,
  };
}

async function loadFromMongo(subscriptionId: string): Promise<ReceiptParts> {
  const sub = await PackageCourseSubscription.findById(subscriptionId).lean();
  const course = sub?.courseId
    ? await Course.findById(sub.courseId).select("name").lean()
    : null;
  const plan = sub?.packageId
    ? await PackageCourseEbookPrice.findById(sub.packageId)
        .select("name duration price withMaterial materialPrice")
        .lean()
    : null;
  return {
    course: (course as ReceiptParts["course"]) ?? null,
    plan: (plan as ReceiptParts["plan"]) ?? null,
  };
}

export async function pdfCourseReceipt(subscriptionId: string): Promise<Buffer> {
  const { course, plan } = isMysqlModule(RECEIPT_MODULE)
    ? await loadFromMysql(subscriptionId)
    : await loadFromMongo(subscriptionId);

  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", (err: Error) => reject(err));

    doc.fontSize(18).text("Course Order Receipt", { align: "center" });
    doc.moveDown();

    doc.fontSize(11);
    doc.text(`Receipt No: ${subscriptionId}`);
    doc.text(`Date: ${new Date().toISOString().slice(0, 10)}`);
    doc.moveDown();

    doc.text(`Course: ${course?.name ?? "-"}`);
    doc.text(`Plan: ${plan?.name ?? "-"}`);
    doc.text(`Duration (days): ${plan?.duration ?? "-"}`);
    doc.text(`Price: ${plan?.price ?? 0}`);
    doc.text(`With Material: ${plan?.withMaterial ? "Yes" : "No"}`);
    if (plan?.withMaterial) {
      doc.text(`Material Price: ${plan.materialPrice ?? 0}`);
    }

    doc.end();
  });
}

export function isValidSubscriptionId(id: string): boolean {
  // MySQL ids are positive integers; Mongo ids are ObjectIds. Accept either so the
  // validity check works regardless of which backend is active.
  if (isMysqlModule(RECEIPT_MODULE)) {
    const n = Number(id);
    return Number.isInteger(n) && n > 0;
  }
  return Types.ObjectId.isValid(id);
}
