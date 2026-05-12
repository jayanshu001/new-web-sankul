import { Request, Response } from "express";
import mongoose from "mongoose";
import { Ebook } from "../../models/ebook/Ebook.model";
import { EbookPrice } from "../../models/ebook/EbookPrice.model";
import { EbookSubscription } from "../../models/ebook/EbookSubscription.model";
import { PromoCode } from "../../models/course/PromoCode.model";
import { PromotedPackageCourseEbook } from "../../models/course/PromotedPackageCourseEbook.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

const daysBetween = (from: Date, to: Date) =>
  Math.max(0, Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)));

// GET /api/v1/client/ebooks
export const listEbooks = async (req: Request, res: Response) => {
  try {
    const customerId = (req as any).user?.id;
    const { search, language } = req.query as Record<string, string>;
    const filter: any = { status: true };
    if (search) filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { author: { $regex: search, $options: "i" } },
    ];
    if (language) filter.language = language;

    const ebooks = await Ebook.find(filter).sort({ order: 1, createdAt: -1 }).lean();
    const ebookIds = ebooks.map((e) => e._id);

    const plans = await EbookPrice.find({
      ebookId: { $in: ebookIds },
      status: true,
    })
      .sort({ duration: 1 })
      .lean();

    const plansByEbook: Record<string, any[]> = {};
    plans.forEach((p) => {
      const key = String(p.ebookId);
      (plansByEbook[key] ||= []).push(p);
    });

    // Ebook access is time-bound: only currently-active subscriptions count
    // as "purchased". Endpoint also returns the soonest expiry so the catalog
    // card can show "X days left" without a second call.
    const now = new Date();
    const activeByEbook = new Map<string, Date>();
    if (customerId && ebookIds.length) {
      const subs = await EbookSubscription.find({
        customerId,
        ebookId: { $in: ebookIds },
        status: true,
        endAt: { $gt: now },
      })
        .select("ebookId endAt")
        .lean();
      subs.forEach((s: any) => {
        const key = String(s.ebookId);
        const prev = activeByEbook.get(key);
        // If a customer somehow has two overlapping subs for the same ebook,
        // keep the LATEST endAt — that's the access window they actually have.
        if (!prev || s.endAt.getTime() > prev.getTime()) {
          activeByEbook.set(key, s.endAt);
        }
      });
    }

    const data = ebooks.map((e) => {
      const endAt = activeByEbook.get(String(e._id)) || null;
      return {
        ...e,
        plans: plansByEbook[String(e._id)] || [],
        details: [
          { id: 1, mainText: "Language", subText: e.language },
          { id: 2, mainText: "Author", subText: e.author },
          { id: 3, mainText: "Publisher", subText: e.publisher },
        ],
        isPurchased: !!endAt,
        subscriptionEndAt: endAt,
        daysLeft: endAt ? daysBetween(now, endAt) : null,
      };
    });

    return res.status(200).json({ success: true, data: { ebooks: data } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/ebooks/subscriptions
export const listMySubscriptions = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || (req as any).user?._id;
    const now = new Date();

    const subs = await EbookSubscription.find({
      customerId: userId,
      endAt: { $gt: now },
      status: true,
    })
      .populate("ebookId")
      .sort({ endAt: 1 })
      .lean();

    const subscriptions = subs
      .filter((s: any) => s.ebookId)
      .map((s: any) => ({
        ...s.ebookId,
        startAt: s.startAt,
        endAt: s.endAt,
        remainingDays: daysBetween(now, s.endAt),
      }));

    return res.status(200).json({ success: true, data: { subscriptions } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/ebooks/:id
export const getEbookDetail = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Please select valid ebook." });

    const customerId = (req as any).user?.id;
    const ebook = await Ebook.findOne({ _id: id, status: true }).lean();
    if (!ebook) return res.status(404).json({ success: false, message: "Ebook not found." });

    const plans = await EbookPrice.find({ ebookId: id, status: true })
      .sort({ duration: 1 })
      .lean();

    // Active subscription lookup — same rule as listEbooks: latest endAt wins.
    const nowAccess = new Date();
    let subscriptionEndAt: Date | null = null;
    if (customerId) {
      const sub = await EbookSubscription.findOne({
        customerId,
        ebookId: id,
        status: true,
        endAt: { $gt: nowAccess },
      })
        .select("endAt")
        .sort({ endAt: -1 })
        .lean();
      if (sub) subscriptionEndAt = sub.endAt;
    }

    // Public promocodes available for this ebook (via PackageCourseEbookPrice linkage)
    const pceplans = await PackageCourseEbookPrice.find({ ebookId: id, status: true })
      .select("_id")
      .lean();
    const pcePlanIds = pceplans.map((p) => p._id);

    let availablePromoCode: Array<{ title: string; promocode: string; description: string }> = [];
    if (pcePlanIds.length) {
      const promoted = await PromotedPackageCourseEbook.find({ planId: { $in: pcePlanIds } })
        .populate({
          path: "promocodeId",
          match: { type: "public" },
        })
        .lean();

      const now = new Date();
      const seen = new Set<string>();
      promoted.forEach((p: any) => {
        const pc = p.promocodeId;
        if (!pc) return;
        if (!pc.status) return;
        if (pc.promo_start_at > now || pc.promo_expire_at < now) return;
        if (seen.has(pc.promocode)) return;
        seen.add(pc.promocode);
        availablePromoCode.push({
          title: pc.title,
          promocode: pc.promocode,
          description: pc.description,
        });
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        ebook: {
          ...ebook,
          plans,
          isPurchased: !!subscriptionEndAt,
          subscriptionEndAt,
          daysLeft: subscriptionEndAt ? daysBetween(nowAccess, subscriptionEndAt) : null,
        },
        availablePromoCode,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/ebooks/:id/invoice/:orderId (placeholder for invoice)
export const getEbookOrderInvoice = async (req: Request, res: Response) => {
  try {
    // Stub — PDF generation to be wired with generate lib from old project
    return res
      .status(501)
      .json({ success: false, message: "Invoice generation not yet implemented." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
