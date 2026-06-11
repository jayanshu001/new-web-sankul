/**
 * Catalog · Package service — dual-path (MySQL/Prisma ↔ Mongo/Mongoose).
 *
 * Two independently-gated sub-modules share this dir:
 *
 *  - `catalog-package-type`  (Phase A — ENABLED): `ws_package_type` lookup. Zero
 *    coupling, 6 rows, pure metadata. Safe to flip on its own.
 *
 *  - `catalog-package`       (Phase B — flag OFF): `ws_package` reads. Built
 *    dual-path but kept OFF because the full `/client/packages` contract cannot
 *    be reproduced from `ws_package` alone this wave — the SQL table lacks the
 *    Mongo-only catalog fields and every endpoint joins commerce-wave tables
 *    (plans/subscriptions/promo/chat). Flips WITH the commerce wave.
 *    See docs/migration/CATALOG_MODULE_SCOPE.md.
 */
import { isMysqlModule } from "../../config/migration";
import { catalogPackageRepository as repo } from "./catalog-package.repository";
import { toPackageDto, toPackageTypeDto } from "./catalog-package.transformer";
import type { PackageDto, PackageTypeDto } from "./catalog-package.types";

export const PACKAGE_TYPE_MODULE = "catalog-package-type";
export const PACKAGE_MODULE = "catalog-package";

/** Phase A — the package-type lookup branch (enabled). */
export const isPackageTypeMysql = (): boolean => isMysqlModule(PACKAGE_TYPE_MODULE);

/** Phase B — the ws_package read branch (kept OFF until commerce wave). */
export const isPackageMysql = (): boolean => isMysqlModule(PACKAGE_MODULE);

/** Parse a string id to a positive int, else null. */
export const parsePackageId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// ── Phase A: package_type ───────────────────────────────────────────────────

/**
 * All package types in the Mongo `listPackageTypes` order/shape. The SQL table
 * has no `order`/`active`, so all rows are returned (active) ordered by name.
 */
export const listPackageTypes = async (): Promise<PackageTypeDto[]> => {
  const rows = await repo.listPackageTypes();
  return rows.map(toPackageTypeDto);
};

// ── Phase B: package (flag OFF) ─────────────────────────────────────────────

export const findPackageById = async (id: number): Promise<PackageDto | null> => {
  const row = await repo.findPackageById(id);
  return row ? toPackageDto(row) : null;
};

export const listActivePackages = async (search?: string): Promise<PackageDto[]> => {
  const rows = await repo.listActivePackages({ search: search?.trim() || undefined });
  return rows.map(toPackageDto);
};

export const listActivePackagesByType = async (packageTypeId: number): Promise<PackageDto[]> => {
  const rows = await repo.listActivePackagesByType(packageTypeId);
  return rows.map(toPackageDto);
};
