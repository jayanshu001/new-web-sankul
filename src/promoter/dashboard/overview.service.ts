import mongoose from "mongoose";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { PromoCode } from "../../models/course/PromoCode.model";
import { Course } from "../../models/course/Course.model";
import { Customer } from "../../models/customer/Customer.model";

export type RangeKey = "today" | "week" | "month" | "year" | "all";
export const ALLOWED_RANGES: RangeKey[] = ["today", "week", "month", "year", "all"];

export function resolveRange(key: RangeKey | undefined, now: Date) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  switch (key) {
    case "today":
      return { start, end: now };
    case "week": {
      const s = new Date(start);
      s.setDate(s.getDate() - 6);
      return { start: s, end: now };
    }
    case "month": {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: s, end: now };
    }
    case "year": {
      const s = new Date(now.getFullYear(), 0, 1);
      return { start: s, end: now };
    }
    case "all":
    default:
      return { start: null as Date | null, end: now };
  }
}

export function bucketFormatFor(range: RangeKey) {
  switch (range) {
    case "today":
      return { fmt: "%Y-%m-%d %H:00", unit: "hour" as const };
    case "week":
    case "month":
      return { fmt: "%Y-%m-%d", unit: "day" as const };
    case "year":
    case "all":
    default:
      return { fmt: "%Y-%m", unit: "month" as const };
  }
}

export async function buildPromoterOverview(promoterId: string, rangeRaw: string | undefined) {
  const range: RangeKey = ALLOWED_RANGES.includes(rangeRaw as RangeKey)
    ? (rangeRaw as RangeKey)
    : "all";

  const now = new Date();
  const { start, end } = resolveRange(range, now);
  const { fmt, unit } = bucketFormatFor(range);

  const promoterObjId = mongoose.Types.ObjectId.createFromHexString(promoterId);
  const dateFilter: Record<string, unknown> = { $lte: end };
  if (start) dateFilter.$gte = start;

  const baseMatch: Record<string, unknown> = { promoterId: promoterObjId };
  if (start) baseMatch.createdAt = dateFilter;

  const [totalsAgg, seriesAgg, recent] = await Promise.all([
    PackageCourseSubscription.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: null,
          subscriptions: { $sum: 1 },
          earnings: { $sum: { $ifNull: ["$paidAmount", 0] } },
          commission: {
            $sum: {
              $multiply: [
                { $ifNull: ["$paidAmount", 0] },
                { $divide: [{ $ifNull: ["$promoterPercentage", 0] }, 100] },
              ],
            },
          },
        },
      },
    ]),
    PackageCourseSubscription.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: { $dateToString: { format: fmt, date: "$createdAt" } },
          subscriptions: { $sum: 1 },
          earnings: { $sum: { $ifNull: ["$paidAmount", 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    PackageCourseSubscription.find({ promoterId })
      .populate({
        path: "customerId",
        model: Customer,
        select: "firstName lastName phoneNumber",
      })
      .populate({ path: "courseId", model: Course, select: "name" })
      .populate({ path: "promocodeId", model: PromoCode, select: "promocode" })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
  ]);

  const totals = totalsAgg[0] || { subscriptions: 0, earnings: 0, commission: 0 };
  const series = seriesAgg.map((row: any) => ({
    bucket: row._id,
    subscriptions: row.subscriptions,
    earnings: row.earnings,
  }));
  const recentSubscriptions = recent.map((s: any) => {
    const c = s.customerId as any;
    const course = s.courseId as any;
    const promo = s.promocodeId as any;
    const name = c
      ? `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Unknown"
      : "Unknown";
    return {
      id: String(s._id),
      customer: {
        id: c ? String(c._id) : null,
        name,
        phoneNumber: c?.phoneNumber ?? null,
      },
      course: course ? { id: String(course._id), name: course.name ?? "" } : null,
      promocode: promo?.promocode ?? null,
      amount: s.paidAmount ?? 0,
      status: s.status ? "complete" : "pending",
      createdAt: s.createdAt,
    };
  });

  return {
    range,
    window: { start, end },
    totals: {
      subscriptions: totals.subscriptions,
      earnings: Math.round(totals.earnings || 0),
      commission: Math.round(totals.commission || 0),
    },
    chart: { unit, points: series },
    recentSubscriptions,
  };
}
