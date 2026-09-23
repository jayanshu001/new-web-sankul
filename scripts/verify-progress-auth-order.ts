/**
 * Regression check — auth must be decided BEFORE entitlement on every progress
 * heartbeat route.
 *
 *   npx tsx scripts/verify-progress-auth-order.ts
 *
 * Why this exists
 * ---------------
 * The mobile client treats HTTP 401 (or `code: 401`) as "session expired → log
 * the user out", and 403 as "you are logged in but not entitled → show a
 * paywall toast". Collapsing the two is user-visible in both directions: a dead
 * token answered with 403 strands the user in a session that can never recover,
 * and an entitlement failure answered with 401 signs out a paying customer.
 *
 * A 2026-09 frontend report claimed the heartbeat routes did the former. They
 * did not, and this script is the standing proof. See
 * docs/client/PROGRESS_HEARTBEAT_AUTH_401_VS_403.md.
 *
 * What it proves
 * --------------
 * Mounts the REAL `authenticate` + `requireRole("customer")` pair in front of a
 * stand-in handler that unconditionally answers the 403 subscription message —
 * the same string src/modules/client-lecture-progress emits. If auth ever stops
 * short-circuiting (a route mounted above the `router.use`, an
 * `optionalAuthenticate` swapped in, a catch that falls through), the probe gets
 * that 403 back and the script exits non-zero.
 *
 * Runs fully in-process on an ephemeral port. No MySQL, no Redis: all four
 * token states below are rejected on signature/expiry alone, before
 * `authenticate` consults the account gate.
 */
import dotenv from "dotenv";
import express from "express";
import jwt from "jsonwebtoken";
import authenticate, { requireRole } from "../src/middlewares/authenticate";

dotenv.config();

/** The entitlement gate's message. It must never answer an auth failure. */
const ENTITLEMENT_403 = "No active subscription for this lecture.";

/** Mirrors the three routers that mount a heartbeat handler. */
const HEARTBEAT_PATHS = [
  "/api/v1/client/courses/lectures/123/progress",
  "/api/v1/client/learning/progress/live-sessions/123",
  "/api/v1/client/free-videos/123/progress",
];

async function main(): Promise<void> {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) {
    throw new Error("JWT_ACCESS_SECRET is required to mint the probe tokens (load .env).");
  }

  const claims = { id: "1", phone: "0000000000", role: "customer", type: "customer" };
  const probes: Array<{ label: string; headers: Record<string, string> }> = [
    { label: "no Authorization header", headers: {} },
    { label: "malformed token", headers: { Authorization: "Bearer not.a.jwt" } },
    {
      label: "expired token",
      headers: { Authorization: `Bearer ${jwt.sign(claims, secret, { expiresIn: "-1h" })}` },
    },
    {
      label: "wrong signature",
      headers: {
        Authorization: `Bearer ${jwt.sign(claims, `${secret}-not-the-real-key`, { expiresIn: "1h" })}`,
      },
    },
  ];

  const app = express();
  app.use(express.json());

  // Same shape as src/client/{course,learning,free}/*.routes.ts: the auth pair is
  // a router-level `use`, so it runs before every route defined below it.
  const router = express.Router();
  router.use(authenticate, requireRole("customer"));
  const entitlementStub = (_req: express.Request, res: express.Response) =>
    res.status(403).json({ success: false, message: ENTITLEMENT_403 });
  router.post("/courses/lectures/:videoId/progress", entitlementStub);
  router.post("/learning/progress/live-sessions/:liveSessionId", entitlementStub);
  router.post("/free-videos/:videoId/progress", entitlementStub);
  app.use("/api/v1/client", router);

  const server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as { port: number };

  let failures = 0;
  try {
    for (const path of HEARTBEAT_PATHS) {
      for (const probe of probes) {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...probe.headers },
          body: JSON.stringify({
            positionSec: 10,
            durationSec: 100,
            scope: { kind: "course", id: "1" },
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          code?: number;
          message?: string;
        };
        const ok = res.status === 401 && body.code === 401;
        if (!ok) failures += 1;
        console.log(
          `${ok ? "PASS" : "FAIL"}  ${probe.label.padEnd(24)} ${path}\n` +
            `        HTTP ${res.status}  code=${body.code ?? "<none>"}  ` +
            `message=${JSON.stringify(body.message ?? null)}`
        );
      }
    }
  } finally {
    server.close();
  }

  const total = HEARTBEAT_PATHS.length * probes.length;
  if (failures > 0) {
    console.error(
      `\n${failures}/${total} probes did not answer 401. ` +
        `An invalid token must never reach the entitlement gate.`
    );
    process.exit(1);
  }
  console.log(`\nAll ${total} probes answered HTTP 401 with code:401.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
