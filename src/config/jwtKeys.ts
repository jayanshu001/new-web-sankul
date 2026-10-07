// JWT keys: keyring keyed by `kid` for no-downtime rotation:
//   1. JWT_ACCESS_KEYS=v2:<new>,v1:<old> + JWT_ACCESS_CURRENT_KID=v2
//      (both verify, new tokens sign as v2);
//   2. after the longest token TTL (7 days) drop v1.
// With JWT_ACCESS_KEYS unset, kid `v1` is synthesized from JWT_ACCESS_SECRET;
// tokens without a `kid` header verify against that legacy secret.

export interface KeyRing {
  byKid: Map<string, string>;
  currentKid: string;
  /** Used for incoming tokens without a `kid` header. */
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
      // Fail loudly: ignoring it would let a rotation silently fall back to legacy.
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

// Lazy so tests can mutate process.env before first use.
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
