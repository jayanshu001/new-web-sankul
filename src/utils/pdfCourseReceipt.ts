import PDFDocument from "pdfkit";
import { Types } from "mongoose";
import { PackageCourseSubscription } from "../models/customer/PackageCourseSubscription.model";
import { Course } from "../models/course/Course.model";
import { PackageCourseEbookPrice } from "../models/course/PackageCourseEbookPrice.model";

export async function pdfCourseReceipt(subscriptionId: string): Promise<Buffer> {
  const sub = await PackageCourseSubscription.findById(subscriptionId).lean();
  const course = sub?.courseId
    ? await Course.findById(sub.courseId).select("name").lean()
    : null;
  const plan = sub?.packageId
    ? await PackageCourseEbookPrice.findById(sub.packageId)
        .select("name duration price withMaterial materialPrice")
        .lean()
    : null;

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
  return Types.ObjectId.isValid(id);
}
