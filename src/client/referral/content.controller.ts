import { Request, Response } from "express";
import { ReferralTerm } from "../../models/referral/ReferralTerm.model";
import { ReferralFaq } from "../../models/referral/ReferralFaq.model";
import { ReferralProgram } from "../../models/referral/ReferralProgram.model";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

// GET /api/v1/client/referral/status
// Tells the app whether to show the Refer & Earn module at all.
// Enabled iff a program named "student" exists AND has status=true.
export const getReferralStatus = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("getReferralStatus invoked", { traceId, path: _req.originalUrl });

  try {
    const program = await ReferralProgram.findOne({ name: "student", status: true })
      .select("_id referralDiscount referralReward minimumPrice")
      .lean();
    logger.info("getReferralStatus success", { traceId, enabled: !!program });
    return res.status(200).json({
      success: true,
      data: {
        enabled: Boolean(program),
        referralDiscount: program?.referralDiscount ?? 0,
        referralReward: program?.referralReward ?? 0,
        minimumPrice: program?.minimumPrice ?? 0,
      },
    });
  } catch (error: any) {
    logger.error("getReferralStatus failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/referral/terms
// Active Refer & Earn terms, ordered for display.
export const getTerms = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("getTerms invoked", { traceId, path: _req.originalUrl });

  try {
    const data = await ReferralTerm.find({ status: true })
      .sort({ order: 1, createdAt: 1 })
      .select("_id text order")
      .lean();
    logger.info("getTerms success", { traceId, count: data.length });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    logger.error("getTerms failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/client/referral/faqs
// Active Refer & Earn FAQs (Q&A), ordered for display.
export const getFaqs = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("getFaqs invoked", { traceId, path: _req.originalUrl });

  try {
    const data = await ReferralFaq.find({ status: true })
      .sort({ order: 1, createdAt: 1 })
      .select("_id question answer order")
      .lean();
    logger.info("getFaqs success", { traceId, count: data.length });
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    logger.error("getFaqs failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};
