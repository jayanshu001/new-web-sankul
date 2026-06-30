import PDFDocument from "pdfkit";
import { prisma } from "../config/prisma";

/**
 * Course order receipt PDF (pdfkit).
 *
 * Reads a PackageCourseSubscription and resolves its Course (name) + plan
 * (PackageCourseEbookPrice: name/duration/price/withMaterial/materialPrice),
 * then renders a fixed-layout receipt.
 *
 * The subscription id is an int, and the Course/plan are resolved via Prisma
 * relations on the same int FKs. The fields rendered (name/duration/price/
 * withMaterial/materialPrice) all exist on the SQL tables.
 */
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

async function loadReceiptParts(subscriptionId: string): Promise<ReceiptParts> {
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

export async function pdfCourseReceipt(subscriptionId: string): Promise<Buffer> {
  const { course, plan } = await loadReceiptParts(subscriptionId);

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
  // MySQL ids are positive integers.
  const n = Number(id);
  return Number.isInteger(n) && n > 0;
}
