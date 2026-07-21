import { config } from "../_lib/env.js";
import { getAdminToken, assertServerUp, requireMysqlModule } from "../_lib/auth.js";
import { requestOk } from "../_lib/http.js";
import { runTests } from "../_lib/runner.js";

/**
 * eBook (admin) — `admin-ebook`.
 *
 * Exercises the admin ebook read surface, which is where the route-level response
 * cache lives (`GET /admin/ebooks` ttl 120s, `GET /admin/ebooks/:id` ttl 600s, both
 * tagged entity:"ebook" — see src/admin/ebook/ebook.routes.ts). Assertions cover the
 * list envelope (data[] + pagination), search + pagination params, detail-by-id shape,
 * and that a write (`PATCH /:id/trending`, which calls autoFlushGroup("ebook")) flushes
 * the cache so the next read reflects the change.
 *
 * Every route requires a Bearer admin token.
 */

type EbookListItem = {
  _id?: string;
  name?: string;
  isTrending?: boolean;
  language?: string;
};

export async function runEbookAdminApiTests(): Promise<boolean> {
  let token = "";
  return runTests("ebook (admin)", [
    { name: "server healthz", fn: assertServerUp },
    { name: "module enabled in MIGRATION_MYSQL_MODULES", fn: () => requireMysqlModule("admin-ebook") },
    { name: "mint admin token", fn: async () => { token = await getAdminToken(); } },

    {
      name: "GET /api/v1/admin/ebooks → { data: [...], pagination } (cached list)",
      fn: async () => {
        const json = await requestOk("GET", "/api/v1/admin/ebooks", { token });
        const list = json.data as EbookListItem[];
        if (!Array.isArray(list)) throw new Error("expected data to be an array");
        if (!json.pagination) throw new Error("list response missing pagination envelope");
        for (const e of list) {
          if (!e._id || typeof e._id !== "string") throw new Error("ebook _id must be a non-empty string");
          if (typeof e.name !== "string") throw new Error("ebook missing string name");
        }
      },
    },
    {
      name: "GET /api/v1/admin/ebooks?page=1&limit=10 → page honoured, ≤ limit rows",
      fn: async () => {
        const json = await requestOk("GET", "/api/v1/admin/ebooks", { token, query: { page: 1, limit: 10 } });
        const list = json.data as EbookListItem[];
        if (!Array.isArray(list)) throw new Error("expected data array");
        if (list.length > 10) throw new Error(`limit=10 not honoured, got ${list.length} rows`);
      },
    },
    {
      name: "GET /api/v1/admin/ebooks?search=DUMMY_SEED → matches seeded rows",
      fn: async () => {
        const json = await requestOk("GET", "/api/v1/admin/ebooks", { token, query: { search: "DUMMY_SEED" } });
        const list = json.data as EbookListItem[];
        if (!Array.isArray(list)) throw new Error("expected data array");
        for (const e of list) {
          if (!e.name?.includes("DUMMY_SEED")) throw new Error(`search returned non-matching row: ${e.name}`);
        }
      },
    },
    {
      name: "GET /api/v1/admin/ebooks/:id → detail matches the row from the list",
      fn: async () => {
        const list = (await requestOk("GET", "/api/v1/admin/ebooks", { token })).data as EbookListItem[];
        const first = list[0];
        if (!first?._id) throw new Error("no ebook id from list (seed some ebooks first)");

        const detail = (await requestOk("GET", `/api/v1/admin/ebooks/${first._id}`, { token })).data as EbookListItem;
        if (detail._id !== first._id) throw new Error("detail _id mismatch");
        if (detail.name !== first.name) throw new Error("detail name mismatch");
        if (typeof detail.language !== "string") throw new Error("detail missing language");
      },
    },
    {
      name: "PATCH /api/v1/admin/ebooks/:id/trending → cache flush reflects the toggle on next read",
      skip: config.skipWrite,
      fn: async () => {
        const list = (await requestOk("GET", "/api/v1/admin/ebooks", { token })).data as EbookListItem[];
        const target = list.find((e) => e._id);
        if (!target?._id) throw new Error("no ebook to toggle");

        // Warm the detail cache, then toggle (autoFlushGroup("ebook") should evict it).
        const before = (await requestOk("GET", `/api/v1/admin/ebooks/${target._id}`, { token })).data as EbookListItem;
        await requestOk("PATCH", `/api/v1/admin/ebooks/${target._id}/trending`, { token });
        const after = (await requestOk("GET", `/api/v1/admin/ebooks/${target._id}`, { token })).data as EbookListItem;

        if (after.isTrending === before.isTrending) {
          throw new Error("isTrending unchanged after toggle — stale cache not flushed");
        }

        // Restore original state (and flush again) so the run is idempotent.
        await requestOk("PATCH", `/api/v1/admin/ebooks/${target._id}/trending`, { token });
      },
    },
  ]);
}
