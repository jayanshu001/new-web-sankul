/**
 * Customer address — MySQL (Prisma) branch types.
 *
 * NOTE ON CONTRACT DIVERGENCE (why this DTO differs from the Mongo one):
 * - Mongo stores `stateId`/`cityId` as ObjectIds and `.populate()`s them into
 *   nested `{ _id, name, ... }` objects; phones/pincode are strings; `label`
 *   is an enum (home|work|other).
 * - MySQL (`ws_customer_address`) stores `state`/`city_id` as integer FKs,
 *   `phone`/`alternate_phone` as BIGINT, `pincode` as INT, `label` as free
 *   VARCHAR(20). `city_id` references the (still-Mongo) OfflineCity id space.
 *
 * The MySQL DTO therefore returns **string ids** (to stay shape-compatible with
 * the Mongo `_id`/`stateId`/`cityId` string fields the client reads) and string
 * phones/pincode, but does NOT populate nested state/city objects. This module
 * is intentionally NOT enabled in `MIGRATION_MYSQL_MODULES` until OfflineCity +
 * cart checkout migrate (cart resolves `cityId` → `OfflineCity.name`).
 */

export interface AddressDto {
  _id: string;
  name: string;
  phone: string | null;
  alternatePhone: string | null;
  email: string | null;
  address: string;
  address2: string;
  /** Freeform city name — `city` column is NOT NULL and is what legacy data populates. */
  city: string;
  stateId: string | null;
  /** Numeric OfflineCity FK; NULL in legacy data (city name is used instead). */
  cityId: string | null;
  pincode: string;
  label: string | null;
  isDefault: boolean;
  customerId: string | null;
  status: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** Normalized create input (controller maps validated body → this). */
export interface AddressCreateInput {
  customerId: number;
  name: string;
  phone?: string | null;
  alternatePhone?: string | null;
  email?: string | null;
  address: string;
  address2?: string;
  /** Freeform city name (required — `city` column is NOT NULL). */
  city: string;
  stateId?: number | null;
  cityId?: number | null;
  pincode: string;
  label?: string | null;
  status?: boolean;
}

export type AddressUpdateInput = Partial<Omit<AddressCreateInput, "customerId">>;
