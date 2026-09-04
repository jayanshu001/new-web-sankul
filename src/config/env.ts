// src/config/env.ts
//
// Fail-fast environment validation. Imported and invoked at the very top of
// src/index.ts so the process exits with a clear error BEFORE any module
// tries to use an undefined `process.env.JWT_ACCESS_SECRET` and silently
// signs tokens with the literal string "undefined".
//
// Categories:
//   - `required`: must be present in every environment. Boot fails if missing.
//   - `requiredInProd`: must be present when NODE_ENV=production (CORS allowlist,
//     webhook secret). Missing in dev is just a warn.
//   - `optionalWithDefaults`: have safe defaults already in code; we just
//     surface a warn when missing so misconfigurations don't go unnoticed.
//
// Note: this module deliberately uses `console.error` instead of the winston
// logger because the logger itself is initialized lazily and we want the
// check to run as early as possible.

const REQUIRED = [
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  // The app is MySQL-only (Prisma); DATABASE_URL is always required — validated
  // below. MongoDB has been fully removed, so MONGODB_URI is no longer used.
  "DATABASE_URL",
] as const;

const REQUIRED_IN_PROD = [
  "ALLOWED_ORIGINS",
  "RAZORPAY_WEBHOOK_SECRET",
  "REDIS_HOST",
  "REDIS_PORT",
  // Note: METRICS_TOKEN is required if the /metrics endpoint is mounted; the
  // mount itself is conditional, so we don't list it here.
] as const;

const SECRET_MIN_LENGTH = 32;

/** Warn in production when feature integrations are likely needed but unset. */
const PROD_FEATURE_VARS: { key: string; feature: string; profiles: ("api" | "worker")[] }[] = [
  { key: "SMTP_HOST", feature: "email (OTP, receipts)", profiles: ["api", "worker"] },
  { key: "FIREBASE_SERVICE_ACCOUNT", feature: "push notifications", profiles: ["worker"] },
  { key: "DO_ACCESS_KEY_ID", feature: "file uploads (DigitalOcean Spaces)", profiles: ["api", "worker"] },
  { key: "DO_SECRET_ACCESS_KEY", feature: "file uploads (DigitalOcean Spaces)", profiles: ["api", "worker"] },
  { key: "RAZORPAY_PAYOUT_WEBHOOK_SECRET", feature: "referral payouts", profiles: ["api"] },
  { key: "METRICS_TOKEN", feature: "/metrics scrape auth", profiles: ["api"] },
];

const deployProfile = (): "api" | "worker" | "all" => {
  const raw = process.env.DEPLOY_PROFILE?.trim().toLowerCase();
  if (raw === "api" || raw === "worker") return raw;
  // Single-process / dev: surface all integration warnings.
  return "all";
};

const warnMissingProdFeatures = (
  env: NodeJS.ProcessEnv,
  warnings: string[],
  profile: "api" | "worker" | "all"
): void => {
  for (const { key, feature, profiles } of PROD_FEATURE_VARS) {
    if (profile !== "all" && !profiles.includes(profile)) continue;
    const v = env[key];
    if (!v || v.trim() === "") {
      warnings.push(`${key} not set — ${feature} may fail at runtime.`);
    }
  }
  // StreamOS: only the SELECTED provider's credentials matter. Warning about
  // v1 keys on a legacy deployment (or vice versa) would be pure noise, so this
  // is checked here rather than listed in PROD_FEATURE_VARS.
  // Read directly off `env` — this module deliberately stays dependency-free.
  if (profile !== "worker") {
    const usingV1 = env.STREAMOS_PROVIDER?.trim().toLowerCase() === "v1";
    if (usingV1) {
      if (!env.STREAMOS_API_KEY?.trim()) {
        warnings.push("STREAMOS_API_KEY not set — StreamOS v1 live streaming will fail at runtime.");
      }
      if (!env.STREAMOS_WEBHOOK_SIGNING_SECRET?.trim()) {
        warnings.push(
          "STREAMOS_WEBHOOK_SIGNING_SECRET not set — StreamOS v1 recording webhooks cannot be verified and will be rejected."
        );
      }
    } else if (!env.STREAMOS_ACCESS_KEY?.trim() || !env.STREAMOS_ACCESS_SECRET?.trim()) {
      warnings.push("STREAMOS_ACCESS_KEY/SECRET not set — legacy StreamOS live streaming may fail at runtime.");
    }
  }

  const dbUrl = env.DATABASE_URL?.trim() ?? "";
  if (dbUrl && !/connection_limit=/i.test(dbUrl)) {
    warnings.push(
      "DATABASE_URL has no connection_limit= — size the Prisma pool for PM2 cluster (see docs/DEPLOYMENT_OPERATIONS_AUDIT.md § D1.2)."
    );
  }
};

export interface EnvValidationResult {
  ok: boolean;
  missing: string[];
  warnings: string[];
}

export const validateEnv = (): EnvValidationResult => {
  const env = process.env;
  const missing: string[] = [];
  const warnings: string[] = [];
  const isProd = env.NODE_ENV === "production";

  for (const key of REQUIRED) {
    const v = env[key];
    if (!v || v.trim() === "") {
      missing.push(key);
    }
  }

  if (isProd) {
    for (const key of REQUIRED_IN_PROD) {
      const v = env[key];
      if (!v || v.trim() === "") missing.push(key);
    }
    warnMissingProdFeatures(env, warnings, deployProfile());
  } else {
    for (const key of REQUIRED_IN_PROD) {
      const v = env[key];
      if (!v || v.trim() === "")
        warnings.push(`${key} not set (using dev default; required in production).`);
    }
  }

  // JWT secrets must be long enough to make brute force impractical. 32 bytes
  // is the OWASP guideline minimum for HS256.
  for (const key of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"] as const) {
    const v = env[key];
    if (v && v.length < SECRET_MIN_LENGTH) {
      warnings.push(
        `${key} is shorter than ${SECRET_MIN_LENGTH} chars — consider a longer secret.`
      );
    }
    if (v && /^(secret|changeme|test|password)/i.test(v)) {
      warnings.push(`${key} looks like a placeholder value — rotate before production.`);
    }
  }

  return { ok: missing.length === 0, missing, warnings };
};

/**
 * Validate and abort the process if required env vars are missing.
 * Logs warnings (non-fatal). Returns the validation result for callers
 * that want to act on it (e.g. tests).
 */
export const validateEnvOrExit = (): EnvValidationResult => {
  const result = validateEnv();

  for (const w of result.warnings) {
    // eslint-disable-next-line no-console
    console.warn(`[env] WARN: ${w}`);
  }

  if (!result.ok) {
    // eslint-disable-next-line no-console
    console.error(
      `[env] FATAL: missing required environment variables: ${result.missing.join(", ")}`
    );
    // eslint-disable-next-line no-console
    console.error(
      `[env] Refusing to start. Set these in your .env or container environment and retry.`
    );
    process.exit(1);
  }

  return result;
};
