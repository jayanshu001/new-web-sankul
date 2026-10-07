// TeleCRM config: lead API endpoint, token and test numbers that never become leads.
// Empty fallbacks so import never throws; the "is configured" gate lives in
// env.ts (PROD_FEATURE_VARS) and utils/crm.ts.
export const TELE_CRM = {
  BASE_URL: process.env.TELE_CRM_BASE_URL || "",
  ACCESS_TOKEN: process.env.TELE_CRM_ACCESS_TOKEN || "",
  // QA/demo phone numbers that must never generate a lead.
  TESTING_ACCOUNTS: (process.env.TELE_CRM_TESTING_ACCOUNTS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
} as const;

export const isTeleCrmConfigured = (): boolean =>
  Boolean(TELE_CRM.BASE_URL && TELE_CRM.ACCESS_TOKEN);
