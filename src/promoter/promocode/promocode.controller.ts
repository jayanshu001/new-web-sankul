import { Request, Response } from "express";
import mongoose from "mongoose";
import { PromoCode } from "../../models/course/PromoCode.model";
import { Package } from "../../models/course/Package.model";
import { Course } from "../../models/course/Course.model";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { EbookSubscription } from "../../models/ebook/EbookSubscription.model";

const APPLIES_TO_MODEL = {
  package: Package,
  course: Course,
  liveCourse: LiveCourse,
} as const;

async function populateAppliesTo(promo: any) {
  const at = promo?.appliesTo;
  if (!at?.ids?.length) return promo;
  const Model = APPLIES_TO_MODEL[at.type as keyof typeof APPLIES_TO_MODEL] as any;
  if (!Model) return promo;
  const records = await Model.find({ _id: { $in: at.ids } })
    .select("_id name image")
    .lean();
  return { ...promo, appliesTo: { type: at.type, ids: records } };
}

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

// GET /api/v1/promoter/promocodes
export const listMyPromocodes = async (req: Request, res: Response) => {
  try {
    const promoterId = req.user?.id;
    if (!promoterId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const data = await PromoCode.find({ promoterId }).sort({ createdAt: -1 }).lean();

    const ids = data.map((p) => p._id);
    const [courseUsage, ebookUsage] = await Promise.all([
      PackageCourseSubscription.aggregate([
        { $match: { promocodeId: { $in: ids } } },
        { $group: { _id: "$promocodeId", count: { $sum: 1 }, revenue: { $sum: "$paidAmount" } } },
      ]),
      EbookSubscription.aggregate([
        { $match: { promocodeId: { $in: ids } } },
        { $group: { _id: "$promocodeId", count: { $sum: 1 }, revenue: { $sum: "$price" } } },
      ]),
    ]);

    const usageMap: Record<string, { count: number; revenue: number }> = {};
    [...courseUsage, ...ebookUsage].forEach((row: any) => {
      const k = String(row._id);
      usageMap[k] ||= { count: 0, revenue: 0 };
      usageMap[k].count += row.count;
      usageMap[k].revenue += row.revenue || 0;
    });

    const enriched = data.map((p: any) => ({
      ...p,
      usageCount: usageMap[String(p._id)]?.count || 0,
      revenue: usageMap[String(p._id)]?.revenue || 0,
    }));

    return res.status(200).json({ success: true, data: enriched });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/promoter/promocodes/:id
export const getMyPromocode = async (req: Request, res: Response) => {
  try {
    const promoterId = req.user?.id;
    if (!promoterId) return res.status(401).json({ success: false, message: "Unauthorized." });
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid id." });

    const promocode = await PromoCode.findOne({ _id: id, promoterId }).lean();
    if (!promocode)
      return res.status(404).json({ success: false, message: "Promocode not found." });

    const populated = await populateAppliesTo(promocode);
    return res.status(200).json({ success: true, data: { promocode: populated } });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
