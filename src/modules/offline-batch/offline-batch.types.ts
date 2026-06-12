/**
 * Offline · Batch/Center (READ) — MySQL (Prisma) branch types.
 *
 * Tables: `ws_offline_center` (3) + `ws_offline_batch` (3) (flag OFF). The
 * offline-coaching browse surface (centers, batches, the offline dashboard).
 * Cities live in the already-migrated `offline-city` module.
 *
 * ⚠ SCOPE — READ only. `submitEnquiry` (POST) writes `ws_offline_enquiry`
 * (customer enquiry) — a WRITE path, NOT built this pass.
 *
 * SCHEMA-DRIFT / FIELD NOTES (verified against the live DDL 2026-06-12):
 *
 *  - **NO `status` column on `ws_offline_batch` OR `ws_offline_center`** — but
 *    the Mongo models have `status: boolean` and every handler filters
 *    `{status:true}`. The Prisma `OfflineBatch.status` field was PHANTOM (mapped
 *    nothing) → removed. The MySQL branch treats ALL rows as active and
 *    synthesizes `status: true` in the DTO to keep the response shape stable.
 *  - **`OfflineCenter.phone` is `bigint`** (e.g. 9099665555 overflows Int32) but
 *    Prisma typed it `Int` → would THROW on read. Fixed to `BigInt`; the DTO
 *    surfaces it as a STRING (the Mongo model stores phone as a string).
 *  - **`ws_offline_center.image` is a JSON column** (array of URLs). The Mongo
 *    model exposes it as `images: string[]` → the DTO maps the JSON array to
 *    `images`.
 *  - **SQL column typo:** batch `discription` (sic) → Mongo `description`.
 *  - **`OfflineEnquiry.mobile`** also `bigint` (fixed Int→BigInt) + added its
 *    `created_at` — for when the enquiry WRITE path is built later.
 *
 * Ids are returned as strings to stay Mongo `_id`-shape compatible.
 */

/** A nested city ref on a center ({_id, name}), Mongo-populate-shaped. */
export interface OfflineCityRefDto {
  _id: string;
  name: string;
}

/** `ws_offline_batch` row → DTO (Mongo `OfflineBatch`-shaped). */
export interface OfflineBatchDto {
  _id: string;
  name: string;
  image: string;
  /** Mongo `description` ← SQL `discription` (column typo). */
  description: string;
  startAt: Date;
  duration: string;
  centerId: string;
  /** Synthesized `true` — `ws_offline_batch` has no status column. */
  status: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** `ws_offline_center` row → DTO (Mongo `OfflineCenter`-shaped). */
export interface OfflineCenterDto {
  _id: string;
  name: string;
  /** Mongo `images: string[]` ← SQL `image` JSON array. */
  images: string[];
  address: string;
  latitude: number;
  longitude: number;
  /** Mongo stores phone as a string; SQL is bigint → stringified. */
  phone: string;
  cityId: string;
  /** Synthesized `true` — `ws_offline_center` has no status column. */
  status: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** A center with its active batches nested (listCentersByCity / dashboard shape). */
export interface OfflineCenterWithBatchesDto extends OfflineCenterDto {
  batches: OfflineBatchDto[];
}

/** A center with the city ref populated (listCenters / detail shape). */
export interface OfflineCenterWithCityDto extends OfflineCenterDto {
  city: OfflineCityRefDto | null;
}
