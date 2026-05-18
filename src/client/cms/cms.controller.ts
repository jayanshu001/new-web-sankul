import { Request, Response } from "express";
import mongoose from "mongoose";
import { FAQ } from "../../models/system/FAQ.model";
import { FaqType } from "../../models/system/FaqType.model";
import { PopupNotification } from "../../models/system/PopupNotification.model";
import { BannerSlider } from "../../models/system/BannerSlider.model";
import { LiveBannerSlider } from "../../models/system/LiveBannerSlider.model";
import { Testimonial } from "../../models/system/Testimonial.model";
import { TermsAndConditions } from "../../models/system/TermsAndConditions.model";
import { Version } from "../../models/system/Version.model";
import { AppUpdate } from "../../models/system/AppUpdate.model";
import { SocialLink } from "../../models/system/SocialLink.model";
import { SocialLinkType } from "../../models/system/SocialLinkType.model";

// GET /api/v1/client/faqs[?typeId=…]
export const listFaqs = async (req: Request, res: Response) => {
  try {
    const { typeId } = req.query as Record<string, string>;
    const filter: any = {};
    if (typeId && mongoose.Types.ObjectId.isValid(typeId)) filter.typeId = typeId;
    const data = await FAQ.find(filter)
      .populate("typeId", "_id title")
      .sort({ createdAt: 1 })
      .lean();
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/faq-types
export const listFaqTypes = async (_req: Request, res: Response) => {
  try {
    const data = await FaqType.find().sort({ title: 1 }).lean();
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/popup — active popup (most recent non-expired)
export const getActivePopup = async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const data = await PopupNotification.findOne({
      status: true,
      promoExpireAt: { $gt: now },
    })
      .sort({ createdAt: -1 })
      .lean();
    return res.status(200).json({ success: true, data: data ?? null });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/banners
export const listBanners = async (req: Request, res: Response) => {
  try {
    const { key } = req.query as Record<string, string>;
    const filter: any = {};
    if (key) filter.key = key;
    const data = await BannerSlider.find(filter)
      .sort({ orderBy: 1 })
      .populate("keyId")
      .lean();
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/cms/live-banners
export const listLiveBanners = async (_req: Request, res: Response) => {
  try {
    const data = await LiveBannerSlider.find()
      .sort({ orderBy: 1 })
      .populate("liveCourseId")
      .lean();
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/testimonials
export const listTestimonials = async (_req: Request, res: Response) => {
  try {
    const data = await Testimonial.find().sort({ rating: -1 }).lean();
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/social-links — active social links, ordered
export const listSocialLinks = async (_req: Request, res: Response) => {
  try {
    const data = await SocialLink.find({ status: true })
      .populate("typeId", "_id title")
      .sort({ order: 1 })
      .lean();
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/social-link-types
export const listSocialLinkTypes = async (_req: Request, res: Response) => {
  try {
    const data = await SocialLinkType.find().sort({ title: 1 }).lean();
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/terms[?module=xxx]
export const getTerms = async (req: Request, res: Response) => {
  try {
    const { module: moduleName } = req.query as Record<string, string>;
    const filter: any = { status: true };
    if (moduleName) filter.module = moduleName;
    const data = moduleName
      ? await TermsAndConditions.findOne(filter).lean()
      : await TermsAndConditions.find(filter).lean();
    return res.status(200).json({ success: true, data: data ?? null });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/version — current app version config
export const getVersion = async (_req: Request, res: Response) => {
  try {
    const data = (await Version.findOne().lean()) || {
      latestVersionCode: 0,
      lastSupportedVersionCode: 0,
    };
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/upgrade[?clientVersion=123] — whether an update is available
export const checkUpgrade = async (req: Request, res: Response) => {
  try {
    const clientVersion = Number((req.query.clientVersion as string) ?? "") || 0;
    const [appUpdate, version] = await Promise.all([
      AppUpdate.findOne().lean(),
      Version.findOne().lean(),
    ]);

    const latest = appUpdate?.latestVersion ?? version?.latestVersionCode ?? 0;
    const lastSupported = version?.lastSupportedVersionCode ?? 0;

    const isForceUpdate =
      clientVersion > 0 && clientVersion < lastSupported;
    const isUpdateAvailable =
      appUpdate?.isUpdateAvailable ?? clientVersion < latest;

    return res.status(200).json({
      success: true,
      data: {
        clientVersion,
        latestVersion: latest,
        lastSupportedVersion: lastSupported,
        updateType: appUpdate?.updateType ?? "flexible",
        isUpdateAvailable,
        isForceUpdate,
      },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
