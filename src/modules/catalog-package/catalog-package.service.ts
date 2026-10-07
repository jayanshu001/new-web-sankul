// Package catalog: package types and active package lookups.
import { catalogPackageRepository as repo } from "./catalog-package.repository";
import { toPackageDto, toPackageTypeDto } from "./catalog-package.transformer";
import type { PackageDto, PackageTypeDto } from "./catalog-package.types";

export const parsePackageId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** `ws_package_type` has no `order`/`active`, so every row is returned, ordered by name. */
export const listPackageTypes = async (
  opts: { search?: string; skip?: number; take?: number } = {}
): Promise<{ data: PackageTypeDto[]; total: number }> => {
  const [rows, total] = await Promise.all([
    repo.listPackageTypes(opts),
    repo.countPackageTypes({ search: opts.search }),
  ]);
  return { data: rows.map(toPackageTypeDto), total };
};

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
