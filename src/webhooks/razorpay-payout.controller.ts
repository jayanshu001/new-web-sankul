import { Request, Response } from "express";
import crypto from "crypto";
import { RefferalTransactionStatus } from "../shared/enums";
import { applyPayoutWebhook } from "../modules/referral/referral.service";
import logger from "../utils/logger";
import { getErrorMessage } from "../utils/httpResponse";

const WEBHOOK_SECRET = process.env.RAZORPAY_PAYOUT_WEBHOOK_SECRET ?? "";

// Razorpay payout event names -> internal status
const EVENT_TO_STATUS: Record<string, RefferalTransactionStatus | undefined> = {
  "payout.processed": RefferalTransactionStatus.SUCCESSFUL,
  "payout.reversed": RefferalTransactionStatus.FAILED,
  "payout.failed": RefferalTransactionStatus.FAILED,
  "payout.rejected": RefferalTransactionStatus.FAILED,
};

export const razorpayPayoutWebhook = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const event = req.body?.event as string | undefined;
  logger.info("razorpayPayoutWebhook invoked", { traceId, event });
  try {
    if (!WEBHOOK_SECRET) {
      logger.error("razorpayPayoutWebhook secret not configured", { traceId });
      return res.status(500).json({ success: false, message: "Webhook secret not configured." });
    }

    const signature = req.header("x-razorpay-signature") ?? "";
    const rawBody = (req as any).rawBody as Buffer | undefined;
    if (!rawBody) {
      logger.warn("razorpayPayoutWebhook missing raw body", { traceId, event });
      return res.status(400).json({ success: false, message: "Missing raw body." });
    }

    const expected = crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
    const sigBuf = Buffer.from(signature, "utf8");
    const expBuf = Buffer.from(expected, "utf8");
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      logger.warn("razorpayPayoutWebhook signature mismatch", { traceId, event });
      return res.status(401).json({ success: false, message: "Invalid signature." });
    }

    const payout = req.body?.payload?.payout?.entity;
    const newStatus = event ? EVENT_TO_STATUS[event] : undefined;
    const providerRef: string | undefined = payout?.id;

    // Acknowledge unrelated events so Razorpay stops retrying.
    if (!event || !newStatus || !providerRef) {
      logger.info("razorpayPayoutWebhook ignored event", { traceId, event, providerRef });
      return res.status(200).json({ success: true, ignored: true });
    }

    const failureReason: string | undefined =
      payout.failure_reason ?? payout.status_details?.description ?? undefined;
    const nextStatus = newStatus === RefferalTransactionStatus.SUCCESSFUL ? "successful" : "failed";

    // ─── ws_refferal_transaction ─────────────────────────────────────────
    const result = await applyPayoutWebhook(providerRef, nextStatus, failureReason);
    if (result === "unknown") {
      logger.warn("razorpayPayoutWebhook unknown payout id", { traceId, event, providerRef });
      return res.status(200).json({ success: true, ignored: true, reason: "Unknown payout id." });
    }
    if (result === "already") {
      logger.info("razorpayPayoutWebhook already processed", { traceId, event, providerRef });
      return res.status(200).json({ success: true, alreadyProcessed: true });
    }
    logger.info("razorpayPayoutWebhook applied", { traceId, event, providerRef, status: nextStatus });
    return res.status(200).json({ success: true });
  } catch (error) {
    // Log the real error server-side; return a generic message to the caller.
    logger.error("razorpayPayoutWebhook failed", { traceId, event, error: getErrorMessage(error), stack: (error as Error).stack });
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
};
