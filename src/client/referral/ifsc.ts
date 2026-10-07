// IFSC lookup: Razorpay public IFSC API (https://razorpay.com/docs/api/ifsc/); 404 for unknown codes.

import { callOutbound } from "../../libs/outbound";

const IFSC_LOOKUP_URL = "https://ifsc.razorpay.com";
const TIMEOUT_MS = 4000;

export const TEST_IFSC_CODES = new Set(["AAAA0AAAAAA"]);

export type IfscDetails = {
  bankName: string;
  branchName: string;
  city: string;
};

// Null for an unknown IFSC; test codes short-circuit without a network call.
export async function lookupIfsc(ifsc: string): Promise<IfscDetails | null> {
  if (TEST_IFSC_CODES.has(ifsc.toUpperCase())) {
    return { bankName: "Test Bank", branchName: "Test Branch", city: "Test City" };
  }

  // 404 means "no such IFSC", so it maps to null instead of throwing: callOutbound
  // would otherwise count it toward the circuit breaker.
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
