import { Request, Response } from "express";
import mongoose from "mongoose";
import { ReferralTerm } from "../../models/referral/ReferralTerm.model";
import { ReferralFaq } from "../../models/referral/ReferralFaq.model";
import {
  createTermSchema,
  updateTermSchema,
  createFaqSchema,
  updateFaqSchema,
} from "./content.validation";

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

// ─── Terms ───────────────────────────────────────────────────────────────────

export const listTerms = async (_req: Request, res: Response) => {
  try {
    const data = await ReferralTerm.find().sort({ order: 1, createdAt: 1 });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getTerm = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid term id." });
    const term = await ReferralTerm.findById(id);
    if (!term) return res.status(404).json({ success: false, message: "Term not found." });
    return res.status(200).json({ success: true, data: term });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createTerm = async (req: Request, res: Response) => {
  try {
    const data = createTermSchema.parse(req.body);
    const term = await ReferralTerm.create(data);
    return res.status(201).json({ success: true, data: term });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateTerm = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid term id." });
    const data = updateTermSchema.parse(req.body);
    const term = await ReferralTerm.findByIdAndUpdate(
      id,
      { $set: data },
      { new: true }
    );
    if (!term) return res.status(404).json({ success: false, message: "Term not found." });
    return res.status(200).json({ success: true, data: term });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteTerm = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid term id." });
    const term = await ReferralTerm.findByIdAndDelete(id);
    if (!term) return res.status(404).json({ success: false, message: "Term not found." });
    return res.status(200).json({ success: true, message: "Term deleted." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── FAQs ────────────────────────────────────────────────────────────────────

export const listFaqs = async (_req: Request, res: Response) => {
  try {
    const data = await ReferralFaq.find().sort({ order: 1, createdAt: 1 });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getFaq = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid faq id." });
    const faq = await ReferralFaq.findById(id);
    if (!faq) return res.status(404).json({ success: false, message: "FAQ not found." });
    return res.status(200).json({ success: true, data: faq });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createFaq = async (req: Request, res: Response) => {
  try {
    const data = createFaqSchema.parse(req.body);
    const faq = await ReferralFaq.create(data);
    return res.status(201).json({ success: true, data: faq });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateFaq = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid faq id." });
    const data = updateFaqSchema.parse(req.body);
    const faq = await ReferralFaq.findByIdAndUpdate(id, { $set: data }, { new: true });
    if (!faq) return res.status(404).json({ success: false, message: "FAQ not found." });
    return res.status(200).json({ success: true, data: faq });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteFaq = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid faq id." });
    const faq = await ReferralFaq.findByIdAndDelete(id);
    if (!faq) return res.status(404).json({ success: false, message: "FAQ not found." });
    return res.status(200).json({ success: true, message: "FAQ deleted." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
