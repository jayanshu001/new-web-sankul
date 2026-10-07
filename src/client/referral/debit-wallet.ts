// Referral wallet: debits redeemed coins after a verified purchase.
import { debitWalletForOrderMysql } from "../../modules/referral/referral.service";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

interface DebitOpts {
  customerId: number | string;
  orderId: number | string;
  coin: number | null | undefined;
  source: "course" | "package" | "ebook" | "liveCourse" | "testSeries";
}

// Debits redeemed wallet coins from reward_points after a verified purchase.
// Idempotent on (source, orderId, customer), so a retried verify/webhook is a no-op.
// Never throws: the customer already paid, so a debit failure is logged and swallowed
// rather than blocking provisioning (the 50% cap at create-order bounds the loss).
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
