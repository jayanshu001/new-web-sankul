import { Request, Response } from "express";
import { PromoCode } from "../../models/course/PromoCode.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { Customer } from "../../models/customer/Customer.model";
import { unionAllPromoterSubsStages, promoterScopeMatch } from "../shared/promoterSubscriptions";

import { buildPromoterOverview } from "./overview.service";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

// GET /api/v1/promoter/dashboard
export const getDashboard = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const promoterId = req.user?.id;
  logger.info("getDashboard invoked", { traceId, path: req.originalUrl, promoterId });

  try {
    if (!promoterId) { logger.warn("getDashboard unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const now = new Date();
    const scope = promoterScopeMatch(promoterId);

    // Totals/revenue/commission/recents now span all 4 subscription collections
    // (course/package, ebook, test-series, live-course) via the union helper.
    const [
      promocodeCount,
      activePromocodeCount,
      totalsAgg,
      activeAgg,
      uniqueCustomerAgg,
      perTypeRevenueAgg,
      recentAgg,
    ] = await Promise.all([
      PromoCode.countDocuments({ promoterId }),
      PromoCode.countDocuments({
        promoterId,
        status: true,
        promo_expire_at: { $gt: now },
      }),
      PackageCourseSubscription.aggregate([
        ...unionAllPromoterSubsStages(scope),
        {
          $group: {
            _id: null,
            subscriptionCount: { $sum: 1 },
            totalRevenue: { $sum: "$amount" },
            commissionEarned: { $sum: "$commission" },
          },
        },
      ]),
      PackageCourseSubscription.aggregate([
        ...unionAllPromoterSubsStages({ ...scope, status: true, endAt: { $gt: now } }),
        { $group: { _id: null, activeCount: { $sum: 1 } } },
      ]),
      PackageCourseSubscription.aggregate([
        ...unionAllPromoterSubsStages(scope),
        { $group: { _id: "$customerId" } },
        { $count: "uniqueCustomers" },
      ]),
      // Per-product revenue breakdown (so the FE can still show course vs ebook
      // vs test-series vs live-course splits if it wants).
      PackageCourseSubscription.aggregate([
        ...unionAllPromoterSubsStages(scope),
        { $group: { _id: "$productType", revenue: { $sum: "$amount" }, count: { $sum: 1 } } },
      ]),
      PackageCourseSubscription.aggregate([
        ...unionAllPromoterSubsStages(scope),
        { $sort: { createdAt: -1 } },
        { $limit: 10 },
      ]),
    ]);

    const totals = totalsAgg[0] || { subscriptionCount: 0, totalRevenue: 0, commissionEarned: 0 };
    const revenueByType: Record<string, { revenue: number; count: number }> = {};
    for (const r of perTypeRevenueAgg as any[]) {
      revenueByType[r._id] = { revenue: r.revenue || 0, count: r.count || 0 };
    }

    // Resolve customer + promocode names for the 10 recent rows in two batched
    // lookups (rows are already unioned across collections).
    const recentCustomerIds = recentAgg.map((r: any) => r.customerId).filter(Boolean);
    const recentPromoIds = recentAgg.map((r: any) => r.promocodeId).filter(Boolean);
    const [recentCustomers, recentPromos] = await Promise.all([
      recentCustomerIds.length
        ? Customer.find({ _id: { $in: recentCustomerIds } }).select("firstName lastName phoneNumber").lean()
        : [],
      recentPromoIds.length
        ? PromoCode.find({ _id: { $in: recentPromoIds } }).select("promocode").lean()
        : [],
    ]);
    const custMap = new Map(recentCustomers.map((c: any) => [String(c._id), c]));
    const promoMap = new Map(recentPromos.map((p: any) => [String(p._id), p]));
    const recentSubscriptions = recentAgg.map((s: any) => {
      const c = s.customerId ? custMap.get(String(s.customerId)) : null;
      const promo = s.promocodeId ? promoMap.get(String(s.promocodeId)) : null;
      return {
        id: String(s._id),
        customer: c
          ? { id: String(c._id), name: `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Unknown", phoneNumber: c.phoneNumber ?? null }
          : { id: null, name: "Unknown", phoneNumber: null },
        productType: s.productType,
        promocode: promo?.promocode ?? null,
        amount: s.amount ?? 0,
        status: s.status ? "complete" : "pending",
        createdAt: s.createdAt,
      };
    });

    logger.info("getDashboard success", { traceId, promoterId, subscriptionCount: totals.subscriptionCount, totalRevenue: totals.totalRevenue });
    return res.status(200).json({
      success: true,
      data: {
        summary: {
          promocodeCount,
          activePromocodeCount,
          subscriptionCount: totals.subscriptionCount,
          activeSubscriptionCount: activeAgg[0]?.activeCount || 0,
          // Per-product counts/revenue, now that all 5 products are included.
          ebookSubscriptionCount: revenueByType.ebook?.count || 0,
          testSeriesSubscriptionCount: revenueByType.testSeries?.count || 0,
          liveCourseSubscriptionCount: revenueByType.liveCourse?.count || 0,
          uniqueCustomerCount: uniqueCustomerAgg[0]?.uniqueCustomers || 0,
          courseRevenue: revenueByType.packageCourse?.revenue || 0,
          ebookRevenue: revenueByType.ebook?.revenue || 0,
          testSeriesRevenue: revenueByType.testSeries?.revenue || 0,
          liveCourseRevenue: revenueByType.liveCourse?.revenue || 0,
          totalRevenue: Math.round(totals.totalRevenue || 0),
          commissionEarned: Math.round(totals.commissionEarned || 0),
        },
        recentSubscriptions,
      },
    });
  } catch (e: any) {
    logger.error("getDashboard failed", { traceId, promoterId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/promoter/dashboard/overview?range=today|week|month|year|all
// The logged-in promoter sees their own data. Admin views the same screen via
// /api/v1/admin/promoters/:id/dashboard.
export const getDashboardOverview = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const promoterId = req.user?.id;
  logger.info("getDashboardOverview invoked", { traceId, path: req.originalUrl, promoterId, range: req.query.range });

  try {
    if (!promoterId) { logger.warn("getDashboardOverview unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const { range, startDate, endDate, promocodeId } = req.query as Record<string, string>;
    const data = await buildPromoterOverview(promoterId, range, traceId, { startDate, endDate, promocodeId });
    logger.info("getDashboardOverview success", { traceId, promoterId });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("getDashboardOverview failed", { traceId, promoterId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
