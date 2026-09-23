/**
 * Flush the API response caches (admin + client) from the CLI.
 *
 * Usage:
 *   yarn cache:flush                      # DRY RUN — counts only, deletes nothing
 *   yarn cache:flush --yes                # actually delete
 *   yarn cache:flush --scope=route --yes  # only the route-response cache
 *   yarn cache:flush --scope=aside --yes  # only the cache-aside keyspace
 *   yarn cache:flush --prefix=GET:/api/v1/admin/ebook --yes   # narrow slice
 *   yarn cache:flush --self-test          # verify the safety guard, no Redis needed
 *
 * WHY THIS EXISTS
 * There are TWO cache keyspaces, and the admin endpoint only clears one:
 *
 *   1. route  `{env}:route:{ver}:*`      — cacheRoute() response cache, 152 GET
 *                                          routes across admin + client.
 *                                          POST /api/v1/admin/cache/flush already
 *                                          clears exactly this.
 *   2. aside  `{env}:{domain}:*`         — libs/cache.aside(), domain ∈ admin|
 *                                          client|auth|permission|shared. Used by
 *                                          admin ebook/course detail reads.
 *                                          The admin endpoint does NOT clear it.
 *
 * So prefer the endpoint for a normal content refresh; reach for this script when
 * you need both keyspaces, or when the API is down / you have no admin token.
 *
 * SAFETY
 * Redis holds more than caches. This script SCANs and deletes only the two cache
 * prefixes above and hard-refuses anything else — it never calls FLUSHDB/FLUSHALL
 * (and never KEYS, which blocks the server). Deleting these would be a real
 * incident, so they are blocked explicitly:
 *
 *   revoke:*          token revocation cutoffs — flushing UN-REVOKES logged-out tokens
 *   idem:*            idempotency records — flushing lets a replayed payment /
 *                     withdrawal request EXECUTE A SECOND TIME
 *   *_session:*       customer/admin/educator/promoter sessions — flushing logs
 *                     every user out
 *   entitlement_fp:*  entitlement fingerprints
 *   rl:*              rate-limiter counters — flushing resets every throttle
 *   bull:*            BullMQ jobs — flushing loses queued/in-flight work
 *   socket.io*        Socket.IO adapter state
 *
 * Note the real protection is structural, not the deny-list: every one of those
 * is built with a literal prefix and NO `{env}:` segment (`idem:${scope}:${key}`,
 * `customer_session:${id}`, …), while both cache keyspaces are `{env}:`-rooted.
 * `isSafeTarget` requires the `{env}:` root, so they can never be matched. The
 * deny-list is belt-and-braces.
 *
 * Cache loss is harmless (every read is fail-open and re-populates on the next
 * request); losing any of the above is not.
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

/** Prefixes this script must never touch, whatever the caller passes. */
const PROTECTED = [
  "revoke:",
  "idem:",
  "_session:",
  "entitlement_fp:",
  "rl:",
  "bull:",
  "socket.io",
];

/**
 * A target is safe only if it is scoped to this env AND names one of the cache
 * keyspaces. Guards against an empty/`*` target (which would sweep the whole DB)
 * and against any protected prefix appearing anywhere in the pattern.
 */
export const isSafeTarget = (target: string, env: string): boolean => {
  if (!target || target === "*" || target.trim() === "") return false;
  if (!target.startsWith(`${env}:`)) return false;
  if (target.includes("*")) return false; // we append the '*' ourselves
  const rest = target.slice(env.length + 1);
  if (!rest) return false; // `{env}:` alone would match everything in the env
  return !PROTECTED.some((p) => target.includes(p));
};

