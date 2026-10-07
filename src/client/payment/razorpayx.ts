// RazorpayX payouts: HTTP client; the `razorpay` SDK only covers Payments, so the
// X API is called over HTTP with Basic Auth.
//
// Dormant: no callers since reward withdrawals became manual bank transfers. Kept as
// the counterpart to the drain-only payout webhook in app.ts; delete both together.
// RAZORPAYX_ACCOUNT_NUMBER is not in config/env.ts and must be added before re-enabling.

import { callOutbound } from "../../libs/outbound";

const X_BASE_URL = "https://api.razorpay.com/v1";

const auth = () => {
  const id = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) throw new Error("Razorpay credentials are not configured.");
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
};

const accountNumber = () => {
  const acc = process.env.RAZORPAYX_ACCOUNT_NUMBER;
  if (!acc) throw new Error("RAZORPAYX_ACCOUNT_NUMBER is not configured.");
  return acc;
};

async function xPost<T>(path: string, body: unknown): Promise<T> {
  // 6s per attempt, 3 attempts on network/5xx/429. Retries are safe because payouts
  // pass `reference_id`. The label is path-scoped so a payout outage doesn't open the
  // breaker on contact creation.
  return callOutbound(
    async () => {
      const res = await fetch(`${X_BASE_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth() },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) {
        const err: any = new Error(
          data?.error?.description || `RazorpayX ${path} failed with ${res.status}.`
        );
        err.status = res.status; // lets the wrapper's retry predicate see HTTP status
        throw err;
      }
      return data as T;
    },
    { label: `razorpayx${path}`, timeoutMs: 6_000, attempts: 3 }
  );
}

export type RzpContact = { id: string };
export type RzpFundAccount = { id: string };
export type RzpPayout = { id: string; status: string; utr?: string };

export const createContact = (input: {
  name: string;
  referenceId: string;
  type?: string;
}): Promise<RzpContact> =>
  xPost("/contacts", {
    name: input.name.slice(0, 50),
    type: input.type ?? "customer",
    reference_id: input.referenceId,
  });

export const createFundAccount = (input: {
  contactId: string;
  accountHolderName: string;
  ifsc: string;
  accountNumber: string;
}): Promise<RzpFundAccount> =>
  xPost("/fund_accounts", {
    contact_id: input.contactId,
    account_type: "bank_account",
    bank_account: {
      name: input.accountHolderName.slice(0, 120),
      ifsc: input.ifsc,
      account_number: input.accountNumber,
    },
  });

export const createPayout = (input: {
  fundAccountId: string;
  amountInPaise: number;
  referenceId: string;
  narration?: string;
}): Promise<RzpPayout> =>
  xPost("/payouts", {
    account_number: accountNumber(),
    fund_account_id: input.fundAccountId,
    amount: input.amountInPaise,
    currency: "INR",
    mode: "IMPS",
    purpose: "payout",
    queue_if_low_balance: true,
    reference_id: input.referenceId,
    narration: (input.narration ?? "Reward withdrawal").slice(0, 30),
  });
