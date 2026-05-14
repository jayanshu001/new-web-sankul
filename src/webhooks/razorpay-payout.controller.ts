import { Request, Response } from "express";
import crypto from "crypto";
import mongoose from "mongoose";
import { Customer } from "../models/customer/Customer.model";
import { ReferralTransaction } from "../models/referral/ReferralTransaction.model";
import { RefferalTransactionStatus, RefferalTransactionType } from "../models/enums";

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
    const utr: string | undefined = payout.utr ?? payout.reference_id ?? undefined;
    const failureReason: string | undefined =
      payout.failure_reason ?? payout.status_details?.description ?? undefined;

    const transaction = await ReferralTransaction.findOne({ providerRef });
    if (!transaction) {
      return res.status(200).json({ success: true, ignored: true, reason: "Unknown payout id." });
    }

    // Idempotency: don't reprocess a terminal transaction.
    if (transaction.status !== RefferalTransactionStatus.PENDING) {
      return res.status(200).json({ success: true, alreadyProcessed: true });
    }

    if (newStatus === RefferalTransactionStatus.SUCCESSFUL) {
      transaction.status = RefferalTransactionStatus.SUCCESSFUL;
      if (utr) transaction.utr = utr;
      transaction.providerPayload = payout;
      await transaction.save();
      return res.status(200).json({ success: true });
    }

    // Failed/reversed/rejected: refund the customer's wallet inside a session.
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        if (transaction.type === RefferalTransactionType.DEBIT) {
          await Customer.updateOne(
            { _id: transaction.customerId },
            { $inc: { rewardPoints: transaction.coin } },
            { session }
          );
        }
        transaction.status = RefferalTransactionStatus.FAILED;
        transaction.failureReason = failureReason ?? "Payout failed.";
        transaction.providerPayload = payout;
        await transaction.save({ session });
      });
    } finally {
      session.endSession();
    }

    return res.status(200).json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