const selfTest = () => {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`FAILED: ${msg}`);
  };
  const E = "production";
  // must ACCEPT the real cache targets
  assert(isSafeTarget("production:route:v1", E), "route prefix accepted");
  assert(isSafeTarget("production:admin:ebook", E), "aside admin prefix accepted");
  assert(isSafeTarget("production:client", E), "aside client prefix accepted");
  // must REJECT everything that would be an incident
  assert(!isSafeTarget("", E), "empty rejected");
  assert(!isSafeTarget("*", E), "star rejected");
  assert(!isSafeTarget("production:", E), "env-only rejected (would match all)");
  assert(!isSafeTarget("revoke:customer:1", E), "revoke rejected");
  assert(!isSafeTarget("production:revoke:x", E), "revoke-in-path rejected");
  assert(!isSafeTarget("rl:global:", E), "rate limiter rejected");
  assert(!isSafeTarget("bull:pdf-upload", E), "bullmq rejected");
  assert(!isSafeTarget("idem:referral.withdrawal.status:x", E), "idempotency rejected");
  assert(!isSafeTarget("customer_session:472386", E), "customer session rejected");
  assert(!isSafeTarget("admin_session:53", E), "admin session rejected");
  assert(!isSafeTarget("entitlement_fp:472386:course", E), "entitlement fp rejected");
  assert(!isSafeTarget("staging:route:v1", E), "other env rejected");
  assert(!isSafeTarget("production:route:v1*", E), "explicit glob rejected");
  console.log("self-test: 15/15 guard assertions passed");
};

const main = async () => {
  const argv = process.argv.slice(2);
  const has = (f: string) => argv.includes(f);
  const val = (f: string) =>
    argv.find((a) => a.startsWith(`--${f}=`))?.split("=").slice(1).join("=");

  if (has("--self-test")) return selfTest();

  const apply = has("--yes");
  const scope = (val("scope") ?? "all") as "all" | "route" | "aside";
  const narrow = val("prefix");

  // Imported AFTER dotenv so the Redis client reads a populated env.
  const { redisClient } = await import("../src/config/redis");
  const { ROUTE_CACHE_PREFIX } = await import("../src/middlewares/cacheRoute");

  const ENV = (process.env.NODE_ENV || "dev").toLowerCase();
  // Mirrors libs/cache.ts `Domain`. These are cache-aside roots, siblings of `route`.
  const ASIDE_DOMAINS = ["admin", "client", "auth", "permission", "shared"];

  let targets: string[] = [];
  if (narrow) {
    targets = [`${ROUTE_CACHE_PREFIX}:${narrow.replace(/^:+/, "")}`];
  } else {
    if (scope === "all" || scope === "route") targets.push(ROUTE_CACHE_PREFIX);
    if (scope === "all" || scope === "aside")
      targets.push(...ASIDE_DOMAINS.map((d) => `${ENV}:${d}`));
  }

  const unsafe = targets.filter((t) => !isSafeTarget(t, ENV));
  if (unsafe.length) {
    console.error(`REFUSED — unsafe target(s): ${unsafe.join(", ")}`);
    process.exit(1);
  }

  console.log(`env=${ENV}  scope=${scope}  mode=${apply ? "DELETE" : "DRY RUN"}`);
  console.log(`redis=${process.env.REDIS_HOST ?? "127.0.0.1"}:${process.env.REDIS_PORT ?? 6379}\n`);

  let grand = 0;
  for (const target of targets) {
    let cursor = "0";
    let seen = 0;
    let deleted = 0;
    do {
      // SCAN (never KEYS) so a large keyspace doesn't block the server.
      const [next, batch] = await redisClient.scan(cursor, "MATCH", `${target}*`, "COUNT", 500);
      cursor = next;
      seen += batch.length;
      if (batch.length && apply) deleted += await redisClient.del(...batch);
    } while (cursor !== "0");

    grand += apply ? deleted : seen;
    const n = apply ? deleted : seen;
    console.log(`  ${apply ? "deleted" : "would delete"} ${String(n).padStart(6)}  ${target}*`);
  }

  console.log(`\n${apply ? "DELETED" : "WOULD DELETE"} ${grand} key(s) total`);
  if (!apply) console.log("Dry run — nothing was changed. Re-run with --yes to apply.");

  await redisClient.quit();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
