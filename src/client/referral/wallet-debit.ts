import mongoose, { Types } from "mongoose";
import { Customer } from "../../models/customer/Customer.model";
import { ReferralTransaction } from "../../models/referral/ReferralTransaction.model";
import { RefferalTransactionType, RefferalTransactionStatus } from "../../models/enums";
import logger from "../../utils/logger";

// Wallet ("coin" / rewardPoints) usage in the payment flow.
//
//   - validateCoin: called at create-order. Confirms the requested coin amount
//     is a valid integer within [0, min(floor(planPrice/2), balance)]. Returns
//     the sanitised coin to apply, or an error message for a 400.
//   - applyWalletDebit: called at verify, AFTER payment succeeds. Atomically
//     deducts the coin from rewardPoints and writes a debit ledger row.
//     Idempotent on orderId (safe under webhook/reverify retries) and
//     deduct-what's-available (the user already paid the reduced amount via
//     Razorpay, so provisioning must never fail over a wallet shortfall).
//
// Mirrors credit-referrer.ts for the credit side.

export const WALLET_CAP_RATIO = 0.5; // wallet can cover at most 50% of plan price

export type WalletSource = "course" | "package" | "ebook" | "liveCourse" | "testSeries";

/**
 * Validate a requested coin amount against the 50%-of-plan-price cap and the
 * customer's current balance. `coin` omitted / 0 means wallet not used.
 * Returns `{ coin }` (the amount to actually apply) or `{ error }` (→ HTTP 400).
 */
export async function validateCoin(
  customerId: Types.ObjectId | string,
  planPrice: number,
  coinRaw: number | undefined
): Promise<{ coin: number } | { error: string }> {
  const coin = Number(coinRaw ?? 0);
  if (!Number.isFinite(coin) || !Number.isInteger(coin) || coin < 0) {
    return { error: "Invalid wallet amount" };
  }
  if (coin === 0) return { coin: 0 };

  const customer = await Customer.findById(customerId).select("rewardPoints").lean();
  const balance = Number(customer?.rewardPoints ?? 0);
  if (coin > balance) {
    return { error: "Insufficient wallet balance" };
  }

  const cap = Math.floor(Number(planPrice) * WALLET_CAP_RATIO);
  if (coin > cap) {
    return { error: "Wallet usage cannot exceed 50% of the plan price" };
  }

  return { coin };
}

/**
 * Deduct `coin` from the customer's rewardPoints and record a debit transaction.
 * Idempotent on (orderId, customerId, debit): a second call for the same order
 * is a no-op. Deduct-what's-available: if the balance dropped below `coin`
 * since create-order, we debit min(coin, balance) and log the shortfall — never
 * throw, since the customer already paid the reduced amount.
 */
export async function applyWalletDebit(opts: {
  customerId: Types.ObjectId | string;
  orderId: Types.ObjectId | string;
  coin: number;
  source: WalletSource;
  traceId?: string;
}): Promise<void> {
  const { customerId, orderId, coin, source, traceId } = opts;
  if (!customerId || !orderId || !(coin > 0)) return;

  // Idempotency: already debited for this order?
  const existing = await ReferralTransaction.exists({
    orderId,
    customerId,
    type: RefferalTransactionType.DEBIT,
  });
  if (existing) return;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const dup = await ReferralTransaction.exists({
        orderId,
        customerId,
        type: RefferalTransactionType.DEBIT,
      }).session(session);
      if (dup) return;

      const customer = await Customer.findById(customerId).select("rewardPoints").session(session);
      const balance = Number(customer?.rewardPoints ?? 0);
      // Deduct what's available — never go negative, never block provisioning.
      const debit = Math.min(coin, balance);
      if (debit < coin) {
        logger.warn("applyWalletDebit balance shortfall; debiting available", {
          traceId,
          customerId: String(customerId),
          orderId: String(orderId),
          requested: coin,
          available: balance,
          debited: debit,
        });
      }
      if (debit <= 0) return;

      await Customer.updateOne(
        { _id: customerId },
        { $inc: { rewardPoints: -debit } },
        { session }
      );
      await ReferralTransaction.create(
        [
          {
            orderId,
            customerId,
            description: `Wallet used in payment — ${source} purchase`,
            coin: debit,
            type: RefferalTransactionType.DEBIT,
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
