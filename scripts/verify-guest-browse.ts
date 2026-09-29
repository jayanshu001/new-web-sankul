/**
 * Regression check — guest sessions + guest browse (App Store 5.1.1(v)).
 *
 *   npx tsx scripts/verify-guest-browse.ts            # against the running dev server
 *   GUEST_PROBE_BASE=https://host/api/v1 npx tsx scripts/verify-guest-browse.ts
 *   GUEST_PROBE_LOGIN=1 npx tsx scripts/verify-guest-browse.ts   # + guest → user conversion
 *
 * Proves, against a RUNNING server + real MySQL + Redis:
 *  1. POST /client/auth/guest issues a guest token;
 *  2. every path in GUEST_BROWSE_PATHS answers that token with 200;
 *  3. the same paths answer a bad token with 401, and no token / `bearer null` with
 *     401 — or 200 when the server runs GUEST_TOKENLESS_BROWSE=true (auto-detected);
 *  4. login-only routes answer a guest token with 403 ACCOUNT_REQUIRED (401 tokenless),
 *     on the admin surface too;
 *  5. an expired or revoked guest session answers 401 GUEST_SESSION_EXPIRED;
 *  6. (opt-in) logging in with the guest token attached kills that guest session.
 *
 * Iterates the allowlist itself, so a path added there is covered here for free.
 * Step 6 logs the MIGRATION_TEST_CUSTOMER_PHONE account in — never point it at prod.
 */
import dotenv from "dotenv";
dotenv.config();
import { prisma } from "../src/config/prisma";
import { redisClient } from "../src/config/redis";
import { GUEST_BROWSE_PATHS } from "../src/middlewares/guestBrowse";
import { revokeGuestSession } from "../src/libs/guestSession";
import { signAccessToken } from "../src/utils/jwtSigner";

const ROOT = process.env.GUEST_PROBE_BASE ?? `http://localhost:${process.env.PORT ?? 4001}/api/v1`;
const BASE = `${ROOT}/client`;

