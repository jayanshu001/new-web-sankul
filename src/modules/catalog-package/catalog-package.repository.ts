import { prisma } from "../../config/prisma";

/**
 * Prisma persistence for the catalog · package MySQL branch.
 *
 *  - `ws_package_type` reads back the package-type lookup (Phase A, enabled via
 *    `catalog-package-type`).
 *  - `ws_package` reads back active packages (Phase B, built but gated OFF via
 *    `catalog-package`). Only physically-present columns are selected; see
 *    catalog-package.types.ts for the field/commerce-scope gap.
 */
export const catalogPackageRepository = {
  // ── package_type (ws_package_type) ───────────────────────────────────────
  /**
   * All package types, ordered by name (the SQL table has no `order` column;
   * the Mongo path sorted `{order:1, name:1}` — with no order we fall back to
   * name, then id for stability).
   */
  listPackageTypes: () =>
    prisma.packageType.findMany({
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),

  // ── package (ws_package) — Phase B, flag OFF ─────────────────────────────
  /** Single active package by id. */
  findPackageById: (id: number) =>
    prisma.package.findFirst({ where: { id, active: true } }),

  /** Active packages, ordered by `order_by` then id. Optional name search. */
  listActivePackages: (opts?: { search?: string }) =>
    prisma.package.findMany({
      where: {
        active: true,
        ...(opts?.search ? { name: { contains: opts.search } } : {}),
      },
      orderBy: [{ order_by: "asc" }, { id: "desc" }],
    }),

  /** Active packages for a given package type. */
  listActivePackagesByType: (packageTypeId: number) =>
    prisma.package.findMany({
      where: { active: true, packageTypeId },
      orderBy: [{ order_by: "asc" }, { id: "desc" }],
    }),
};
