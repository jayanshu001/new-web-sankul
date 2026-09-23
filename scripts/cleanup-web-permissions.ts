/**
 * Prune legacy / non-catalog permission rows from the `web` guard.
 *
 * WHY: `GET /admin/permissions/catalog?guard=web` renders ENTIRELY from
 * `ws_permissions` rows (see modules/permission-catalog/permission-catalog.service.ts),
 * NOT from the in-code registry. The boot seeder only ever INSERTS catalog keys;
 * it never deletes. So keys left over from before the registry-driven catalog —
 * plus the one module intentionally dropped from the catalog on 2026-07-20
 * (`customer-masters.states`) — still sit in the table and still bloat the API
 * response (the 661-key clutter reported in
 * docs/backend-requests/permission-catalog-keep-list-web-guard.md).
 *
 * WHAT IS SAFE TO DELETE: a `web`-guard permission row is deletable iff its name
 * is NOT in the union of:
 *   1. the live in-code catalog for the `web` guard (catalogKeysForGuard("web")),
 *   2. every key the backend enforces on a route (RBAC_ROUTE_KEYS from
 *      middlewares/rbacRouteMap.ts) — deleting one of these would make the mapped
 *      route deny all non-super-admins once RBAC_ENFORCE flips on, and
 *   3. the "*" super-admin wildcard (role-based, never in the catalog).
 * This is the "safe subset" reconciliation: it removes only rows nothing seeds
 * and nothing gates. Modules the frontend keep-list omits but the backend still
 * enforces (e.g. courses.plans, live-courses.*, inquiries) are PROTECTED here and
 * are left in place on purpose — see the reconciliation response doc.
 *
 * Deleting a permission also unassigns it from every role (ws_role_has_permissions)
 * and every directly-granted admin (ws_model_has_permissions) first, so no dangling
 * grant rows remain.
 *
 *   npx tsx scripts/cleanup-web-permissions.ts            # dry run (default)
 *   npx tsx scripts/cleanup-web-permissions.ts --apply    # delete + unassign
 */
import { PrismaClient } from "@prisma/client";
import { catalogKeysForGuard } from "../src/admin/permission/permissions.catalog";
import { RBAC_ROUTE_KEYS } from "../src/middlewares/rbacRouteMap";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const GUARD = "web";

const run = async () => {
  // Protected = live catalog ∪ enforced route keys ∪ super-admin wildcard.
  const protectedKeys = new Set<string>([
    ...catalogKeysForGuard(GUARD),
    ...RBAC_ROUTE_KEYS,
    "*",
  ]);

  const rows = await prisma.adminPermissionRow.findMany({
    where: { guardName: GUARD },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  console.log(`ws_permissions (guard=${GUARD}) rows: ${rows.length}`);
  console.log(`Protected keys: ${protectedKeys.size} (catalog ∪ route-map ∪ "*")`);

  const deletable = rows.filter((r) => !protectedKeys.has(r.name));
  console.log(`Deletable (non-catalog, non-enforced): ${deletable.length}\n`);
  if (!deletable.length) return console.log("Nothing to clean.");

  for (const r of deletable) console.log(`  - ${r.name}`);

  const ids = deletable.map((r) => r.id);

  // Count the grant rows that would be unassigned, for the operator's confidence.
  const [roleGrants, modelGrants] = await Promise.all([
    prisma.adminRoleHasPermission.count({ where: { permissionId: { in: ids } } }),
    prisma.adminModelHasPermission.count({ where: { permissionId: { in: ids } } }),
  ]);
  console.log(
    `\nGrants to unassign — roles: ${roleGrants}, direct admin grants: ${modelGrants}`
  );

  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to delete the above and unassign.");
    return;
  }

  // Unassign first (FK-free Spatie pivots, but order keeps intent clear), then
  // delete the permission rows themselves. All in one transaction.
  await prisma.$transaction([
    prisma.adminRoleHasPermission.deleteMany({ where: { permissionId: { in: ids } } }),
    prisma.adminModelHasPermission.deleteMany({ where: { permissionId: { in: ids } } }),
    prisma.adminPermissionRow.deleteMany({ where: { id: { in: ids } } }),
  ]);
  console.log(
    `\n✓ Deleted ${ids.length} permission row(s); unassigned ${roleGrants} role + ${modelGrants} direct grant(s).`
  );
};

run()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
