import { assertServerUp, getCustomerToken } from "../_lib/auth.js";
import { requestOk, requestExpectStatus } from "../_lib/http.js";
import { runTests } from "../_lib/runner.js";
import { config } from "../_lib/env.js";

/**
 * Catalog · Material (`catalog-material`) — category NAVIGATION surface.
 *
 * WIRED behind `isMaterialMysql()` (flag OFF):
 * `GET /client/material-categories/:id/children` reproduces the Mongo
 * `listMaterialCategoryChildren` from `ws_material_category` (children via the
 * SQL `parent` self-FK) + `ws_material` (per-child active count). The MySQL data
 * path is proven via tsx.
 *
 * SCOPE: the material ITEM listing (`/material-categories/:id/materials`) is NOT
 * migrated — its entitlement helper joins LiveCourse + Mongo-only embedded
 * `materialCategories[]` arrays. Only navigation is reproducible from SQL.
 *
 * Route requires a Bearer token. Note: the parent id differs between the Mongo
 * (ObjectId) and MySQL (int 270) paths, so the MySQL-specific assertion is
 * flag-gated; the always-on test only checks the error contract for a bad id.
 */

const materialMysql = config.mysqlModules.includes("catalog-material");

export async function runCatalogMaterialClientApiTests(): Promise<boolean> {
  let token = "";
  return runTests("catalog-material (client)", [
    { name: "server healthz", fn: assertServerUp },
    { name: "mint customer token", fn: async () => { token = await getCustomerToken(); } },

    {
      name: "GET /material-categories/:id/children with a bad id → 400 (contract holds either path)",
      fn: async () => {
        await requestExpectStatus("GET", "/api/v1/client/material-categories/not-an-id/children", 400, { token });
      },
    },
    {
      name: "[catalog-material ON] /material-categories/270/children → parent + children w/ count + havingChildDirectory",
      skip: !materialMysql,
      fn: async () => {
        const data = (await requestOk("GET", "/api/v1/client/material-categories/270/children", { token })).data as any;
        if (!data?.parent || data.parent._id !== "270") throw new Error("expected parent category 270");
        if (!Array.isArray(data.list)) throw new Error("expected list[]");
        // staging: category 270 has exactly one active child (1867 'test').
        const child = data.list.find((x: any) => x.category?._id === "1867");
        if (!child) throw new Error("expected child category 1867");
        if (typeof child.category.count !== "number") throw new Error("child missing numeric count");
        if (typeof child.category.havingChildDirectory !== "boolean") throw new Error("child missing havingChildDirectory");
      },
    },
  ]);
}
