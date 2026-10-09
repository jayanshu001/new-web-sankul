// Referral rewards: credits the referrer after a verified purchase.
import { creditReferrerMysql } from "./referral.service";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

interface CreditOpts {
  referrerId: number | string | null | undefined;
  buyerId: number | string;
  orderId: number | string;
  paidAmount: number;
  source: "course" | "package" | "ebook" | "liveCourse" | "testSeries";
}

// Credits the referrer `ReferralProgram.referralReward` % of paidAmount. Idempotent
// on (source, orderId, referrer) so payment verify can be retried safely.
// Never throws: a failed credit is logged and swallowed so it can't block fulfillment.
export async function creditReferrer(opts: CreditOpts): Promise<void> {
  const { referrerId, buyerId, orderId, paidAmount, source } = opts;
  if (!referrerId || !orderId || paidAmount <= 0) return;
  if (String(referrerId) === String(buyerId)) return;

  const rid = Number(referrerId);
  const oid = Number(orderId);
  const bid = Number(buyerId);
  if (!Number.isInteger(rid) || rid <= 0 || !Number.isInteger(oid) || oid <= 0) return;
  try {
    await creditReferrerMysql({
      referrerId: rid,
      buyerId: Number.isInteger(bid) ? bid : 0,
      orderId: oid,
      paidAmount,
      source,
    });
  } catch (error: any) {
    logger.error("creditReferrer failed (non-fatal)", {
      referrerId: rid,
      orderId: oid,
      source,
      error: getErrorMessage(error),
      stack: error?.stack,
    });
  }
}
