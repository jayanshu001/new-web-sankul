import { assertServerUp, requireMysqlModule } from "../_lib/auth.js";
import { requestOk } from "../_lib/http.js";
import { runTests } from "../_lib/runner.js";

/**
 * offline-city (client) — cities served from MySQL (ws_offline_city) via
 * src/client/address/address.controller.ts `listCities` when `offline-city` is
 * enabled. Public endpoint (no auth). Scope: cities only.
 */

type City = { _id?: string; name?: string; image?: string; status?: boolean; order?: number };

export async function runOfflineCityClientApiTests(): Promise<boolean> {
  return runTests("offline-city (client)", [
    { name: "server healthz", fn: assertServerUp },
    { name: "module enabled in MIGRATION_MYSQL_MODULES", fn: () => requireMysqlModule("offline-city") },

    {
      name: "GET /api/v1/client/address/cities → array of active cities (order, then name)",
      fn: async () => {
        const json = await requestOk("GET", "/api/v1/client/address/cities");
        const list = json.data as City[];
        if (!Array.isArray(list)) throw new Error("expected an array of cities");
        if (!list.length) throw new Error("expected at least one active city (staging has 2)");
        for (const c of list) {
          if (!c._id || typeof c._id !== "string") throw new Error("city _id must be a non-empty string");
          if (!c.name) throw new Error("city missing name");
          if (c.status === false) throw new Error("inactive city leaked into list (status filter broken)");
        }
        // Ordering: non-decreasing `order`.
        for (let i = 1; i < list.length; i++) {
          if ((list[i - 1].order ?? 0) > (list[i].order ?? 0))
            throw new Error("cities not sorted by order");
        }
      },
    },

    {
      name: "GET /api/v1/client/address/cities?search=<known> → filtered subset",
      fn: async () => {
        const all = (await requestOk("GET", "/api/v1/client/address/cities")).data as City[];
        if (!all.length) return;
        const term = all[0].name!.slice(0, 3);
        const filtered = (await requestOk("GET", "/api/v1/client/address/cities", { query: { search: term } }))
          .data as City[];
        if (!Array.isArray(filtered)) throw new Error("search must return an array");
        if (filtered.length > all.length) throw new Error("search returned more rows than the full list");
        for (const c of filtered) {
          if (!c.name?.toLowerCase().includes(term.toLowerCase()))
            throw new Error(`search result "${c.name}" does not match term "${term}"`);
        }
      },
    },
  ]);
}
