/**
 * Confirm the `web` permission catalog is trimmed to the 5-action minimal spec —
 * in CODE (registry + route map), and if a DB is reachable, in `ws_permissions`.
 *
 *   npx tsx scripts/verify-web-permission-catalog.ts          # code + DB
 *   npx tsx scripts/verify-web-permission-catalog.ts --code   # code only (no DB)
 *
 * Exit code is non-zero if any ❌ check fails (safe to wire into CI). A "⏳ stale
 * rows" line is informational: it means the code is correct but the DB still holds
 * pre-cleanup rows — run `scripts/cleanup-web-permissions.ts --apply`.
 */
import { PrismaClient } from "@prisma/client";
import { RBAC_ROUTE_KEYS } from "../src/middlewares/rbacRouteMap";
import {
  PERMISSION_CATALOG,
  ALL_CATALOG_KEYS,
  catalogKeysForGuard,
} from "../src/admin/permission/permissions.catalog";

const CODE_ONLY = process.argv.includes("--code");
const CORE = new Set(["view", "create", "edit", "delete", "toggle-status"]);

async function main() {
  let failed = false;

  // ── CODE ───────────────────────────────────────────────────────────────────
  const web = PERMISSION_CATALOG.filter((m) => m.guard === "web");
  const badActions = web
    .flatMap((m) => m.permissions)
    .filter((p) => !CORE.has(p.action) || p.key.endsWith(".list"));
  const missing = [...RBAC_ROUTE_KEYS].filter((k) => !ALL_CATALOG_KEYS.has(k)).sort();
  const maxActions = Math.max(...web.map((m) => m.permissions.length));

  console.log("── CODE ─────────────────────────────");
  console.log(`web modules: ${web.length} | max actions/module: ${maxActions}`);
  if (badActions.length) {
    failed = true;
    console.log("❌ non-core / .list keys still in catalog:\n  " + badActions.map((p) => p.key).join("\n  "));
  } else {
    console.log("✅ every web module ≤5 core actions, no .list");
  }
  if (missing.length) {
    failed = true;
    console.log("❌ enforced-but-not-in-catalog (lockout risk):\n  " + missing.join("\n  "));
  } else {
    console.log("✅ every enforced route key exists in the catalog");
  }

  // ── DB ─────────────────────────────────────────────────────────────────────
  if (!CODE_ONLY) {
    const prisma = new PrismaClient();
    try {
      const rows = await prisma.adminPermissionRow.findMany({
        where: { guardName: "web" },
        select: { name: true },
      });
      const protectedKeys = new Set<string>([...catalogKeysForGuard("web"), ...RBAC_ROUTE_KEYS, "*"]);
      const stale = rows.map((r) => r.name).filter((n) => !protectedKeys.has(n)).sort();
      const dotList = rows.filter((r) => r.name.endsWith(".list")).length;

      console.log("\n── DB (ws_permissions, guard=web) ───");
      console.log(`total rows: ${rows.length} | .list rows: ${dotList}`);
      if (stale.length) {
        console.log(
          `⏳ ${stale.length} stale row(s) still in DB — run cleanup-web-permissions.ts --apply:\n  ` +
            stale.join("\n  ")
        );
      } else {
        console.log("✅ DB matches the catalog — no stale rows (cleanup already applied)");
      }
    } finally {
      await prisma.$disconnect();
    }
  }

  console.log(failed ? "\nRESULT: ❌ code is NOT fully aligned" : "\nRESULT: ✅ code aligned");
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
