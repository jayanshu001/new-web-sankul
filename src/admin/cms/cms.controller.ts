import { Request, Response } from "express";
import mongoose, { Model } from "mongoose";
import { FAQ } from "../../models/system/FAQ.model";
import { PopupNotification } from "../../models/system/PopupNotification.model";
import { BannerSlider } from "../../models/system/BannerSlider.model";
import { Testimonial } from "../../models/system/Testimonial.model";
import { TermsAndConditions } from "../../models/system/TermsAndConditions.model";
import { Version } from "../../models/system/Version.model";
import { AppUpdate } from "../../models/system/AppUpdate.model";
import {
  faqCreateSchema,
  faqUpdateSchema,
  popupCreateSchema,
  popupUpdateSchema,
  bannerCreateSchema,
  bannerUpdateSchema,
  testimonialCreateSchema,
  testimonialUpdateSchema,
  termsCreateSchema,
  termsUpdateSchema,
  versionUpsertSchema,
  appUpdateUpsertSchema,
  reorderSchema,
} from "./cms.validation";

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

// Generic CRUD helpers — keeps each resource below to a thin wrapper.
const genericList = (model: Model<any>, sort: Record<string, 1 | -1> = { createdAt: -1 }) =>
  async (_req: Request, res: Response) => {
    try {
      const data = await model.find().sort(sort).lean();
      return res.status(200).json({ success: true, data });
    } catch (e: any) {
      return res.status(500).json({ success: false, message: e.message });
    }
  };

const genericGet = (model: Model<any>) => async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const doc = await model.findById(id).lean();
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

const genericCreate = (model: Model<any>, schema: any, transform?: (d: any) => any) =>
  async (req: Request, res: Response) => {
    try {
      const parsed = schema.parse(req.body);
      const payload = transform ? transform(parsed) : parsed;
      const doc = await model.create(payload);
      return res.status(201).json({ success: true, data: doc });
    } catch (e: any) {
      if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
      return res.status(500).json({ success: false, message: e.message });
    }
  };

const genericUpdate = (model: Model<any>, schema: any, transform?: (d: any) => any) =>
  async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });
      const parsed = schema.parse(req.body);
      const payload = transform ? transform(parsed) : parsed;
      const doc = await model.findByIdAndUpdate(id, { $set: payload }, { new: true });
      if (!doc) return res.status(404).json({ success: false, message: "Not found." });
      return res.status(200).json({ success: true, data: doc });
    } catch (e: any) {
      if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
      return res.status(500).json({ success: false, message: e.message });
    }
  };

const genericDelete = (model: Model<any>) => async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id." });
    const doc = await model.findByIdAndDelete(id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });
    return res.status(200).json({ success: true, message: "Deleted." });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─── FAQ ──
export const listFaqs = genericList(FAQ);
export const getFaq = genericGet(FAQ);
export const createFaq = genericCreate(FAQ, faqCreateSchema);
export const updateFaq = genericUpdate(FAQ, faqUpdateSchema);
export const deleteFaq = genericDelete(FAQ);

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
export const listBanners = genericList(BannerSlider, { orderBy: 1 });
export const getBanner = genericGet(BannerSlider);
export const createBanner = genericCreate(BannerSlider, bannerCreateSchema);
export const updateBanner = genericUpdate(BannerSlider, bannerUpdateSchema);
export const deleteBanner = genericDelete(BannerSlider);

export const reorderBanners = async (req: Request, res: Response) => {
  try {
    const { orders } = reorderSchema.parse(req.body);
    const ops = orders
      .filter((o) => isObjectId(o.id))
      .map((o) => ({
        updateOne: { filter: { _id: o.id }, update: { $set: { orderBy: o.orderBy } } },
      }));
    if (!ops.length) return res.status(400).json({ success: false, message: "No valid ids." });
    await BannerSlider.bulkWrite(ops);
    return res.status(200).json({ success: true, message: "Banner order updated." });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Testimonial ──
export const listTestimonials = genericList(Testimonial);
export const getTestimonial = genericGet(Testimonial);
export const createTestimonial = genericCreate(Testimonial, testimonialCreateSchema);
export const updateTestimonial = genericUpdate(Testimonial, testimonialUpdateSchema);
export const deleteTestimonial = genericDelete(Testimonial);

// ─── Terms ──
export const listTerms = genericList(TermsAndConditions);
export const getTerms = genericGet(TermsAndConditions);
export const createTerms = genericCreate(TermsAndConditions, termsCreateSchema);
export const updateTerms = genericUpdate(TermsAndConditions, termsUpdateSchema);
export const deleteTerms = genericDelete(TermsAndConditions);

// ─── Version (singleton) ──
export const getVersion = async (_req: Request, res: Response) => {
  try {
    const doc = (await Version.findOne().lean()) ||
      { latestVersionCode: 0, lastSupportedVersionCode: 0 };
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const upsertVersion = async (req: Request, res: Response) => {
  try {
    const data = versionUpsertSchema.parse(req.body);
    const doc = await Version.findOneAndUpdate(
      {},
      { $set: data },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─── AppUpdate (singleton) ──
export const getAppUpdate = async (_req: Request, res: Response) => {
  try {
    const doc = (await AppUpdate.findOne().lean()) ||
      { latestVersion: 0, updateType: "flexible", isUpdateAvailable: false };
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const upsertAppUpdate = async (req: Request, res: Response) => {
  try {
    const data = appUpdateUpsertSchema.parse(req.body);
    const doc = await AppUpdate.findOneAndUpdate(
      {},
      { $set: data },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    return res.status(200).json({ success: true, data: doc });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
    return res.status(500).json({ success: false, message: e.message });
  }
};
