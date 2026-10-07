// Package catalog: DTO types.
export interface PackageTypeDto {
  _id: string;
  name: string;
  /** Synthesized: `ws_package_type` has no `order` column. */
  order: number;
  /** Synthesized `true`: `ws_package_type` has no status column. */
  active: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** Only columns that physically exist in `ws_package`; commerce joins are composed elsewhere. */
export interface PackageDto {
  _id: string;
  name: string;
  description: string;
  image: string;
  shareableLink: string | null;
  withMaterial: string;
  withoutMaterial: string;
  packageTypeId: string | null;
  examId: string | null;
  educatorId: string | null;
  pcMaterialId: string | null;
  order: number;
  active: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}
