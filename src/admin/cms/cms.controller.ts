import { Request, Response } from "express";
import mongoose, { Model } from "mongoose";
import { FaqType } from "../../models/system/FaqType.model";
import { isMysqlModule } from "../../config/migration";
import {
  listFaqs as listFaqsService,
  getFaqById,
  createFaq as createFaqService,
  updateFaq as updateFaqService,
  deleteFaq as deleteFaqService,
  listFaqTypes as listFaqTypesService,
  parseFaqId,
  isFaqTypeInUse,
} from "../../modules/faq/faq.service";
import {
  faqCreateSchemaMysql,
  faqUpdateSchemaMysql,
} from "../../modules/faq/faq.validation";
import { PopupNotification } from "../../models/system/PopupNotification.model";
import { BannerSlider, BANNER_KEY_TO_MODEL, BannerKey } from "../../models/system/BannerSlider.model";
import { LiveBannerSlider } from "../../models/system/LiveBannerSlider.model";
import { Testimonial } from "../../models/system/Testimonial.model";
import { TermsAndConditions } from "../../models/system/TermsAndConditions.model";
import {
  getAppUpdateSettings,
  upsertAppUpdateSettings,
} from "../../modules/app-update/app-update.service";
import {
  getVersionSettings,
  upsertVersionSettings,
} from "../../modules/version/version.service";
import { SocialLink } from "../../models/system/SocialLink.model";
import { SocialLinkType } from "../../models/system/SocialLinkType.model";
import { CurrentAffair } from "../../models/system/CurrentAffair.model";
import {
  faqCreateSchema,
  faqUpdateSchema,
  faqTypeCreateSchema,
  faqTypeUpdateSchema,
  popupCreateSchema,
  popupUpdateSchema,
  bannerCreateSchema,
  bannerUpdateSchema,
  liveBannerCreateSchema,
  liveBannerUpdateSchema,
  testimonialCreateSchema,
  testimonialUpdateSchema,
  termsCreateSchema,
  termsUpdateSchema,
  versionUpsertSchema,
  appUpdateUpsertSchema,
  socialLinkCreateSchema,
  socialLinkUpdateSchema,
  socialLinkTypeCreateSchema,
  socialLinkTypeUpdateSchema,
  currentAffairCreateSchema,
  currentAffairUpdateSchema,
  reorderSchema,
} from "./cms.validation";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

// Generic CRUD helpers — keeps each resource below to a thin wrapper.
// `model.modelName` tags log entries so each derived endpoint is identifiable.
const genericList = (model: Model<any>, sort: Record<string, 1 | -1> = { createdAt: -1 }) =>
  async (_req: Request, res: Response) => {
    const traceId = _req.traceId;
    const m = model.modelName;
    logger.info(`cms ${m} list invoked`, { traceId, path: _req.originalUrl });

    try {
      const data = await model.find().sort(sort).lean();
      logger.info(`cms ${m} list success`, { traceId, count: data.length });
      return res.status(200).json({ success: true, data });
    } catch (e: any) {
      logger.error(`cms ${m} list failed`, { traceId, error: getErrorMessage(e), stack: e.stack });
      return res.status(500).json({ success: false, message: e.message });
    }
  };

