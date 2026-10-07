// Jobs API config: websankul-jobs-api base URL and cache-revalidation key.
// Empty fallbacks so import never throws; the "is configured" gate lives in
// env.ts (PROD_FEATURE_VARS) and utils/jobsApiCache.ts.
export const JOBS_API = {
  BASE_URL: (process.env.JOBS_API_BASE_URL || "").replace(/\/+$/, ""),
  CACHE_AUTH_KEY: process.env.JOBS_API_CACHE_AUTH_KEY || "",
} as const;

export const isJobsApiCacheConfigured = (): boolean =>
  Boolean(JOBS_API.BASE_URL && JOBS_API.CACHE_AUTH_KEY);
