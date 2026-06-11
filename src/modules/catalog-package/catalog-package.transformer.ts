import type { Package, PackageType } from "@prisma/client";
import type { PackageDto, PackageTypeDto } from "./catalog-package.types";

/**
 * `ws_package_type` row → DTO. The SQL table lacks `order`/`active` (the Mongo
 * model had them); synthesize `order: 0` + `active: true` so the response JSON
 * stays shape-compatible with the Mongo `listPackageTypes` contract.
 */
export const toPackageTypeDto = (row: PackageType): PackageTypeDto => ({
  _id: String(row.id),
  name: row.name,
  order: 0,
  active: true,
  createdAt: row.created_at ?? null,
  updatedAt: row.updated_at ?? null,
});

/**
 * `ws_package` row → DTO (Phase B, flag OFF). Only maps columns that physically
 * exist in `ws_package`. NOTE: `educator_id` exists in the DDL but is absent
 * from the Prisma `Package` model (and is NULL for every current row), so it is
 * surfaced as `null` here — add it to the Prisma model + regen if a consumer
 * ever needs it. The Mongo-only catalog fields and all commerce joins are
 * intentionally NOT produced here (see catalog-package.types.ts scope note).
 */
export const toPackageDto = (row: Package): PackageDto => ({
  _id: String(row.id),
  name: row.name,
  description: row.description,
  image: row.image,
  shareableLink: row.shareable_link ?? null,
  withMaterial: row.withMaterial,
  withoutMaterial: row.withoutMaterial,
  packageTypeId: row.packageTypeId != null ? String(row.packageTypeId) : null,
  examId: row.examId != null ? String(row.examId) : null,
  educatorId: null,
  pcMaterialId: row.pcMaterialId != null ? String(row.pcMaterialId) : null,
  order: row.order_by,
  active: row.active,
  createdAt: row.created_at ?? null,
  updatedAt: row.updated_at ?? null,
});
