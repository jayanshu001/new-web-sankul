// Package catalog: row to DTO mapping (response shape is frozen).
import type { Package, PackageType } from "@prisma/client";
import type { PackageDto, PackageTypeDto } from "./catalog-package.types";

/** `ws_package_type` has no `order`/`active`; they are synthesized to keep the response shape. */
export const toPackageTypeDto = (row: PackageType): PackageTypeDto => ({
  _id: String(row.id),
  name: row.name,
  order: 0,
  active: true,
  createdAt: row.created_at ?? null,
  updatedAt: row.updated_at ?? null,
});

/**
 * `educator_id` exists in the DDL but not in the Prisma `Package` model (and is
 * NULL on every row), so it is emitted as `null`.
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
