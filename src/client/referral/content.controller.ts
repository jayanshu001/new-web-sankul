// Client referral: Refer & Earn status, terms and FAQ handlers.
import { Request, Response } from "express";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { getReferralStatus as svcReferralStatus } from "../../modules/referral/referral.service";
import * as rcService from "../../modules/referral-content/referral-content.service";
import { omit, omitList } from "../../utils/pick";

// Enabled iff a program named "student" exists with status=true.
export const getReferralStatus = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("getReferralStatus invoked", { traceId, path: _req.originalUrl });

  try {
    const data = await svcReferralStatus();
    logger.info("getReferralStatus success (sql)", { traceId, enabled: data.enabled });
    // The app only gates on `enabled`.
    return res.status(200).json({
      success: true,
      data: omit(data, ["referralDiscount", "referralReward", "minimumPrice"]),
    });
  } catch (error: any) {
    logger.error("getReferralStatus failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getTerms = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("getTerms invoked", { traceId, path: _req.originalUrl });

  try {
    const data = await rcService.listActiveTermsForClient();
    logger.info("getTerms success (sql)", { traceId, count: data.length });
    return res.status(200).json({ success: true, data: omitList(data, ["order"]) });
  } catch (error: any) {
    logger.error("getTerms failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getFaqs = async (_req: Request, res: Response) => {
  const traceId = _req.traceId;
  logger.info("getFaqs invoked", { traceId, path: _req.originalUrl });

  try {
    const data = await rcService.listActiveFaqsForClient();
    logger.info("getFaqs success (sql)", { traceId, count: data.length });
    return res.status(200).json({ success: true, data: omitList(data, ["order"]) });
  } catch (error: any) {
    logger.error("getFaqs failed", { traceId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};