const genericGet = (model: Model<any>) => async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const m = model.modelName;
  const id = req.params.id as string;
  logger.info(`cms ${m} get invoked`, { traceId, path: req.originalUrl, id });

  try {
    if (!isObjectId(id)) { logger.warn(`cms ${m} get invalid id`, { traceId, id }); return res.status(400).json({ success: false, message: "Invalid id." }); }
    const doc = await model.findById(id).lean();
    if (!doc) { logger.warn(`cms ${m} get not found`, { traceId, id }); return res.status(404).json({ success: false, message: "Not found." }); }
    logger.info(`cms ${m} get success`, { traceId, id });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    logger.error(`cms ${m} get failed`, { traceId, id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

const genericCreate = (model: Model<any>, schema: any, transform?: (d: any) => any) =>
  async (req: Request, res: Response) => {
    const traceId = req.traceId;
    const m = model.modelName;
    logger.info(`cms ${m} create invoked`, { traceId, path: req.originalUrl });

    try {
      const parsed = schema.parse(req.body);
      const payload = transform ? transform(parsed) : parsed;
      const doc = await model.create(payload);
      logger.info(`cms ${m} create success`, { traceId, id: doc._id });
      return res.status(201).json({ success: true, data: doc });
    } catch (e: any) {
      if (e.issues) { logger.warn(`cms ${m} create validation failed`, { traceId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
      logger.error(`cms ${m} create failed`, { traceId, error: getErrorMessage(e), stack: e.stack });
      return res.status(500).json({ success: false, message: e.message });
    }
  };

const genericUpdate = (model: Model<any>, schema: any, transform?: (d: any) => any) =>
  async (req: Request, res: Response) => {
    const traceId = req.traceId;
    const m = model.modelName;
    const id = req.params.id as string;
    logger.info(`cms ${m} update invoked`, { traceId, path: req.originalUrl, id });

    try {
      if (!isObjectId(id)) { logger.warn(`cms ${m} update invalid id`, { traceId, id }); return res.status(400).json({ success: false, message: "Invalid id." }); }
      const parsed = schema.parse(req.body);
      const payload = transform ? transform(parsed) : parsed;
      const doc = await model.findByIdAndUpdate(id, { $set: payload }, { new: true });
      if (!doc) { logger.warn(`cms ${m} update not found`, { traceId, id }); return res.status(404).json({ success: false, message: "Not found." }); }
      logger.info(`cms ${m} update success`, { traceId, id });
      return res.status(200).json({ success: true, data: doc });
    } catch (e: any) {
      if (e.issues) { logger.warn(`cms ${m} update validation failed`, { traceId, id, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
      logger.error(`cms ${m} update failed`, { traceId, id, error: getErrorMessage(e), stack: e.stack });
      return res.status(500).json({ success: false, message: e.message });
    }
  };

const genericDelete = (model: Model<any>) => async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const m = model.modelName;
  const id = req.params.id as string;
  logger.info(`cms ${m} delete invoked`, { traceId, path: req.originalUrl, id });

  try {
    if (!isObjectId(id)) { logger.warn(`cms ${m} delete invalid id`, { traceId, id }); return res.status(400).json({ success: false, message: "Invalid id." }); }
    const doc = await model.findByIdAndDelete(id);
    if (!doc) { logger.warn(`cms ${m} delete not found`, { traceId, id }); return res.status(404).json({ success: false, message: "Not found." }); }
    logger.info(`cms ${m} delete success`, { traceId, id });
    return res.status(200).json({ success: true, message: "Deleted." });
  } catch (e: any) {
    logger.error(`cms ${m} delete failed`, { traceId, id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─── FAQ ──
export const listFaqs = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  try {
    const data = await listFaqsService();
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("listFaqs failed", { traceId, error: getErrorMessage(e) });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const getFaq = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  try {
    if (isMysqlModule("faq")) {
      if (!parseFaqId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id." });
      }
    } else if (!isObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid id." });
    }
    const doc = await getFaqById(id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    logger.error("getFaq failed", { traceId, id, error: getErrorMessage(e) });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const createFaq = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  try {
    if (isMysqlModule("faq")) {
      const data = faqCreateSchemaMysql.parse(req.body);
      const doc = await createFaqService(data);
      return res.status(201).json({ success: true, data: doc });
    }
    const data = faqCreateSchema.parse(req.body);
    const doc = await createFaqService(data);
    return res.status(201).json({ success: true, data: doc });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const updateFaq = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  try {
    if (isMysqlModule("faq")) {
      if (!parseFaqId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id." });
      }
      const data = faqUpdateSchemaMysql.parse(req.body);
      const doc = await updateFaqService(id, data);
      if (!doc) return res.status(404).json({ success: false, message: "Not found." });
      return res.status(200).json({ success: true, data: doc });
    }
    if (!isObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid id." });
    }
    const data = faqUpdateSchema.parse(req.body);
    const doc = await updateFaqService(id, data);
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const deleteFaq = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  try {
    if (isMysqlModule("faq")) {
      if (!parseFaqId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id." });
      }
    } else if (!isObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid id." });
    }
    const ok = await deleteFaqService(id);
    if (!ok) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, message: "Deleted." });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─── FAQ Type ──
export const listFaqTypes = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  try {
    const data = await listFaqTypesService();
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("listFaqTypes failed", { traceId, error: getErrorMessage(e) });
    return res.status(500).json({ success: false, message: e.message });
  }
};
export const getFaqType = genericGet(FaqType);
export const createFaqType = genericCreate(FaqType, faqTypeCreateSchema);
export const updateFaqType = genericUpdate(FaqType, faqTypeUpdateSchema);

export const deleteFaqType = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("deleteFaqType invoked", { traceId, path: req.originalUrl, id });

  try {
    if (isMysqlModule("faq")) {
      return res.status(400).json({
        success: false,
        message:
          "FAQ categories are fixed (general, referral) on the legacy MySQL schema and cannot be deleted.",
      });
    }
    if (!isObjectId(id)) { logger.warn("deleteFaqType invalid id", { traceId, id }); return res.status(400).json({ success: false, message: "Invalid id." }); }
    const inUse = await isFaqTypeInUse(id);
    if (inUse) {
      logger.warn("deleteFaqType in use", { traceId, id });
      return res.status(409).json({
        success: false,
        message: "FAQ Type is in use by one or more FAQs and cannot be deleted.",
      });
    }
    const doc = await FaqType.findByIdAndDelete(id);
    if (!doc) { logger.warn("deleteFaqType not found", { traceId, id }); return res.status(404).json({ success: false, message: "Not found." }); }
    logger.info("deleteFaqType success", { traceId, id });
    return res.status(200).json({ success: true, message: "Deleted." });
  } catch (e: any) {
    logger.error("deleteFaqType failed", { traceId, id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Popup ──
const popupTransform = (d: any) => ({ ...d, promoExpireAt: new Date(d.promoExpireAt) });
export const listPopups = genericList(PopupNotification);
export const getPopup = genericGet(PopupNotification);
export const createPopup = genericCreate(PopupNotification, popupCreateSchema, popupTransform);
export const updatePopup = genericUpdate(PopupNotification, popupUpdateSchema, (d) =>
  d.promoExpireAt ? { ...d, promoExpireAt: new Date(d.promoExpireAt) } : d
);
export const deletePopup = genericDelete(PopupNotification);

// ─── Banner ──
const bannerTransform = (d: any) => {
  if (d.key) d.keyRef = BANNER_KEY_TO_MODEL[d.key as BannerKey];
  return d;
};

export const listBanners = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("listBanners invoked", { traceId, path: _req.originalUrl });

  try {
    const data = await BannerSlider.find()
      .sort({ orderBy: 1 })
      .populate("keyId")
      .lean();
    logger.info("listBanners success", { traceId, count: data.length });
    return res.status(200).json({ success: true, data });
  } catch (e: any) {
    logger.error("listBanners failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
export const getBanner = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("getBanner invoked", { traceId, path: req.originalUrl, id });

  try {
    if (!isObjectId(id)) { logger.warn("getBanner invalid id", { traceId, id }); return res.status(400).json({ success: false, message: "Invalid id." }); }
    const doc = await BannerSlider.findById(id).populate("keyId").lean();
    if (!doc) { logger.warn("getBanner not found", { traceId, id }); return res.status(404).json({ success: false, message: "Not found." }); }
    logger.info("getBanner success", { traceId, id });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    logger.error("getBanner failed", { traceId, id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
export const createBanner = genericCreate(BannerSlider, bannerCreateSchema, bannerTransform);
export const updateBanner = genericUpdate(BannerSlider, bannerUpdateSchema, bannerTransform);
export const deleteBanner = genericDelete(BannerSlider);

export const reorderBanners = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("reorderBanners invoked", { traceId, path: req.originalUrl });

  try {
    const { orders } = reorderSchema.parse(req.body);
    const ops = orders
      .filter((o) => isObjectId(o.id))
      .map((o) => ({
        updateOne: { filter: { _id: o.id }, update: { $set: { orderBy: o.orderBy } } },
      }));
    if (!ops.length) { logger.warn("reorderBanners no valid ids", { traceId }); return res.status(400).json({ success: false, message: "No valid ids." }); }
    await BannerSlider.bulkWrite(ops);
    logger.info("reorderBanners success", { traceId, count: ops.length });
    return res.status(200).json({ success: true, message: "Banner order updated." });
  } catch (e: any) {
    if (e.issues) { logger.warn("reorderBanners validation failed", { traceId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    logger.error("reorderBanners failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Live Banner ──
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
export const getLiveBanner = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("getLiveBanner invoked", { traceId, path: req.originalUrl, id });

  try {
    if (!isObjectId(id)) { logger.warn("getLiveBanner invalid id", { traceId, id }); return res.status(400).json({ success: false, message: "Invalid id." }); }
    const doc = await LiveBannerSlider.findById(id).populate("liveCourseId").lean();
    if (!doc) { logger.warn("getLiveBanner not found", { traceId, id }); return res.status(404).json({ success: false, message: "Not found." }); }
    logger.info("getLiveBanner success", { traceId, id });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    logger.error("getLiveBanner failed", { traceId, id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
export const createLiveBanner = genericCreate(LiveBannerSlider, liveBannerCreateSchema);
export const updateLiveBanner = genericUpdate(LiveBannerSlider, liveBannerUpdateSchema);
export const deleteLiveBanner = genericDelete(LiveBannerSlider);

export const reorderLiveBanners = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("reorderLiveBanners invoked", { traceId, path: req.originalUrl });

  try {
    const { orders } = reorderSchema.parse(req.body);
    const ops = orders
      .filter((o) => isObjectId(o.id))
      .map((o) => ({
        updateOne: { filter: { _id: o.id }, update: { $set: { orderBy: o.orderBy } } },
      }));
    if (!ops.length) { logger.warn("reorderLiveBanners no valid ids", { traceId }); return res.status(400).json({ success: false, message: "No valid ids." }); }
    await LiveBannerSlider.bulkWrite(ops);
    logger.info("reorderLiveBanners success", { traceId, count: ops.length });
    return res.status(200).json({ success: true, message: "Live banner order updated." });
  } catch (e: any) {
    if (e.issues) { logger.warn("reorderLiveBanners validation failed", { traceId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    logger.error("reorderLiveBanners failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Testimonial ──
export const listTestimonials = genericList(Testimonial);
export const getTestimonial = genericGet(Testimonial);
export const createTestimonial = genericCreate(Testimonial, testimonialCreateSchema);
export const updateTestimonial = genericUpdate(Testimonial, testimonialUpdateSchema);
export const deleteTestimonial = genericDelete(Testimonial);

// ─── Social Link Type ──
export const listSocialLinkTypes = genericList(SocialLinkType, { title: 1 });
export const getSocialLinkType = genericGet(SocialLinkType);
export const createSocialLinkType = genericCreate(SocialLinkType, socialLinkTypeCreateSchema);
export const updateSocialLinkType = genericUpdate(SocialLinkType, socialLinkTypeUpdateSchema);

export const deleteSocialLinkType = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const id = req.params.id as string;
  logger.info("deleteSocialLinkType invoked", { traceId, path: req.originalUrl, id });

  try {
    if (!isObjectId(id)) { logger.warn("deleteSocialLinkType invalid id", { traceId, id }); return res.status(400).json({ success: false, message: "Invalid id." }); }
    const inUse = await SocialLink.exists({ typeId: id });
    if (inUse) {
      logger.warn("deleteSocialLinkType in use", { traceId, id });
      return res.status(409).json({
        success: false,
        message: "Social Link Type is in use by one or more links and cannot be deleted.",
      });
    }
    const doc = await SocialLinkType.findByIdAndDelete(id);
    if (!doc) { logger.warn("deleteSocialLinkType not found", { traceId, id }); return res.status(404).json({ success: false, message: "Not found." }); }
    logger.info("deleteSocialLinkType success", { traceId, id });
    return res.status(200).json({ success: true, message: "Deleted." });
  } catch (e: any) {
    logger.error("deleteSocialLinkType failed", { traceId, id, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Social Link ──
export const listSocialLinks = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("listSocialLinks invoked", { traceId, path: _req.originalUrl });

  try {
    const data = await SocialLink.find()
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
export const getSocialLink = genericGet(SocialLink);
export const createSocialLink = genericCreate(SocialLink, socialLinkCreateSchema);
export const updateSocialLink = genericUpdate(SocialLink, socialLinkUpdateSchema);
export const deleteSocialLink = genericDelete(SocialLink);

// ─── Current Affairs ──
export const listCurrentAffairs = genericList(CurrentAffair, { createdAt: -1 });
export const getCurrentAffair = genericGet(CurrentAffair);
export const createCurrentAffair = genericCreate(CurrentAffair, currentAffairCreateSchema);
export const updateCurrentAffair = genericUpdate(CurrentAffair, currentAffairUpdateSchema);
export const deleteCurrentAffair = genericDelete(CurrentAffair);

// ─── Terms ──
export const listTerms = genericList(TermsAndConditions);
export const getTerms = genericGet(TermsAndConditions);
export const createTerms = genericCreate(TermsAndConditions, termsCreateSchema);
export const updateTerms = genericUpdate(TermsAndConditions, termsUpdateSchema);
export const deleteTerms = genericDelete(TermsAndConditions);

// ─── Version (singleton) ──
export const getVersion = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("getVersion invoked", { traceId, path: _req.originalUrl });

  try {
    const doc = await getVersionSettings();
    logger.info("getVersion success", { traceId });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    logger.error("getVersion failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const upsertVersion = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("upsertVersion invoked", { traceId, path: req.originalUrl });

  try {
    const data = versionUpsertSchema.parse(req.body);
    const doc = await upsertVersionSettings(data);
    logger.info("upsertVersion success", { traceId });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    if (e.issues) { logger.warn("upsertVersion validation failed", { traceId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    logger.error("upsertVersion failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─── AppUpdate (singleton) ──
export const getAppUpdate = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("getAppUpdate invoked", { traceId, path: _req.originalUrl });

  try {
    const doc = await getAppUpdateSettings();
    logger.info("getAppUpdate success", { traceId });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    logger.error("getAppUpdate failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const upsertAppUpdate = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("upsertAppUpdate invoked", { traceId, path: req.originalUrl });

  try {
    const data = appUpdateUpsertSchema.parse(req.body);
    const doc = await upsertAppUpdateSettings(data);
    logger.info("upsertAppUpdate success", { traceId });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    if (e.issues) { logger.warn("upsertAppUpdate validation failed", { traceId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    logger.error("upsertAppUpdate failed", { traceId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