/** First matching prefix wins. Table the `:id` in that path belongs to. */
const ID_TABLE: Array<[RegExp, string]> = [
  [/^\/packages\/type\//, "ws_package_type"],
  [/^\/packages\//, "ws_package"],
  [/^\/courses\/categories\//, "ws_video_category"],
  [/^\/courses\//, "ws_course"],
  [/^\/video-categories\//, "ws_video_category"],
  [/^\/material-categories\//, "ws_material_category"],
  [/^\/exam-categories\//, "ws_exam_category"],
  [/^\/exam-countdown-categories\//, "ws_exam_countdown_category"],
  [/^\/exam-countdown\//, "ws_exam_countdown"],
  [/^\/package-categories\//, "ws_package_category"],
  [/^\/educators\//, "ws_course_educator"],
  [/^\/books\//, "ws_book"],
  [/^\/ebooks\//, "ws_ebook"],
  [/^\/offline\/centers\//, "ws_offline_center"],
  [/^\/offline\/batches\//, "ws_offline_batch"],
  [/^\/live-courses\//, "ws_live_course"],
  [/^\/test-series\//, "ws_test_series"],
];
const CATALOG_TABLE: Record<string, string> = { course: "ws_course", package: "ws_package", "live-course": "ws_live_course" };
/** Required query params — without them the handler answers 4xx before any data path runs. */
const QUERY: Record<string, string> = { "/packages/goal": "?goalIds=1", "/books": "?type=regular", "/app-version/check": "?platform=ios" };

/** Login-only. Guest token → 403 ACCOUNT_REQUIRED, no token → 401. */
const STRICT: Array<[string, string]> = [
  ["GET", "/profile"],
  ["GET", "/dashboard/resume"],
  ["GET", "/goals/my-goals"],
  ["GET", "/packages/my"],
  ["GET", "/courses/my"],
  ["GET", "/courses/lecture"],
  ["GET", "/books/orders"],
  ["GET", "/ebooks/subscriptions"],
  ["GET", "/ebooks/downloads"],
  ["GET", "/video-categories/1/videos/1"],
  ["GET", "/live-courses/my"],
  ["GET", "/live-courses/1/recordings"],
  ["GET", "/live-courses/1/lecture/1"],
  ["GET", "/test-series/my/subscriptions"],
  ["GET", "/search/history"],
  ["GET", "/free-videos/resume"],
  ["GET", "/notifications"],
  ["GET", "/cart"],
  ["GET", "/wishlist"],
  ["GET", "/my-subscriptions"],
  ["GET", "/media/resolve"],
  ["GET", "/subscriptions/access"],
  ["GET", "/auth/account-status"],
  ["DELETE", "/auth/logout"],
  ["DELETE", "/profile"],
  ["POST", "/packages"],
  ["PUT", "/goals"],
  ["POST", "/free-videos/1/progress"],
];

const idCache = new Map<string, number | null>();
async function latestId(table: string): Promise<number | null> {
  if (idCache.has(table)) return idCache.get(table)!;
  let id: number | null = null;
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT id FROM ${table} ORDER BY id DESC LIMIT 1`);
    id = rows[0] ? Number(rows[0].id) : null;
  } catch {
    id = null;
  }
  idCache.set(table, id);
  return id;
}

async function resolve(path: string): Promise<string[]> {
  if (path.startsWith("/catalog/")) {
    const out: string[] = [];
    for (const [type, table] of Object.entries(CATALOG_TABLE)) {
      out.push(path.replace(":type", type).replace(":id", String((await latestId(table)) ?? 1)));
    }
    return out;
  }
  if (!path.includes(":id")) return [path + (QUERY[path] ?? "")];
  const table = ID_TABLE.find(([re]) => re.test(path))?.[1];
  return [path.replace(/:id/g, String((table && (await latestId(table))) ?? 1))];
}

type Reply = { status: number; body: string; reason?: string };
const call = async (method: string, url: string, token?: string, body?: object): Promise<Reply> => {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = token.startsWith("bearer ") ? token : `Bearer ${token}`;
  if (body) headers["content-type"] = "application/json";
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let reason: string | undefined;
  try { reason = JSON.parse(text)?.data?.reason; } catch { /* non-JSON */ }
  return { status: res.status, body: text, reason };
};

const mintGuest = async (): Promise<string> => {
  const r = await call("POST", `${BASE}/auth/guest`);
  const data = JSON.parse(r.body)?.data ?? {};
  if (r.status !== 200 || data.userType !== "GUEST" || !data.accessToken || Number.isNaN(Date.parse(data.expiresAt))) {
    throw new Error(`POST /auth/guest → ${r.status} ${r.body.slice(0, 200)}`);
  }
  return data.accessToken;
};

async function main(): Promise<void> {
  let failed = 0;
  let passed = 0;
  const warn: string[] = [];
  const expect = (ok: boolean, label: string, got: Reply) => {
    if (ok) { passed++; return; }
    failed++;
    console.log(`  FAIL  ${label} → ${got.status} ${got.reason ?? ""} ${got.body.slice(0, 140)}`);
  };

  console.log(`guest probe → ${BASE}\n\n[1] POST /auth/guest`);
  const guest = await mintGuest();
  passed++;
  console.log("  ok    guest token issued");

  // Tokenless mode is a server-side env flag; read it off the server's own answer.
  const tokenless = (await call("GET", `${BASE}/dashboard`)).status === 200 ? 200 : 401;
  console.log(`[2+3] allowlisted paths: guest token 200; bad token 401; no token / bearer null ${tokenless} (GUEST_TOKENLESS_BROWSE=${tokenless === 200})`);
  for (const raw of GUEST_BROWSE_PATHS) {
    for (const path of await resolve(raw)) {
      const g = await call("GET", BASE + path, guest);
      if (g.status === 200) passed++;
      else if ([401, 403].includes(g.status) || g.status >= 500) expect(false, `guest GET ${path}`, g);
      else warn.push(`${g.status} ${path} ${g.body.slice(0, 120)}`);
      const t = await call("GET", BASE + path);
      expect(t.status === tokenless, `tokenless GET ${path} must ${tokenless}`, t);
      const n = await call("GET", BASE + path, "bearer null");
      expect(n.status === tokenless, `bearer null GET ${path} must ${tokenless}`, n);
      const b = await call("GET", BASE + path, "not.a.jwt");
      expect(b.status === 401, `bad token GET ${path} must 401`, b);
    }
  }

  console.log("[4] login-only routes: guest token 403 ACCOUNT_REQUIRED, no token 401");
  for (const [method, path] of STRICT) {
    const g = await call(method, BASE + path, guest);
    expect(g.status === 403 && g.reason === "ACCOUNT_REQUIRED", `guest ${method} ${path}`, g);
    const t = await call(method, BASE + path);
    expect(t.status === 401, `tokenless ${method} ${path}`, t);
  }
  // A guest token must open nothing on the other surfaces either.
  for (const path of ["/admin/auth/me", "/admin/packages"]) {
    const g = await call("GET", ROOT + path, guest);
    expect(g.status === 403 && g.reason === "ACCOUNT_REQUIRED", `guest GET ${path}`, g);
  }

  console.log("[5] expired / revoked guest session → 401 GUEST_SESSION_EXPIRED");
  const expired = signAccessToken({ type: "guest", role: "guest", sid: "expired-probe" }, { expiresIn: -10 });
  for (const path of ["/dashboard", "/cart"]) {
    const r = await call("GET", BASE + path, expired);
    expect(r.status === 401 && r.reason === "GUEST_SESSION_EXPIRED", `expired guest GET ${path}`, r);
  }
  const revoked = await mintGuest();
  expect((await call("GET", `${BASE}/dashboard`, revoked)).status === 200, "fresh guest GET /dashboard", await call("GET", `${BASE}/dashboard`, revoked));
  await revokeGuestSession(revoked);
  for (const path of ["/dashboard", "/cart"]) {
    const r = await call("GET", BASE + path, revoked);
    expect(r.status === 401 && r.reason === "GUEST_SESSION_EXPIRED", `revoked guest GET ${path}`, r);
  }

  if (process.env.GUEST_PROBE_LOGIN === "1") {
    console.log("[6] guest → user conversion kills the guest session");
    const phone = process.env.MIGRATION_TEST_CUSTOMER_PHONE;
    const otp = process.env.MIGRATION_TEST_CUSTOMER_OTP;
    if (!phone || !otp) throw new Error("GUEST_PROBE_LOGIN needs MIGRATION_TEST_CUSTOMER_PHONE + MIGRATION_TEST_CUSTOMER_OTP");
    const conv = await mintGuest();
    const gen = await call("POST", `${BASE}/auth/otp/generate`, conv, { phoneNumber: phone });
    expect(gen.status === 200, "otp/generate with guest token attached", gen);
    const login = await call("POST", `${BASE}/auth/otp/validate`, conv, { phoneNumber: phone, otp });
    expect(login.status === 200, "otp/validate with guest token attached", login);
    const after = await call("GET", `${BASE}/dashboard`, conv);
    expect(after.status === 401 && after.reason === "GUEST_SESSION_EXPIRED", "converted guest token must be dead", after);
    const userToken = JSON.parse(login.body)?.data?.accessToken;
    const asUser = await call("GET", `${BASE}/dashboard`, userToken);
    expect(asUser.status === 200, "new customer token GET /dashboard", asUser);
  }

  await prisma.$disconnect();
  redisClient.disconnect();
  if (warn.length) console.log(`\n${warn.length} non-200 non-auth answers (probe id unusable — check by hand):\n  ${[...new Set(warn)].join("\n  ")}`);
  console.log(failed ? `\n${passed} passed, ${failed} FAILED` : `\nall ${passed} guest checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
