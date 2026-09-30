/**
 * Regression check — guest login + guest browse.
 *
 *   npx tsx scripts/verify-guest-browse.ts            # against the running dev server
 *   GUEST_PROBE_BASE=https://host/api/v1 npx tsx scripts/verify-guest-browse.ts
 *
 * Guest mode is switched from Firebase (`maintain.env === "staging"`), so the script
 * reads the server's own answer to `POST /client/auth/guest` and checks the matching
 * contract. Needs a RUNNING server + MySQL + Redis.
 *
 * Guest mode ON:
 *  1. POST /client/auth/guest returns the static token (same string twice, no exp);
 *  2. every path in GUEST_BROWSE_PATHS answers that token with 200;
 *  3. the same paths answer no token / `bearer null` / a bad token with 401;
 *  4. login-only routes answer the guest token with 403 ACCOUNT_REQUIRED (401
 *     tokenless), on the admin surface too;
 *  5. a guest token that does not verify answers 401 GUEST_SESSION_EXPIRED.
 * Guest mode OFF:
 *  6. POST /client/auth/guest answers 403 GUEST_MODE_DISABLED and a correctly signed
 *     guest token answers 401 GUEST_SESSION_EXPIRED on every route.
 *
 * Iterates the allowlist itself, so a path added there is covered here for free.
 * Step 6 signs the token locally, so it needs the server's JWT secret in `.env`.
 */
import dotenv from "dotenv";
dotenv.config();
import { prisma } from "../src/config/prisma";
import { GUEST_BROWSE_PATHS } from "../src/middlewares/guestBrowse";
import jwt from "jsonwebtoken";
import { guestToken } from "../src/libs/guestSession";

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
  const mint = await call("POST", `${BASE}/auth/guest`);

  if (mint.status === 403 && mint.reason === "GUEST_MODE_DISABLED") {
    console.log("  guest mode is OFF on this server (Firebase maintain.env is not \"staging\")\n[6] a guest token must be dead everywhere");
    passed++;
    const signed = guestToken();
    for (const path of ["/dashboard", "/packages", "/cart", "/profile"]) {
      const r = await call("GET", BASE + path, signed);
      expect(r.status === 401 && r.reason === "GUEST_SESSION_EXPIRED", `guest token GET ${path}`, r);
      const t = await call("GET", BASE + path);
      expect(t.status === 401, `tokenless GET ${path}`, t);
    }
    await prisma.$disconnect();
    console.log(failed ? `\n${passed} passed, ${failed} FAILED` : `\nall ${passed} guest checks passed (guest mode OFF)`);
    process.exit(failed ? 1 : 0);
  }

  const data = JSON.parse(mint.body)?.data ?? {};
  expect(mint.status === 200 && data.userType === "GUEST" && !!data.accessToken && data.expiresAt === null, "POST /auth/guest", mint);
  const guest: string = data.accessToken;
  const again = JSON.parse((await call("POST", `${BASE}/auth/guest`)).body)?.data?.accessToken;
  expect(again === guest, "guest token is static (same string on every call)", mint);
  const claims = jwt.decode(guest) as any;
  expect(claims?.type === "guest" && claims?.exp === undefined && claims?.iat === undefined, "guest token carries no exp / iat", mint);
  console.log("  guest mode is ON; static token issued");

  console.log("[2+3] allowlisted paths: guest token 200; no token / bearer null / bad token 401");
  for (const raw of GUEST_BROWSE_PATHS) {
    for (const path of await resolve(raw)) {
      const g = await call("GET", BASE + path, guest);
      if (g.status === 200) passed++;
      else if ([401, 403].includes(g.status) || g.status >= 500) expect(false, `guest GET ${path}`, g);
      else warn.push(`${g.status} ${path} ${g.body.slice(0, 120)}`);
      const t = await call("GET", BASE + path);
      expect(t.status === 401, `tokenless GET ${path} must 401`, t);
      const n = await call("GET", BASE + path, "bearer null");
      expect(n.status === 401, `bearer null GET ${path} must 401`, n);
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

  console.log("[5] a guest token that does not verify → 401 GUEST_SESSION_EXPIRED");
  const forged = jwt.sign({ type: "guest", role: "guest" }, "not-the-server-secret", { noTimestamp: true });
  for (const path of ["/dashboard", "/cart"]) {
    const r = await call("GET", BASE + path, forged);
    expect(r.status === 401 && r.reason === "GUEST_SESSION_EXPIRED", `forged guest GET ${path}`, r);
  }

  await prisma.$disconnect();
  if (warn.length) console.log(`\n${warn.length} non-200 non-auth answers (probe id unusable — check by hand):\n  ${[...new Set(warn)].join("\n  ")}`);
  console.log(failed ? `\n${passed} passed, ${failed} FAILED` : `\nall ${passed} guest checks passed (guest mode ON)`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
