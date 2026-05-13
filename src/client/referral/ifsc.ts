// Razorpay's free, no-auth IFSC lookup. Returns bank/branch/city metadata
// when the IFSC corresponds to a real branch, otherwise 404.
// Docs: https://razorpay.com/docs/api/ifsc/

const IFSC_LOOKUP_URL = "https://ifsc.razorpay.com";
const TIMEOUT_MS = 4000;

export type IfscDetails = {
  bankName: string;
  branchName: string;
  city: string;
};

export async function lookupIfsc(ifsc: string): Promise<IfscDetails | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${IFSC_LOOKUP_URL}/${encodeURIComponent(ifsc)}`, {
      signal: controller.signal,
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`IFSC lookup failed with status ${res.status}.`);
    const data = (await res.json()) as Record<string, string>;
    return {
      bankName: data.BANK ?? "",
      branchName: data.BRANCH ?? "",
      city: data.CITY ?? "",
    };
  } finally {
    clearTimeout(timer);
  }
}
