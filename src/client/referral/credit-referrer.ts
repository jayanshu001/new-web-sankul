import { Types } from "mongoose";
import { creditReferrerMysql } from "../../modules/referral/referral.service";

interface CreditOpts {
  referrerId: Types.ObjectId | string;
  buyerId: Types.ObjectId | string;
  orderId: Types.ObjectId | string;
  paidAmount: number;
  source: "course" | "package" | "ebook" | "liveCourse" | "testSeries";
}

// Credits the referrer with `ReferralProgram.referralReward` % of paidAmount.
// Idempotent on orderId — a second call for the same order is a no-op so the
// payment-verify path can be retried safely (Razorpay webhooks, manual reverify, etc.).
export async function creditReferrer(opts: CreditOpts): Promise<void> {
  const { referrerId, buyerId, orderId, paidAmount, source } = opts;
  if (!referrerId || !orderId || paidAmount <= 0) return;
  if (String(referrerId) === String(buyerId)) return;

  // SQL int id-space: the payment-verify path passes int ids.
  const rid = Number(referrerId);
  const oid = Number(orderId);
  const bid = Number(buyerId);
  if (!Number.isInteger(rid) || rid <= 0 || !Number.isInteger(oid) || oid <= 0) return;
  return creditReferrerMysql({
    referrerId: rid,
    buyerId: Number.isInteger(bid) ? bid : 0,
    orderId: oid,
    paidAmount,
    source,
  });
}
