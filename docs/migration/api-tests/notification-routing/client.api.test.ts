import { assertServerUp, getCustomerToken, requireMysqlModule } from "../_lib/auth.js";
import { requestOk } from "../_lib/http.js";
import { db } from "../_lib/db.js";
import { config } from "../_lib/env.js";
import { runTests } from "../_lib/runner.js";
import { buildNotificationRouting } from "../../../../src/utils/notificationTarget.js";

/**
 * notification-routing (client) — tap-routing fields on GET /client/notifications.
 *
 * Tapping a row in the in-app Notification screen must land on the SAME
 * destination as tapping the push that created it. The routing has always been
 * persisted (ws_notification.deep_link + .data); what was missing was the read
 * projection — the client controller's `pickList` keep-list silently dropped it,
 * so the app could only open the detail modal.
 *
 * That is exactly why this suite exists: the regression is a one-line edit to a
 * field allow-list, invisible in review, with no type error and no failing
 * build. Every case below seeds through `buildNotificationRouting` — the same
 * builder the push path uses — so "list and push must match" is enforced by
 * construction rather than by asserting hand-written literals twice.
 */

const PATH = "/api/v1/client/notifications";
const MARKER = "API-TEST-ROUTING";

/** Every routing key the contract defines. Presence is meaningful to the app. */
const ROUTING_KEYS = [
  "viewType", "deepLink", "clickAction", "screen", "params",
  "liveCourseId", "sessionId", "streamId",
] as const;

function testCustomerId(): number {
  const n = Number(process.env.MIGRATION_TEST_CUSTOMER_ID ?? "");
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error("MIGRATION_TEST_CUSTOMER_ID must be a real int ws_customer id");
  }
  return n;
}

const clearSeed = (customerId: number) =>
  db().notification.deleteMany({ where: { customerId, title: { startsWith: MARKER } } });

/**
 * Seed one row per routing mode, writing them the way the dispatcher does:
 * `deepLink` to its own column, everything else into the `data` blob as the
 * FCM-shaped strings (`params` JSON-encoded, ids as numeric strings).
 */
async function seed(customerId: number): Promise<void> {
  const now = new Date();
  const base = {
    customerId, broadcast: false, body: "b", type: "general",
    status: "sent", sentAt: now, createdAt: now, updatedAt: now,
  };
  const modeA = buildNotificationRouting({ kind: "content", entity: "course", id: 42 });
  const modeB = buildNotificationRouting({ kind: "screen", screen: "TestSeriesDetails", params: { seriesId: 1024 } });
  const modeC = buildNotificationRouting({ kind: "external", url: "https://websankul.com/blog/new-post" });
  const modeD = buildNotificationRouting({ kind: "dialog" });
  const live = buildNotificationRouting({ kind: "content", entity: "live-course", id: 15 });

  await db().notification.createMany({
    data: [
      { ...base, title: `${MARKER} A`, deepLink: modeA.deepLink ?? null, data: modeA.data as any },
      { ...base, title: `${MARKER} B`, deepLink: modeB.deepLink ?? null, data: modeB.data as any },
      { ...base, title: `${MARKER} C`, deepLink: modeC.deepLink ?? null, data: modeC.data as any },
      { ...base, title: `${MARKER} D`, deepLink: modeD.deepLink ?? null, data: modeD.data as any },
      {
        ...base, title: `${MARKER} LIVE`, deepLink: live.deepLink ?? null,
        // Mirrors modules/admin-live notifyBuyersOnStart.
        data: { ...live.data, sessionId: "9001", streamId: "stream_xyz", liveCourseId: "15" } as any,
      },
      { ...base, title: `${MARKER} PLAIN`, deepLink: null, data: {} as any },
    ],
  });
}

/** Fetch the seeded rows from the LIVE endpoint, keyed by title suffix. */
async function fetchSeeded(): Promise<Record<string, any>> {
  const token = await getCustomerToken();
  const json = await requestOk("GET", PATH, { token, query: { page: 1, limit: 50 } });
  const out: Record<string, any> = { __envelope: json };
  for (const n of (json.data as any[]) ?? []) {
    const title = String(n.title ?? "");
    if (title.startsWith(MARKER)) out[title.slice(MARKER.length + 1)] = n;
  }
  return out;
}

