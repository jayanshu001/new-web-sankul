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
  "MONGODB_URI",
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
