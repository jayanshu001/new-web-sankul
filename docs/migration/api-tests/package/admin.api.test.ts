import { config } from "../_lib/env.js";
import { getAdminToken, assertServerUp, requireMysqlModule } from "../_lib/auth.js";
import { requestOk } from "../_lib/http.js";
import { runTests } from "../_lib/runner.js";

/**
 * Package (admin) — `admin-package`.
 *
 * Exercises the admin package read surface + its route cache. `GET /admin/packages`
 * (ttl 120) and `GET /admin/packages/:id` (ttl 600) are tagged entity:"package";
 * the writes call autoFlushGroup("package"). The flush check toggles status and
 * confirms the change is visible on the next detail read (not stale until TTL).
 *
 * Every route requires a Bearer admin token.
 */

type PackageListItem = {
  _id?: string;
  name?: string;
  active?: boolean;
};

export async function runPackageAdminApiTests(): Promise<boolean> {
  let token = "";
  return runTests("package (admin)", [
    { name: "server healthz", fn: assertServerUp },
    { name: "module enabled in MIGRATION_MYSQL_MODULES", fn: () => requireMysqlModule("admin-package") },
    { name: "mint admin token", fn: async () => { token = await getAdminToken(); } },

    {
      name: "GET /api/v1/admin/packages → { data: [...], pagination } (cached list)",
      fn: async () => {
        const json = await requestOk("GET", "/api/v1/admin/packages", { token });
        const list = json.data as PackageListItem[];
        if (!Array.isArray(list)) throw new Error("expected data to be an array");
        if (!json.pagination) throw new Error("list response missing pagination envelope");
        for (const p of list) {
          if (!p._id || typeof p._id !== "string") throw new Error("package _id must be a non-empty string");
          if (typeof p.name !== "string") throw new Error("package missing string name");
        }
      },
    },
    {
      name: "GET /api/v1/admin/packages/types → cached package-type list",
      fn: async () => {
        const json = await requestOk("GET", "/api/v1/admin/packages/types", { token });
        if (!Array.isArray(json.data)) throw new Error("expected data array of package types");
      },
    },
    {
      name: "GET /api/v1/admin/packages/:id → detail matches the row from the list",
      fn: async () => {
        const list = (await requestOk("GET", "/api/v1/admin/packages", { token })).data as PackageListItem[];
        const first = list[0];
        if (!first?._id) throw new Error("no package id from list");

        const detail = (await requestOk("GET", `/api/v1/admin/packages/${first._id}`, { token })).data as PackageListItem;
        if (detail._id !== first._id) throw new Error("detail _id mismatch");
        if (detail.name !== first.name) throw new Error("detail name mismatch");
      },
    },
    {
      name: "PATCH /api/v1/admin/packages/:id/status → cache flush reflects the toggle on next read",
      skip: config.skipWrite,
      fn: async () => {
        const list = (await requestOk("GET", "/api/v1/admin/packages", { token })).data as PackageListItem[];
        const target = list.find((p) => p._id);
        if (!target?._id) throw new Error("no package to toggle");

        // Warm the detail cache, toggle status (autoFlushGroup("package") evicts it),
        // then read again — the active flip must be visible immediately.
        const before = (await requestOk("GET", `/api/v1/admin/packages/${target._id}`, { token })).data as PackageListItem;
        await requestOk("PATCH", `/api/v1/admin/packages/${target._id}/status`, { token });
        const after = (await requestOk("GET", `/api/v1/admin/packages/${target._id}`, { token })).data as PackageListItem;

        if (after.active === before.active) {
          throw new Error("active unchanged after toggle — stale cache not flushed");
        }

        // Restore original state (and flush again) so the run is idempotent.
        await requestOk("PATCH", `/api/v1/admin/packages/${target._id}/status`, { token });
      },
    },
  ]);
}
