// src/config/telecrm.ts
//
// TeleCRM lead-push integration config. Twin of src/config/courier.ts: a
// static, env-driven object with safe (non-functional) fallbacks so the
// module never throws at import time — the actual "is this configured"
// gate lives in env.ts (PROD_FEATURE_VARS) and in utils/crm.ts (prod-only +
// missing-config guards).
export const TELE_CRM = {
  BASE_URL: process.env.TELE_CRM_BASE_URL || "",
  ACCESS_TOKEN: process.env.TELE_CRM_ACCESS_TOKEN || "",
  // Comma-separated phone numbers that must never generate a lead (QA/demo
  // accounts). Env-driven so ops can add/remove numbers without a deploy —
  // mirrors the old backend's constants.TESTING_ACCOUNTS list, just sourced
  // from env instead of a hardcoded array.
  TESTING_ACCOUNTS: (process.env.TELE_CRM_TESTING_ACCOUNTS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
} as const;

export const isTeleCrmConfigured = (): boolean =>
  Boolean(TELE_CRM.BASE_URL && TELE_CRM.ACCESS_TOKEN);
