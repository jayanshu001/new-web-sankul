// RazorpayX (Payouts) HTTP client. The `razorpay` npm SDK only covers
// the standard Payments product; Contacts / Fund Accounts / Payouts live
// on the X API and must be called over HTTP with Basic Auth.

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
  const res = await fetch(`${X_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth() },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const msg = data?.error?.description || `RazorpayX ${path} failed with ${res.status}.`;
    throw new Error(msg);
  }
  return data as T;
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
