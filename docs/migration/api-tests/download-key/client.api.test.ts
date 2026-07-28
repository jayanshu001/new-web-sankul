import { assertServerUp, getCustomerToken, requireMysqlModule } from "../_lib/auth.js";
import { request, requestOk, requestExpectStatus } from "../_lib/http.js";
import { mintCustomerTokenFor } from "../_lib/mint-auth.js";
import { db } from "../_lib/db.js";
import { config } from "../_lib/env.js";
import { runTests } from "../_lib/runner.js";

/**
 * download-key (client) — per-customer offline-download AES-256 key custody.
 *
 *   GET /api/v1/client/downloads/encryption-key
 *   PUT /api/v1/client/downloads/encryption-key
 *
 * Backed by `ws_customer.download_key_hex` — one key per account comes free from
 * the customer primary key; NULL is the "never stored" (404) state. Mirrors the
 * FE spec's acceptance checklist; the isolation and stability cases are the ones
 * that actually matter, because returning the wrong key — or silently rotating a
 * key — makes every file the user already downloaded permanently unreadable on
 * their device.
 */

const PATH = "/api/v1/client/downloads/encryption-key";

const KEY_A = "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456";
const KEY_B = "0f0e0d0c0b0a09080706050403020100ffeeddccbbaa99887766554433221100";

/** The int customer id the mock JWT represents. */
function testCustomerId(): number {
  const raw = process.env.MIGRATION_TEST_CUSTOMER_ID ?? "";
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(
      `MIGRATION_TEST_CUSTOMER_ID must be a real int ws_customer id (got "${raw}") — the client routes 401 otherwise`
    );
  }
  return n;
}

/** NULL the column so a run always starts from the documented "never stored" state. */
async function clearKey(customerId: number): Promise<void> {
  await db().customer.updateMany({ where: { id: customerId }, data: { downloadKeyHex: null } });
}

/** Read the raw stored value, bypassing the API — proves what actually landed in MySQL. */
async function storedKey(customerId: number): Promise<string | null> {
  const row = await db().customer.findUnique({
    where: { id: customerId },
    select: { downloadKeyHex: true },
  });
  return row?.downloadKeyHex ?? null;
}

/**
 * The customer row's own `updated_at`. The key shares it with the rest of the
 * profile now, so an unchanged re-PUT must leave it alone — otherwise the
 * customer row looks edited every time the app retries a sync.
 */
async function storedUpdatedAt(customerId: number): Promise<Date | null> {
  const row = await db().customer.findUnique({
    where: { id: customerId },
    select: { updatedAt: true },
  });
  return row?.updatedAt ?? null;
}

/**
 * A second real, active customer id — needed to prove cross-account isolation.
 * Must be live (`authenticate` rejects deleted/blocked accounts), so the same
 * filters the auth gate uses are applied here.
 */
async function otherCustomerId(primary: number): Promise<number | null> {
  const row = await db().customer.findFirst({
    where: { id: { not: primary }, isAccountDeleted: false, status: true },
    orderBy: { id: "desc" },
    select: { id: true },
  });
  return row?.id ?? null;
}

