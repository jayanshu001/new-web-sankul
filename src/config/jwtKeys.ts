// src/config/jwtKeys.ts
//
// JWT signing keyring with key-id (`kid`) header support, prep for
// no-downtime key rotation.
//
// Operations cheat-sheet:
//   - Day 0:   Set `JWT_ACCESS_KEYS=v1:<existing-secret>`. Nothing changes.
//   - Rotation step 1: Add a new kid alongside the old, with the NEW one
//     listed first in CURRENT_KID. Both kids verify; new tokens sign as v2.
//     Existing v1 tokens keep working until they expire naturally.
//        JWT_ACCESS_KEYS=v2:<new-secret>,v1:<old-secret>
//        JWT_ACCESS_CURRENT_KID=v2
//   - Rotation step 2: After the longest TTL has elapsed (Batch 1 set access
//     token TTL = 7 days), remove the old kid:
//        JWT_ACCESS_KEYS=v2:<new-secret>
//
// Legacy compatibility: if `JWT_ACCESS_KEYS` is unset we synthesize a single
// kid `v1` from the existing `JWT_ACCESS_SECRET` so no client code or env
// has to change at the same time. Tokens signed before this change have no
// `kid` header at all; verify() falls back to the v1 secret for those.

export interface KeyRing {
  /** All accepted kids → secrets. Verify reads from here. */
  byKid: Map<string, string>;
  /** Kid used to sign newly-minted tokens. */
  currentKid: string;
  /** Fallback secret used when an incoming token has no `kid` header
   *  (legacy tokens minted before this change rolled out). */
  legacySecret: string;
}

const parseKeysEnv = (raw: string | undefined): Map<string, string> => {
  const map = new Map<string, string>();
  if (!raw) return map;
  for (const pair of raw.split(",")) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx <= 0 || idx === trimmed.length - 1) {
      // Malformed entry. Fail loudly — silently ignoring would let an
      // operator rotate keys and have tokens silently fall back to legacy.
      throw new Error(
        `[jwtKeys] Malformed JWT keys entry: "${trimmed}". Expected "kid:secret".`
      );
    }
    const kid = trimmed.slice(0, idx);
    const secret = trimmed.slice(idx + 1);
    map.set(kid, secret);
  }
  return map;
};

const buildRing = (
  keysEnvVar: string,
  currentKidEnvVar: string,
  legacySecretEnvVar: string
): KeyRing => {
  const legacySecret = (process.env[legacySecretEnvVar] || "") as string;
  const explicit = parseKeysEnv(process.env[keysEnvVar]);

  if (explicit.size === 0) {
    // Synthesize "v1" from the legacy secret so signing still works and
    // verify treats both legacy (no-kid) and v1 tokens identically.
    if (!legacySecret) {
      throw new Error(
        `[jwtKeys] Neither ${keysEnvVar} nor ${legacySecretEnvVar} is set.`
      );
    }
    explicit.set("v1", legacySecret);
  }

  const currentKid =
    process.env[currentKidEnvVar] || Array.from(explicit.keys())[0];

  if (!explicit.has(currentKid)) {
    throw new Error(
      `[jwtKeys] ${currentKidEnvVar}="${currentKid}" not found in ${keysEnvVar} (kids: ${Array.from(
        explicit.keys()
      ).join(", ")}).`
    );
  }

  return {
    byKid: explicit,
    currentKid,
    legacySecret: legacySecret || explicit.get(currentKid)!,
  };
};

// Lazy so unit tests can mutate process.env before first use. Cached after
// the first call per ring to avoid re-parsing on every sign/verify.
let accessRing: KeyRing | null = null;
let refreshRing: KeyRing | null = null;

export const getAccessRing = (): KeyRing => {
  if (!accessRing) {
    accessRing = buildRing(
      "JWT_ACCESS_KEYS",
      "JWT_ACCESS_CURRENT_KID",
      "JWT_ACCESS_SECRET"
    );
  }
  return accessRing;
};

export const getRefreshRing = (): KeyRing => {
  if (!refreshRing) {
    refreshRing = buildRing(
      "JWT_REFRESH_KEYS",
      "JWT_REFRESH_CURRENT_KID",
      "JWT_REFRESH_SECRET"
    );
  }
  return refreshRing;
};

/** Test-only: clear caches so the next get*Ring call re-parses env. */
export const _resetRings = (): void => {
  accessRing = null;
  refreshRing = null;
};
