import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";

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
  listPackageTypes: (opts?: { search?: string; skip?: number; take?: number }) =>
    prisma.packageType.findMany({
      where: buildPrismaSearch(opts?.search, ["name"]) ?? {},
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: opts?.skip,
      take: opts?.take,
    }),

  /** Count of package types matching the (optional) name search. */
  countPackageTypes: (opts?: { search?: string }) =>
    prisma.packageType.count({
      where: buildPrismaSearch(opts?.search, ["name"]) ?? {},
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
        ...(buildPrismaSearch(opts?.search, ["name"]) ?? {}),
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