export async function runDownloadKeyClientApiTests(): Promise<boolean> {
  const cid = (() => {
    try {
      return testCustomerId();
    } catch {
      return 0;
    }
  })();

  return runTests("download-key (client)", [
    { name: "server healthz", fn: assertServerUp },
    { name: "module enabled in MIGRATION_MYSQL_MODULES", fn: () => requireMysqlModule("download-key") },
    { name: "MIGRATION_TEST_CUSTOMER_ID is a real int customer id", fn: () => void testCustomerId() },

    {
      name: "GET without a Bearer token → 401",
      fn: async () => {
        await requestExpectStatus("GET", PATH, 401);
      },
    },

    {
      name: "PUT without a Bearer token → 401",
      fn: async () => {
        await requestExpectStatus("PUT", PATH, 401, { body: { key: KEY_A } });
      },
    },

    {
      name: "GET with no stored key → 404 'Download encryption key not found'",
      skip: config.skipWrite,
      fn: async () => {
        await clearKey(cid);
        const token = await getCustomerToken();
        const json = await requestExpectStatus("GET", PATH, 404, { token });
        if (json.success !== false) throw new Error("404 body must carry success:false");
        if (json.message !== "Download encryption key not found")
          throw new Error(`404 message drifted from the FE contract: "${json.message}"`);
      },
    },

    {
      name: "PUT rejects a missing key → 400 'Invalid encryption key'",
      skip: config.skipWrite,
      fn: async () => {
        const token = await getCustomerToken();
        const json = await requestExpectStatus("PUT", PATH, 400, { token, body: {} });
        if (json.message !== "Invalid encryption key")
          throw new Error(`400 message drifted from the FE contract: "${json.message}"`);
      },
    },

    {
      name: "PUT rejects wrong length (63 / 65 hex chars) → 400",
      skip: config.skipWrite,
      fn: async () => {
        const token = await getCustomerToken();
        await requestExpectStatus("PUT", PATH, 400, { token, body: { key: KEY_A.slice(0, 63) } });
        await requestExpectStatus("PUT", PATH, 400, { token, body: { key: KEY_A + "a" } });
      },
    },

    {
      name: "PUT rejects non-hex characters → 400",
      skip: config.skipWrite,
      fn: async () => {
        const token = await getCustomerToken();
        await requestExpectStatus("PUT", PATH, 400, { token, body: { key: "z".repeat(64) } });
        await requestExpectStatus("PUT", PATH, 400, { token, body: { key: KEY_A.slice(0, 63) + "!" } });
      },
    },

    {
      name: "PUT rejects a non-string key → 400",
      skip: config.skipWrite,
      fn: async () => {
        const token = await getCustomerToken();
        await requestExpectStatus("PUT", PATH, 400, { token, body: { key: 12345 } });
      },
    },

    {
      name: "PUT stores the key and echoes it back → 200 + data.key",
      skip: config.skipWrite,
      fn: async () => {
        await clearKey(cid);
        const token = await getCustomerToken();
        const json = await requestOk("PUT", PATH, { token, body: { key: KEY_A } });
        const key = (json.data as { key?: string })?.key;
        if (key !== KEY_A) throw new Error(`PUT echoed "${key}", expected the submitted key`);
        if ((await storedKey(cid)) !== KEY_A) throw new Error("key was not persisted to ws_customer.download_key_hex");
      },
    },

    {
      name: "PUT then GET (same user) returns the SAME key — never rotated",
      skip: config.skipWrite,
      fn: async () => {
        await clearKey(cid);
        const token = await getCustomerToken();
        await requestOk("PUT", PATH, { token, body: { key: KEY_A } });

        // Three consecutive GETs: a key that drifts between reads would silently
        // brick already-downloaded files, so stability is asserted, not assumed.
        for (let i = 0; i < 3; i++) {
          const json = await requestOk("GET", PATH, { token });
          const key = (json.data as { key?: string })?.key;
          if (key !== KEY_A) throw new Error(`GET #${i + 1} returned "${key}", expected the stored key`);
        }
      },
    },

    {
      name: "GET returns exactly 64 hex chars",
      skip: config.skipWrite,
      fn: async () => {
        const token = await getCustomerToken();
        const json = await requestOk("GET", PATH, { token });
        const key = (json.data as { key?: string })?.key ?? "";
        if (!/^[0-9a-fA-F]{64}$/.test(key)) throw new Error(`data.key is not 64 hex chars: "${key}"`);
      },
    },

    {
      name: "GET response is marked no-store (a secret must not be cached)",
      skip: config.skipWrite,
      fn: async () => {
        const token = await getCustomerToken();
        const res = await fetch(`${config.baseUrl}${PATH}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        });
        const cc = res.headers.get("cache-control") ?? "";
        if (!cc.includes("no-store")) throw new Error(`expected Cache-Control: no-store, got "${cc}"`);
      },
    },

    {
      name: "PUT is idempotent — re-sending the same key does not touch updated_at",
      skip: config.skipWrite,
      fn: async () => {
        await clearKey(cid);
        const token = await getCustomerToken();
        await requestOk("PUT", PATH, { token, body: { key: KEY_A } });
        const before = await storedUpdatedAt(cid);

        await requestOk("PUT", PATH, { token, body: { key: KEY_A } });
        const after = await storedUpdatedAt(cid);

        if (before?.getTime() !== after?.getTime())
          throw new Error("re-PUT of an unchanged key rewrote updated_at (idempotency broken)");
        if ((await storedKey(cid)) !== KEY_A) throw new Error("re-PUT corrupted the stored key");
      },
    },

    {
      name: "PUT is an upsert — a different key overwrites, and only one row survives",
      skip: config.skipWrite,
      fn: async () => {
        await clearKey(cid);
        const token = await getCustomerToken();
        await requestOk("PUT", PATH, { token, body: { key: KEY_A } });
        await requestOk("PUT", PATH, { token, body: { key: KEY_B } });

        const json = await requestOk("GET", PATH, { token });
        if ((json.data as { key?: string })?.key !== KEY_B)
          throw new Error("overwrite did not take effect");
        if ((await storedKey(cid)) !== KEY_B) throw new Error("overwrite did not reach MySQL");
      },
    },

    {
      name: "the key column never leaks into the profile response",
      skip: config.skipWrite,
      fn: async () => {
        const token = await getCustomerToken();
        await requestOk("PUT", PATH, { token, body: { key: KEY_A } });

        // ws_customer rows are loaded whole in most read paths, so the guarantee
        // that matters is that transformers pick fields explicitly. Assert it on
        // the widest customer-shaped response the client can reach.
        const profile = await requestOk("GET", "/api/v1/client/profile", { token });
        const blob = JSON.stringify(profile);
        if (blob.includes(KEY_A)) throw new Error("CRITICAL: download key leaked into GET /client/profile");
        if (/downloadKeyHex|download_key_hex/i.test(blob))
          throw new Error("download key field name surfaced in the profile DTO");
      },
    },

    {
      name: "PUT ignores a body userId — strict schema rejects it outright (400)",
      skip: config.skipWrite,
      fn: async () => {
        const token = await getCustomerToken();
        const other = await otherCustomerId(cid);
        await requestExpectStatus("PUT", PATH, 400, {
          token,
          body: { key: KEY_A, userId: other ?? 1 },
        });
      },
    },

    {
      name: "customer B never receives customer A's key (per-user isolation)",
      skip: config.skipWrite,
      fn: async () => {
        const other = await otherCustomerId(cid);
        if (other == null) {
          console.log("     (no second active customer in this DB — isolation case skipped)");
          return;
        }

        await clearKey(cid);
        await clearKey(other);

        const tokenA = await getCustomerToken();
        await requestOk("PUT", PATH, { token: tokenA, body: { key: KEY_A } });

        const tokenB = await mintCustomerTokenFor(String(other));

        // B has never stored a key → must 404, NOT inherit A's.
        const missB = await request("GET", PATH, { token: tokenB });
        if (missB.status !== 404) {
          const leaked = (missB.json.data as { key?: string })?.key;
          throw new Error(
            leaked === KEY_A
              ? "CRITICAL: customer B received customer A's key"
              : `expected 404 for customer B, got ${missB.status}`
          );
        }

        // B stores its own key; A's must be untouched.
        await requestOk("PUT", PATH, { token: tokenB, body: { key: KEY_B } });

        const aNow = (await requestOk("GET", PATH, { token: tokenA })).data as { key?: string };
        const bNow = (await requestOk("GET", PATH, { token: tokenB })).data as { key?: string };
        if (aNow?.key !== KEY_A) throw new Error("CRITICAL: customer B's write clobbered customer A's key");
        if (bNow?.key !== KEY_B) throw new Error("customer B did not get its own key back");

        await clearKey(other);
      },
    },

    {
      name: "cleanup — remove the test key row",
      skip: config.skipWrite,
      fn: async () => {
        await clearKey(cid);
      },
    },
  ]);
}
