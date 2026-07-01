import { Request, Response } from "express";
import crypto from "crypto";
import { RefferalTransactionStatus } from "../shared/enums";
import { applyPayoutWebhook } from "../modules/referral/referral.service";

const WEBHOOK_SECRET = process.env.RAZORPAY_PAYOUT_WEBHOOK_SECRET ?? "";

// Razorpay payout event names -> internal status
const EVENT_TO_STATUS: Record<string, RefferalTransactionStatus | undefined> = {
  "payout.processed": RefferalTransactionStatus.SUCCESSFUL,
  "payout.reversed": RefferalTransactionStatus.FAILED,
  "payout.failed": RefferalTransactionStatus.FAILED,
  "payout.rejected": RefferalTransactionStatus.FAILED,
};

export const razorpayPayoutWebhook = async (req: Request, res: Response) => {
  try {
    if (!WEBHOOK_SECRET) {
      return res.status(500).json({ success: false, message: "Webhook secret not configured." });
    }

    const signature = req.header("x-razorpay-signature") ?? "";
    const rawBody = (req as any).rawBody as Buffer | undefined;
    if (!rawBody) {
      return res.status(400).json({ success: false, message: "Missing raw body." });
    }

    const expected = crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
    const sigBuf = Buffer.from(signature, "utf8");
    const expBuf = Buffer.from(expected, "utf8");
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return res.status(401).json({ success: false, message: "Invalid signature." });
    }

    const event = req.body?.event as string | undefined;
    const payout = req.body?.payload?.payout?.entity;
    const newStatus = event ? EVENT_TO_STATUS[event] : undefined;

    // Acknowledge unrelated events so Razorpay stops retrying.
    if (!event || !newStatus || !payout?.id) {
      return res.status(200).json({ success: true, ignored: true });
    }

    const providerRef: string = payout.id;
    const failureReason: string | undefined =
      payout.failure_reason ?? payout.status_details?.description ?? undefined;

    // ─── ws_refferal_transaction ─────────────────────────────────────────
    const result = await applyPayoutWebhook(
      providerRef,
      newStatus === RefferalTransactionStatus.SUCCESSFUL ? "successful" : "failed",
      failureReason
    );
    if (result === "unknown") return res.status(200).json({ success: true, ignored: true, reason: "Unknown payout id." });
    if (result === "already") return res.status(200).json({ success: true, alreadyProcessed: true });
    return res.status(200).json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
