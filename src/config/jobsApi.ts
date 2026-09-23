// src/config/jobsApi.ts
//
// Public websankul-jobs-api cache-revalidation config. Twin of
// src/config/telecrm.ts: a static, env-driven object with safe fallbacks so
// the module never throws at import time — the "is this configured" gate
// lives in env.ts (PROD_FEATURE_VARS) and in utils/jobsApiCache.ts.
export const JOBS_API = {
  BASE_URL: (process.env.JOBS_API_BASE_URL || "").replace(/\/+$/, ""),
  CACHE_AUTH_KEY: process.env.JOBS_API_CACHE_AUTH_KEY || "",
} as const;

export const isJobsApiCacheConfigured = (): boolean =>
  Boolean(JOBS_API.BASE_URL && JOBS_API.CACHE_AUTH_KEY);
