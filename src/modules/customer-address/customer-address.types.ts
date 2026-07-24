/**
 * Customer address — MySQL (Prisma) branch types.
 *
 * NOTE ON CONTRACT DIVERGENCE (why this DTO differs from the Mongo one):
 * - Mongo stored `stateId` as an ObjectId and `.populate()`d it into a nested
 *   `{ _id, name, ... }` object; phones/pincode were strings; `label` was an
 *   enum (home|work|other).
 * - MySQL (`ws_customer_address`) stores `state` as an integer FK,
 *   `phone`/`alternate_phone` as BIGINT, `pincode` as INT, `label` as free
 *   VARCHAR(20). The city is stored as a plain **name string** (`city` column) —
 *   there is no city id reference.
 *
 * The MySQL DTO therefore returns **string ids** (to stay shape-compatible with
 * the Mongo `_id`/`stateId` string fields the client reads) and string
 * phones/pincode, but does NOT populate a nested state object.
 */

export interface AddressDto {
  _id: string;
  name: string;
  phone: string | null;
  alternatePhone: string | null;
  email: string | null;
  address: string;
  address2: string;
  /** Freeform city name — `city` column is NOT NULL. */
  city: string;
  stateId: string | null;
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
  pincode: string;
  label?: string | null;
  status?: boolean;
}

export type AddressUpdateInput = Partial<Omit<AddressCreateInput, "customerId">>;
