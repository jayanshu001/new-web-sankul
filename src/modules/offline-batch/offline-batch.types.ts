// Offline batches: center and batch DTO types.
/**
 * `ws_offline_batch` / `ws_offline_center` drift:
 *  - Neither table has a `status` column; every row is active and the DTO
 *    synthesizes `status: true` to keep the response shape stable.
 *  - `ws_offline_center.phone` is BIGINT (overflows Int32); the DTO returns a string.
 *  - `ws_offline_center.image` is a JSON array of URLs, exposed as `images`.
 *  - Batch column typo: `discription` → `description`.
 */

export interface OfflineCityRefDto {
  _id: string;
  name: string;
}

export interface OfflineBatchDto {
  _id: string;
  name: string;
  image: string;
  description: string;
  startAt: Date;
  duration: string;
  centerId: string;
  /** Synthesized `true` — `ws_offline_batch` has no status column. */
  status: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface OfflineCenterDto {
  _id: string;
  name: string;
  images: string[];
  address: string;
  latitude: number;
  longitude: number;
  /** SQL bigint, stringified. */
  phone: string;
  cityId: string;
  /** Synthesized `true` — `ws_offline_center` has no status column. */
  status: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface OfflineCenterWithBatchesDto extends OfflineCenterDto {
  batches: OfflineBatchDto[];
}

export interface OfflineCenterWithCityDto extends OfflineCenterDto {
  city: OfflineCityRefDto | null;
}
