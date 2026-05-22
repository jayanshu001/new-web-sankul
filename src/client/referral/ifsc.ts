// Razorpay's free, no-auth IFSC lookup. Returns bank/branch/city metadata
// when the IFSC corresponds to a real branch, otherwise 404.
// Docs: https://razorpay.com/docs/api/ifsc/

import { callOutbound } from "../../libs/outbound";

const IFSC_LOOKUP_URL = "https://ifsc.razorpay.com";
const TIMEOUT_MS = 4000;

export const TEST_IFSC_CODES = new Set(["AAAA0AAAAAA"]);

export type IfscDetails = {
  bankName: string;
  branchName: string;
  city: string;
};

export async function lookupIfsc(ifsc: string): Promise<IfscDetails | null> {
  if (TEST_IFSC_CODES.has(ifsc.toUpperCase())) {
    return { bankName: "Test Bank", branchName: "Test Branch", city: "Test City" };
  }

  // callOutbound provides the timeout + retry + circuit breaker uniformly.
  // 404 is a legitimate "no such IFSC" response from Razorpay, so we
  // surface it as `null` rather than throwing — the wrapper would otherwise
  // count 404s toward the breaker, which would be wrong (404 isn't a
  // dependency failure).
  return callOutbound(
    async () => {
      const res = await fetch(`${IFSC_LOOKUP_URL}/${encodeURIComponent(ifsc)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`IFSC lookup failed with status ${res.status}.`);
      const data = (await res.json()) as Record<string, string>;
      return {
        bankName: data.BANK ?? "",
        branchName: data.BRANCH ?? "",
        city: data.CITY ?? "",
      };
    },
    { label: "ifsc.razorpay", timeoutMs: TIMEOUT_MS, attempts: 2 }
  );
}
