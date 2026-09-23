import { Request, Response } from "express";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { getReferralStatus as svcReferralStatus } from "../../modules/referral/referral.service";
import * as rcService from "../../modules/referral-content/referral-content.service";
import { omit, omitList } from "../../utils/pick";

// GET /api/v1/client/referral/status
// Tells the app whether to show the Refer & Earn module at all.
// Enabled iff a program named "student" exists AND has status=true.
export const getReferralStatus = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("getReferralStatus invoked", { traceId, path: _req.originalUrl });

  try {
    const data = await svcReferralStatus();
    logger.info("getReferralStatus success (sql)", { traceId, enabled: data.enabled });
    // App only gates on `enabled` (see docs/api-optimization/GET_client_referral_status.md).
    return res.status(200).json({
      success: true,
      data: omit(data, ["referralDiscount", "referralReward", "minimumPrice"]),
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
    const data = await rcService.listActiveTermsForClient();
    logger.info("getTerms success (sql)", { traceId, count: data.length });
    // Terms sheet renders _id/text only (see docs/api-optimization).
    return res.status(200).json({ success: true, data: omitList(data, ["order"]) });
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
    const data = await rcService.listActiveFaqsForClient();
    logger.info("getFaqs success (sql)", { traceId, count: data.length });
    // FAQ sheet renders _id/question/answer only (see docs/api-optimization).
    return res.status(200).json({ success: true, data: omitList(data, ["order"]) });
  } catch (error: any) {
    logger.error("getFaqs failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};
