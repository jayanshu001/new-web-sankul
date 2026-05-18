import mongoose, { Types } from "mongoose";
import { Customer } from "../../models/customer/Customer.model";
import { ReferralProgram } from "../../models/referral/ReferralProgram.model";
import { ReferralTransaction } from "../../models/referral/ReferralTransaction.model";
import { RefferalTransactionType, RefferalTransactionStatus } from "../../models/enums";

interface CreditOpts {
  referrerId: Types.ObjectId | string;
  buyerId: Types.ObjectId | string;
  orderId: Types.ObjectId | string;
  paidAmount: number;
  source: "course" | "package" | "ebook";
}

// Credits the referrer with `ReferralProgram.referralReward` % of paidAmount.
// Idempotent on orderId — a second call for the same order is a no-op so the
// payment-verify path can be retried safely (Razorpay webhooks, manual reverify, etc.).
export async function creditReferrer(opts: CreditOpts): Promise<void> {
  const { referrerId, buyerId, orderId, paidAmount, source } = opts;
  if (!referrerId || !orderId || paidAmount <= 0) return;
  if (String(referrerId) === String(buyerId)) return;

  const program = await ReferralProgram.findOne({ name: "student", status: true })
    .select("referralReward")
    .lean();
  const pct = program?.referralReward ?? 0;
  if (pct <= 0) return;

  const coin = Math.round((paidAmount * pct) / 100);
  if (coin <= 0) return;

  const existing = await ReferralTransaction.exists({
    orderId,
    customerId: referrerId,
    type: RefferalTransactionType.CREDIT,
  });
  if (existing) return;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const dup = await ReferralTransaction.exists({
        orderId,
        customerId: referrerId,
        type: RefferalTransactionType.CREDIT,
      }).session(session);
      if (dup) return;

      await Customer.updateOne(
        { _id: referrerId },
        { $inc: { rewardPoints: coin } },
        { session }
      );
      await ReferralTransaction.create(
        [
          {
            orderId,
            customerId: referrerId,
            description: `Referral reward (${pct}%) — ${source} purchase`,
            coin,
            type: RefferalTransactionType.CREDIT,
            status: RefferalTransactionStatus.SUCCESSFUL,
          },
        ],
        { session }
      );
    });
  } finally {
    session.endSession();
  }
}
