import { assertServerUp, getCustomerToken } from "../_lib/auth.js";
import { requestOk } from "../_lib/http.js";
import { runTests } from "../_lib/runner.js";
import { config } from "../_lib/env.js";

/**
 * Catalog (client) — package / course / video read backbone.
 *
 * IMPORTANT: all four catalog keys (`catalog-package-type`, `catalog-package`,
 * `catalog-course`, `catalog-video`) are currently **flag OFF** (int-vs-ObjectId
 * id coupling with still-Mongo consumers + commerce-wave joins; see
 * docs/migration/CATALOG_MODULE_SCOPE.md). Their data paths are verified against
 * the live DB via tsx, and the video URL-encryption contract has a fixed-token
 * parity test. So these HTTP tests:
 *   - ALWAYS assert the served endpoint contract holds (whichever path serves),
 *   - assert MySQL-source specifics ONLY when the relevant flag is enabled
 *     (`skip` otherwise), so the suite is green + informative either way.
 *
 * Both endpoints require a Bearer token (packages/courses routers `authenticate`).
 */

type PackageType = { _id?: string; name?: string; order?: number; active?: boolean };
type CourseCategory = { _id?: string; title?: string; courseCount?: number; status?: boolean };

const pkgTypeMysql = config.mysqlModules.includes("catalog-package-type");
const courseMysql = config.mysqlModules.includes("catalog-course");
const videoMysql = config.mysqlModules.includes("catalog-video");

export async function runCatalogClientApiTests(): Promise<boolean> {
  let token = "";
  return runTests("catalog (client)", [
    { name: "server healthz", fn: assertServerUp },
    { name: "mint customer token", fn: async () => { token = await getCustomerToken(); } },

    // ── package_type (GET /client/packages/types) ──────────────────────────
    {
      name: "GET /api/v1/client/packages/types → array of { _id, name }",
      fn: async () => {
        const list = (await requestOk("GET", "/api/v1/client/packages/types", { token })).data as PackageType[];
        if (!Array.isArray(list)) throw new Error("expected an array of package types");
        if (!list.length) throw new Error("expected at least one package type (staging has 6)");
        for (const t of list) {
          if (!t._id || typeof t._id !== "string") throw new Error("package type _id must be a non-empty string");
          if (!t.name) throw new Error("package type missing name");
        }
      },
    },
    {
      name: "[catalog-package-type ON] /packages/types serves 6 MySQL rows with synthesized order/active",
      skip: !pkgTypeMysql,
      fn: async () => {
        const list = (await requestOk("GET", "/api/v1/client/packages/types", { token })).data as PackageType[];
        if (list.length !== 6) throw new Error(`expected 6 MySQL package types, got ${list.length}`);
        for (const t of list) {
          if (t.order !== 0) throw new Error("MySQL branch must synthesize order:0");
          if (t.active !== true) throw new Error("MySQL branch must synthesize active:true");
        }
      },
    },

    // ── course subject categories (GET /client/courses/categories) ─────────
    {
      name: "GET /api/v1/client/courses/categories → array of { _id, title, courseCount }",
      fn: async () => {
        const list = (await requestOk("GET", "/api/v1/client/courses/categories", { token })).data as CourseCategory[];
        if (!Array.isArray(list)) throw new Error("expected an array of course categories");
        for (const c of list) {
          if (!c._id || typeof c._id !== "string") throw new Error("category _id must be a non-empty string");
          if (!c.title) throw new Error("category missing title");
          if (typeof c.courseCount !== "number") throw new Error("category missing numeric courseCount");
          if (c.status === false) throw new Error("inactive category leaked (status filter broken)");
        }
      },
    },
    {
      name: "[catalog-course ON] /courses/categories serves MySQL rows with groupBy counts",
      skip: !courseMysql,
      fn: async () => {
        const list = (await requestOk("GET", "/api/v1/client/courses/categories", { token })).data as CourseCategory[];
        if (!list.length) throw new Error("expected ≥1 MySQL course category (staging has 1: 'test')");
        const test = list.find((c) => c.title === "test");
        if (!test) throw new Error("expected the staging 'test' category");
        if ((test.courseCount ?? 0) < 1) throw new Error("expected courseCount ≥ 1 for 'test' (groupBy)");
      },
    },

    // ── course listing (GET /client/courses) — composed w/ plans + purchase ─
    {
      name: "GET /api/v1/client/courses → { data[], pagination } with plans buckets",
      fn: async () => {
        const body = (await requestOk("GET", "/api/v1/client/courses?limit=10", { token })) as any;
        if (!Array.isArray(body.data)) throw new Error("expected data[] of courses");
        if (!body.pagination || typeof body.pagination.total !== "number")
          throw new Error("expected pagination.total");
        for (const c of body.data) {
          if (!c._id || typeof c._id !== "string") throw new Error("course _id must be a non-empty string");
          if (!c.plans || !Array.isArray(c.plans.withMaterial) || !Array.isArray(c.plans.withoutMaterial))
            throw new Error("course missing plans.{withMaterial,withoutMaterial}");
          if (typeof c.isPurchased !== "boolean") throw new Error("course missing boolean isPurchased");
        }
      },
    },
    {
      name: "[catalog-course ON] /courses serves MySQL composition (isPopular/isPaid + plans split + purchase state)",
      skip: !courseMysql,
      fn: async () => {
        const body = (await requestOk("GET", "/api/v1/client/courses?limit=10", { token })) as any;
        const test = body.data.find((c: any) => String(c.name).toLowerCase() === "test" || c._id === "75");
        if (!test) throw new Error("expected the staging course (id 75 / 'test')");
        if (typeof test.isPopular !== "boolean" || typeof test.isPaid !== "boolean")
          throw new Error("MySQL course must surface isPopular + isPaid (from is_featured/purchase enums)");
        // staging course 75: 5 plans, all without_material.
        if (test.plans.withoutMaterial.length < 1)
          throw new Error("expected withoutMaterial plans for course 75 (commerce-price composition)");
      },
    },

    // ── video URL-encryption contract (no wired endpoint; flag OFF) ────────
    {
      name: "[catalog-video] URL-encryption parity verified via tsx (no standalone HTTP endpoint)",
      skip: true, // informational: video has no safe standalone video-URL endpoint to flip; parity proven in tsx
      fn: () => { /* see docs/MIGRATION_QUERY_CHANGES.md 2026-06-11 video entry */ },
    },
  ]);
}

// Surface flag state in the run header for clarity.
void videoMysql;
