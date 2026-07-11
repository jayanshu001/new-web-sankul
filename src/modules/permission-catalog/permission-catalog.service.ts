import { prisma } from "../../config/prisma";

/**
 * SQL home for the permissions CATALOG read path (catalog.controller).
 *
 * The catalog itself (modules/keys) is a static registry in code
 * (permissions.catalog.ts); the only DB read is "which permission names exist
 * in the table", used to surface deprecated keys. That read maps cleanly to
 * ws_permissions (prisma.adminPermissionRow). id is BigInt but we only read
 * `name`, so no stringification of ids is required here.
 */
export const PERMISSION_CATALOG_MODULE = "permission-catalog";

export const isPermissionCatalogMysql = (): boolean => true;

/**
 * Distinct permission names currently stored in ws_permissions. Pass `guard` to
 * restrict to one guard (used by the guard-scoped catalog endpoint so the
 * deprecated set for a promoter role only reflects promoter-guard rows).
 */
export const getStoredPermissionNames = async (guard?: string): Promise<string[]> => {
  const rows = await prisma.adminPermissionRow.findMany({
    where: guard ? { guardName: guard } : undefined,
    select: { name: true },
  });
  return rows.map((r) => r.name);
};
