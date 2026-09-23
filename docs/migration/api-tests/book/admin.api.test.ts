import { config } from "../_lib/env.js";
import { getAdminToken, assertServerUp, requireMysqlModule } from "../_lib/auth.js";
import { requestOk } from "../_lib/http.js";
import { runTests } from "../_lib/runner.js";

/**
 * Book (admin) — `admin-book`.
 *
 * Exercises the admin book read surface + its route cache. `GET /admin/books`
 * (ttl 120) and `GET /admin/books/:id` (ttl 600) are tagged entity:"book"; the
 * writes call autoFlushGroup("book") — so this proves the cache-flush contract:
 * a write (PATCH /:id/trending) must be reflected on the very next read.
 *
 * Every route requires a Bearer admin token.
 */

type BookListItem = {
  _id?: string;
  name?: string;
  isTrending?: boolean;
};

export async function runBookAdminApiTests(): Promise<boolean> {
  let token = "";
  return runTests("book (admin)", [
    { name: "server healthz", fn: assertServerUp },
    { name: "module enabled in MIGRATION_MYSQL_MODULES", fn: () => requireMysqlModule("admin-book") },
    { name: "mint admin token", fn: async () => { token = await getAdminToken(); } },

    {
      name: "GET /api/v1/admin/books → { data: [...], pagination } (cached list)",
      fn: async () => {
        const json = await requestOk("GET", "/api/v1/admin/books", { token });
        const list = json.data as BookListItem[];
        if (!Array.isArray(list)) throw new Error("expected data to be an array");
        if (!json.pagination) throw new Error("list response missing pagination envelope");
        for (const b of list) {
          if (!b._id || typeof b._id !== "string") throw new Error("book _id must be a non-empty string");
          if (typeof b.name !== "string") throw new Error("book missing string name");
        }
      },
    },
    {
      name: "GET /api/v1/admin/books?page=1&limit=10 → ≤ limit rows",
      fn: async () => {
        const json = await requestOk("GET", "/api/v1/admin/books", { token, query: { page: 1, limit: 10 } });
        const list = json.data as BookListItem[];
        if (!Array.isArray(list)) throw new Error("expected data array");
        if (list.length > 10) throw new Error(`limit=10 not honoured, got ${list.length} rows`);
      },
    },
    {
      name: "GET /api/v1/admin/books/:id → detail matches the row from the list",
      fn: async () => {
        const list = (await requestOk("GET", "/api/v1/admin/books", { token })).data as BookListItem[];
        const first = list[0];
        if (!first?._id) throw new Error("no book id from list (seed some books first)");

        const detail = (await requestOk("GET", `/api/v1/admin/books/${first._id}`, { token })).data as BookListItem;
        if (detail._id !== first._id) throw new Error("detail _id mismatch");
        if (detail.name !== first.name) throw new Error("detail name mismatch");
      },
    },
    {
      name: "PATCH /api/v1/admin/books/:id/trending → cache flush reflects the toggle on next read",
      skip: config.skipWrite,
      fn: async () => {
        const list = (await requestOk("GET", "/api/v1/admin/books", { token })).data as BookListItem[];
        const target = list.find((b) => b._id);
        if (!target?._id) throw new Error("no book to toggle");

        // Warm the detail cache, toggle (autoFlushGroup("book") should evict it),
        // then read again — the flip must be visible immediately, not after TTL.
        const before = (await requestOk("GET", `/api/v1/admin/books/${target._id}`, { token })).data as BookListItem;
        await requestOk("PATCH", `/api/v1/admin/books/${target._id}/trending`, { token });
        const after = (await requestOk("GET", `/api/v1/admin/books/${target._id}`, { token })).data as BookListItem;

        if (after.isTrending === before.isTrending) {
          throw new Error("isTrending unchanged after toggle — stale cache not flushed");
        }

        // Restore original state (and flush again) so the run is idempotent.
        await requestOk("PATCH", `/api/v1/admin/books/${target._id}/trending`, { token });
      },
    },
  ]);
}
