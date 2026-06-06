import { Request, Response } from "express";
import {
  listFaqs as listFaqsService,
  listFaqTypes as listFaqTypesService,
} from "../../modules/faq/faq.service";
import { LiveBannerSlider } from "../../models/system/LiveBannerSlider.model";
import { listBanners as listBannersService } from "../../modules/banner-slider/banner-slider.service";
import { listTestimonials as listTestimonialsService } from "../../modules/testimonial/testimonial.service";
import { getClientTerms } from "../../modules/terms/terms.service";
import { getActivePopup as getActivePopupService } from "../../modules/popup/popup.service";
import { checkClientUpgrade } from "../../modules/cms/upgrade-check.service";
import { getVersionSettings } from "../../modules/version/version.service";
import { SocialLink } from "../../models/system/SocialLink.model";
import { SocialLinkType } from "../../models/system/SocialLinkType.model";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

// GET /api/v1/client/faqs[?typeId=…]
export const listFaqs = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listFaqs invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { typeId, type } = req.query as Record<string, string>;
    const filterKey = typeId ?? type;
    const data = await listFaqsService(
      filterKey ? { typeId: filterKey } : undefined
    );
    logger.info("listFaqs success", { traceId, count: data.length });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("listFaqs failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/faq-types
export const listFaqTypes = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("listFaqTypes invoked", { traceId, path: _req.originalUrl });

  try {
    const data = await listFaqTypesService();
    logger.info("listFaqTypes success", { traceId, count: data.length });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("listFaqTypes failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/popup — active popup (most recent non-expired)
export const getActivePopup = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("getActivePopup invoked", { traceId, path: _req.originalUrl });

  try {
    const data = await getActivePopupService();
    logger.info("getActivePopup success", { traceId, hasPopup: !!data });
    return res.status(200).json({ success: true, data: data ?? null });
  } catch (e: any) {
    logger.error("getActivePopup failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/banners
export const listBanners = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listBanners invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { key } = req.query as Record<string, string>;
    const data = await listBannersService(key ? { key } : undefined);
    logger.info("listBanners success", { traceId, key, count: data.length });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("listBanners failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/cms/live-banners
export const listLiveBanners = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("listLiveBanners invoked", { traceId, path: _req.originalUrl });

  try {
    const data = await LiveBannerSlider.find()
      .sort({ orderBy: 1 })
      .populate("liveCourseId")
      .lean();
    logger.info("listLiveBanners success", { traceId, count: data.length });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("listLiveBanners failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/testimonials
export const listTestimonials = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("listTestimonials invoked", { traceId, path: _req.originalUrl });

  try {
    const data = await listTestimonialsService();
    logger.info("listTestimonials success", { traceId, count: data.length });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("listTestimonials failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/social-links — active social links, ordered
export const listSocialLinks = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("listSocialLinks invoked", { traceId, path: _req.originalUrl });

  try {
    const data = await SocialLink.find({ status: true })
      .populate("typeId", "_id title")
      .sort({ order: 1 })
      .lean();
    logger.info("listSocialLinks success", { traceId, count: data.length });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("listSocialLinks failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/social-link-types
export const listSocialLinkTypes = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("listSocialLinkTypes invoked", { traceId, path: _req.originalUrl });

  try {
    const data = await SocialLinkType.find().sort({ title: 1 }).lean();
    logger.info("listSocialLinkTypes success", { traceId, count: data.length });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("listSocialLinkTypes failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/terms[?module=xxx]
export const getTerms = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("getTerms invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { module: moduleName } = req.query as Record<string, string>;
    const data = await getClientTerms(moduleName);
    logger.info("getTerms success", { traceId, moduleName });
    return res.status(200).json({ success: true, data: data ?? null });
  } catch (e: any) {
    logger.error("getTerms failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/version — current app version config
export const getVersion = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("getVersion invoked", { traceId, path: _req.originalUrl });

  try {
    const data = await getVersionSettings();
    logger.info("getVersion success", { traceId });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("getVersion failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/upgrade[?clientVersion=123] — whether an update is available
export const checkUpgrade = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("checkUpgrade invoked", { traceId, path: req.originalUrl, clientVersion: req.query.clientVersion });

  try {
    const clientVersion = Number((req.query.clientVersion as string) ?? "") || 0;
    const data = await checkClientUpgrade(clientVersion);

    logger.info("checkUpgrade success", {
      traceId,
      clientVersion: data.clientVersion,
      latest: data.latestVersion,
      isUpdateAvailable: data.isUpdateAvailable,
      isForceUpdate: data.isForceUpdate,
    });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("checkUpgrade failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