export async function runNotificationRoutingClientApiTests(): Promise<boolean> {
  const cid = (() => { try { return testCustomerId(); } catch { return 0; } })();
  let rows: Record<string, any> = {};

  return runTests("notification-routing (client)", [
    { name: "server healthz", fn: assertServerUp },
    { name: "module enabled in MIGRATION_MYSQL_MODULES", fn: () => requireMysqlModule("client-notification") },
    { name: "MIGRATION_TEST_CUSTOMER_ID is a real int customer id", fn: () => void testCustomerId() },

    {
      name: "seed one notification per routing mode",
      skip: config.skipWrite,
      fn: async () => {
        await clearSeed(cid);
        await seed(cid);
        rows = await fetchSeeded();
        const missing = ["A", "B", "C", "D", "LIVE", "PLAIN"].filter((k) => !rows[k]);
        if (missing.length) throw new Error(`seeded rows missing from the feed: ${missing.join(", ")}`);
      },
    },

    {
      name: "Mode A — deep link with a numeric SQL id in the path",
      skip: config.skipWrite,
      fn: () => {
        const a = rows.A;
        if (a.deepLink !== "com.gpscvideo.gpsc://course/42")
          throw new Error(`expected the course deep link, got ${JSON.stringify(a.deepLink)}`);
        for (const k of ["screen", "params", "viewType"]) {
          if (k in a) throw new Error(`Mode A must not carry \`${k}\``);
        }
      },
    },

    {
      name: "Mode B — screen + params, params decoded to a real object",
      skip: config.skipWrite,
      fn: () => {
        const b = rows.B;
        if (b.screen !== "TestSeriesDetails") throw new Error(`screen was ${JSON.stringify(b.screen)}`);
        // Stored FCM-style as a JSON string; the list API must hand back an object.
        if (!b.params || typeof b.params !== "object" || Array.isArray(b.params))
          throw new Error(`params must be an object, got ${JSON.stringify(b.params)}`);
        if (b.params.seriesId !== 1024) throw new Error(`params.seriesId was ${JSON.stringify(b.params.seriesId)}`);
        if ("deepLink" in b) throw new Error("a screen-only target must not carry a deepLink");
      },
    },

    {
      name: "Mode C — viewType=link + external URL",
      skip: config.skipWrite,
      fn: () => {
        const c = rows.C;
        if (c.viewType !== "link") throw new Error(`viewType was ${JSON.stringify(c.viewType)}`);
        if (c.deepLink !== "https://websankul.com/blog/new-post")
          throw new Error(`deepLink was ${JSON.stringify(c.deepLink)}`);
      },
    },

    {
      name: "Mode D — viewType=dialog with no destination",
      skip: config.skipWrite,
      fn: () => {
        const d = rows.D;
        if (d.viewType !== "dialog") throw new Error(`viewType was ${JSON.stringify(d.viewType)}`);
        for (const k of ["deepLink", "screen", "params"]) {
          if (k in d) throw new Error(`dialog-only must not carry \`${k}\``);
        }
      },
    },

    {
      name: "Live-now — live ids typed: SQL ids numeric, StreamOS token left a string",
      skip: config.skipWrite,
      fn: () => {
        const l = rows.LIVE;
        if (l.deepLink !== "com.gpscvideo.gpsc://live-course/15")
          throw new Error(`deepLink was ${JSON.stringify(l.deepLink)}`);
        // Persisted as strings (FCM constraint); surfaced as numbers because they are SQL ids.
        if (l.sessionId !== 9001) throw new Error(`sessionId should be numeric 9001, got ${JSON.stringify(l.sessionId)}`);
        if (l.liveCourseId !== 15) throw new Error(`liveCourseId should be numeric 15, got ${JSON.stringify(l.liveCourseId)}`);
        // streamId is a StreamOS token and may be non-numeric — never coerce it.
        if (l.streamId !== "stream_xyz") throw new Error(`streamId should stay a string, got ${JSON.stringify(l.streamId)}`);
      },
    },

    {
      name: "Plain announcement — zero routing keys, no null placeholders",
      skip: config.skipWrite,
      fn: () => {
        const p = rows.PLAIN;
        const present = ROUTING_KEYS.filter((k) => k in p);
        if (present.length)
          throw new Error(`unrouted notification leaked routing keys: ${present.join(", ")}`);
      },
    },

    {
      name: "raw `data` blob stays out of the feed (FCM-stringified duplicate)",
      skip: config.skipWrite,
      fn: () => {
        for (const key of ["A", "B", "LIVE", "PLAIN"]) {
          if ("data" in rows[key]) throw new Error(`row ${key} exposed the raw data blob`);
        }
      },
    },

    {
      name: "existing display fields + envelope unchanged",
      skip: config.skipWrite,
      fn: () => {
        const a = rows.A;
        for (const k of ["_id", "title", "body", "type", "isRead", "createdAt"]) {
          if (!(k in a)) throw new Error(`display field \`${k}\` disappeared from the feed`);
        }
        // Metadata that was never exposed must stay hidden.
        for (const k of ["customerId", "readAt", "broadcast", "status", "updatedAt"]) {
          if (k in a) throw new Error(`internal field \`${k}\` leaked into the feed`);
        }
        const env = rows.__envelope;
        if (!Array.isArray(env.data)) throw new Error("data must remain the list array");
        if (typeof (env as any).unreadCount !== "number") throw new Error("unreadCount disappeared");
        if (!(env as any).pagination) throw new Error("pagination envelope disappeared");
      },
    },

    {
      name: "cleanup — remove seeded notifications",
      skip: config.skipWrite,
      fn: async () => { await clearSeed(cid); },
    },
  ]);
}
