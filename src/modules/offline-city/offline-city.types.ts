/**
 * Offline city — MySQL (Prisma) branch types.
 *
 * Table `ws_offline_city`. Scope: cities only (the minimum to unblock
 * `customer-address`, whose `cityId` → OfflineCity and which cart checkout
 * resolves to a city name). Centers/batches/enquiry/admin remain on Mongo for a
 * later offline pass.
 *
 * Decision (D1): `status` + `order` columns were ADDED to the live MySQL DDL to
 * preserve the Mongo active-gating + manual ordering behavior.
 *
 * Ids returned as strings to stay Mongo `_id`-shape compatible.
 */

export interface CityDto {
  _id: string;
  name: string;
  image: string;
  status: boolean;
  order: number;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** Minimal name lookup (cart `cityId` → name resolution). */
export interface CityNameDto {
  _id: string;
  name: string;
}
