// Token pool loader — call in setup(), pass result to VUs as `data`.
// Reads docs/migration/api-tests/.auth.json (minted by `yarn migration:api:auth`).
// NOTE: tokens are short-lived (~1h). Re-run `yarn migration:api:auth` before a run
// if setup() reports the pool is stale.
const AUTH_PATH = __ENV.AUTH_FILE || 'docs/migration/api-tests/.auth.json';

// `open()` is only allowed in the init (global) stage, so read the file here at
// module load — NOT inside loadTokens()/setup().
const RAW_AUTH = open(`../../${AUTH_PATH}`);

export function loadTokens() {
  const parsed = JSON.parse(RAW_AUTH);
  const tokens = {
    customer: parsed.customer,
    admin: parsed.admin,
    mintedAt: parsed.mintedAt,
  };
  if (!tokens.customer) {
    throw new Error(
      'No customer token in .auth.json — run `yarn migration:api:auth` first.',
    );
  }
  // Warn (in logs) if the mint is older than ~55 minutes.
  const ageMs = tokens.mintedAt ? Date.now() - tokens.mintedAt : Infinity;
  if (ageMs > 55 * 60 * 1000) {
    console.warn(
      `[auth] token minted ${Math.round(ageMs / 60000)}m ago — may be expired. Re-run yarn migration:api:auth`,
    );
  }
  return tokens;
}
