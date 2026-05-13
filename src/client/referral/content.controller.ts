import { Request, Response } from "express";
import { ReferralTerm } from "../../models/referral/ReferralTerm.model";
import { ReferralFaq } from "../../models/referral/ReferralFaq.model";

// GET /api/v1/client/referral/terms
// Active Refer & Earn terms, ordered for display.
export const getTerms = async (_req: Request, res: Response) => {
  try {
    const data = await ReferralTerm.find({ status: true })
      .sort({ order: 1, createdAt: 1 })
      .select("_id text order")
      .lean();
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/referral/faqs
// Active Refer & Earn FAQs (Q&A), ordered for display.
export const getFaqs = async (_req: Request, res: Response) => {
  try {
    const data = await ReferralFaq.find({ status: true })
      .sort({ order: 1, createdAt: 1 })
      .select("_id question answer order")
      .lean();
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
