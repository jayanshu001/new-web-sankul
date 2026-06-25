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
import { buildRegexCondition } from "../../utils/searchFilter";
import * as rcService from "../../modules/referral-content/referral-content.service";

const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

// Shared list-query parsing for content lists. Pagination is opt-in: when
// page/limit are present the response carries a `pagination` block; otherwise
// the flat array is returned (back-compat for callers that read `data` directly).
const parseListQuery = (req: Request) => {
  const { search, sortBy, sortOrder, page, limit } = req.query as Record<string, string>;
  const paginate = page !== undefined || limit !== undefined;
  const pageNum = Math.max(parseInt(page ?? "1", 10) || 1, 1);
  const limitNum = Math.max(parseInt(limit ?? "20", 10) || 20, 1);
  const sortDir: "asc" | "desc" = sortOrder === "desc" ? "desc" : "asc";
  return { search, sortBy, sortDir, paginate, pageNum, limitNum };
};
// Mongo sort field for content lists (SQL col `orderBy` ↔ Mongo `order`).
// Default (no sortBy) is recently-added on top; explicit sortBy is honored.
const mongoContentSort = (sortBy: string | undefined, sortDir: "asc" | "desc"): Record<string, 1 | -1> => {
  const d: 1 | -1 = sortDir === "desc" ? -1 : 1;
  switch (sortBy) {
    case "order": return { order: d, _id: -1 };
    case "createdAt": return { createdAt: d, _id: -1 };
    case "updatedAt": return { updatedAt: d, _id: -1 };
    default: return { createdAt: -1, _id: -1 };
  }
};

// ─── Terms ───────────────────────────────────────────────────────────────────

export const listTerms = async (req: Request, res: Response) => {
  try {
    const { search, sortBy, sortDir, paginate, pageNum, limitNum } = parseListQuery(req);

    if (rcService.isReferralContentMysql()) {
      const { data, total } = await rcService.listTerms({
        search, sortBy, sortDir,
        ...(paginate ? { skip: (pageNum - 1) * limitNum, take: limitNum } : {}),
      });
      return res.status(200).json(
        paginate
          ? { success: true, data, pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } }
          : { success: true, data }
      );
    }

    const filter: any = {};
    { const c = buildRegexCondition(search); if (c) filter.text = c; }
    const sortSpec = mongoContentSort(sortBy, sortDir);
    if (!paginate) {
      const data = await ReferralTerm.find(filter).sort(sortSpec);
      return res.status(200).json({ success: true, data });
    }
    const [data, total] = await Promise.all([
      ReferralTerm.find(filter).sort(sortSpec).skip((pageNum - 1) * limitNum).limit(limitNum),
      ReferralTerm.countDocuments(filter),
    ]);
    return res.status(200).json({ success: true, data, pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getTerm = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (rcService.isReferralContentMysql()) {
      const numId = rcService.parseRcId(id);
      if (!numId)
        return res.status(400).json({ success: false, message: "Invalid term id." });
      const term = await rcService.getTerm(numId);
      if (!term) return res.status(404).json({ success: false, message: "Term not found." });
      return res.status(200).json({ success: true, data: term });
    }
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
    if (rcService.isReferralContentMysql()) {
      const term = await rcService.createTerm(data);
      return res.status(201).json({ success: true, data: term });
    }
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
    if (rcService.isReferralContentMysql()) {
      const numId = rcService.parseRcId(id);
      if (!numId)
        return res.status(400).json({ success: false, message: "Invalid term id." });
      const data = updateTermSchema.parse(req.body);
      const term = await rcService.updateTerm(numId, data);
      if (!term) return res.status(404).json({ success: false, message: "Term not found." });
      return res.status(200).json({ success: true, data: term });
    }
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
    if (rcService.isReferralContentMysql()) {
      const numId = rcService.parseRcId(id);
      if (!numId)
        return res.status(400).json({ success: false, message: "Invalid term id." });
      const ok = await rcService.deleteTerm(numId);
      if (!ok) return res.status(404).json({ success: false, message: "Term not found." });
      return res.status(200).json({ success: true, message: "Term deleted." });
    }
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

export const listFaqs = async (req: Request, res: Response) => {
  try {
    const { search, sortBy, sortDir, paginate, pageNum, limitNum } = parseListQuery(req);

    if (rcService.isReferralContentMysql()) {
      const { data, total } = await rcService.listFaqs({
        search, sortBy, sortDir,
        ...(paginate ? { skip: (pageNum - 1) * limitNum, take: limitNum } : {}),
      });
      return res.status(200).json(
        paginate
          ? { success: true, data, pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } }
          : { success: true, data }
      );
    }

    const filter: any = {};
    { const c = buildRegexCondition(search); if (c) filter.$or = [{ question: c }, { answer: c }]; }
    const sortSpec = mongoContentSort(sortBy, sortDir);
    if (!paginate) {
      const data = await ReferralFaq.find(filter).sort(sortSpec);
      return res.status(200).json({ success: true, data });
    }
    const [data, total] = await Promise.all([
      ReferralFaq.find(filter).sort(sortSpec).skip((pageNum - 1) * limitNum).limit(limitNum),
      ReferralFaq.countDocuments(filter),
    ]);
    return res.status(200).json({ success: true, data, pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getFaq = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (rcService.isReferralContentMysql()) {
      const numId = rcService.parseRcId(id);
      if (!numId)
        return res.status(400).json({ success: false, message: "Invalid faq id." });
      const faq = await rcService.getFaq(numId);
      if (!faq) return res.status(404).json({ success: false, message: "FAQ not found." });
      return res.status(200).json({ success: true, data: faq });
    }
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
    if (rcService.isReferralContentMysql()) {
      const faq = await rcService.createFaq(data);
      return res.status(201).json({ success: true, data: faq });
    }
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
    if (rcService.isReferralContentMysql()) {
      const numId = rcService.parseRcId(id);
      if (!numId)
        return res.status(400).json({ success: false, message: "Invalid faq id." });
      const data = updateFaqSchema.parse(req.body);
      const faq = await rcService.updateFaq(numId, data);
      if (!faq) return res.status(404).json({ success: false, message: "FAQ not found." });
      return res.status(200).json({ success: true, data: faq });
    }
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
    if (rcService.isReferralContentMysql()) {
      const numId = rcService.parseRcId(id);
      if (!numId)
        return res.status(400).json({ success: false, message: "Invalid faq id." });
      const ok = await rcService.deleteFaq(numId);
      if (!ok) return res.status(404).json({ success: false, message: "FAQ not found." });
      return res.status(200).json({ success: true, message: "FAQ deleted." });
    }
    if (!isObjectId(id))
      return res.status(400).json({ success: false, message: "Invalid faq id." });
    const faq = await ReferralFaq.findByIdAndDelete(id);
    if (!faq) return res.status(404).json({ success: false, message: "FAQ not found." });
    return res.status(200).json({ success: true, message: "FAQ deleted." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
