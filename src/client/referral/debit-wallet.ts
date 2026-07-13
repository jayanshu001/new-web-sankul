import { debitWalletForOrderMysql } from "../../modules/referral/referral.service";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

interface DebitOpts {
  customerId: number | string;
  orderId: number | string;
  coin: number | null | undefined;
  source: "course" | "package" | "ebook" | "liveCourse" | "testSeries";
}

// Debits redeemed wallet coins from the buyer's reward_points after a verified
// purchase. Idempotent on (source, orderId, customer) — a retried verify/webhook
// is a no-op.
//
// NEVER THROWS: like creditReferrer, wallet debit is a post-payment side effect.
// The customer already paid the reduced amount, so provisioning must never be
// blocked by a debit failure — errors are logged and swallowed. (The 50% cap at
// create-order guarantees the customer still paid the majority in cash.)
export async function debitWallet(opts: DebitOpts): Promise<void> {
  const { customerId, orderId, coin, source } = opts;
  const c = Number(coin);
  if (!c || c <= 0) return;
  const cid = Number(customerId);
  const oid = Number(orderId);
  if (!Number.isInteger(cid) || cid <= 0 || !Number.isInteger(oid) || oid <= 0) return;
  try {
    await debitWalletForOrderMysql({ customerId: cid, source, orderId: oid, coin: c });
  } catch (error: any) {
    logger.error("debitWallet failed (non-fatal)", {
      customerId: cid,
      orderId: oid,
      source,
      coin: c,
      error: getErrorMessage(error),
      stack: error?.stack,
    });
  }
}
