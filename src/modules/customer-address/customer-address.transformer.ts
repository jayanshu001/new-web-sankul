import type { CustomerAddress } from "@prisma/client";
import type { AddressDto } from "./customer-address.types";

/**
 * Stringify a BigInt/number phone column, preserving null.
 * `phone` is NOT NULL in MySQL, so rows saved before contact fields were
 * required carry the `0` sentinel — surface that as `null` so the client can
 * prefill from the profile instead of rendering "0".
 */
const phoneStr = (v: bigint | number | null): string | null =>
  v === null || v === undefined || Number(v) === 0 ? null : String(v);

/** Stringify an int FK, preserving null (keeps the Mongo `_id`-string shape). */
const idStr = (v: number | null): string | null =>
  v === null || v === undefined ? null : String(v);

export const toAddressDto = (row: CustomerAddress): AddressDto => ({
  _id: String(row.id),
  name: row.name,
  phone: phoneStr(row.phone),
  alternatePhone: phoneStr(row.alternate_phone),
  // `email` is NOT NULL too — the legacy empty-string sentinel becomes null for
  // the same prefill reason as `phone` above.
  email: row.email ? row.email : null,
  address: row.address,
  address2: row.address_2 ?? "",
  city: row.city,
  stateId: idStr(row.state),
  pincode: String(row.pincode),
  label: row.label ?? null,
  isDefault: row.isDefault ?? false,
  customerId: idStr(row.userId),
  status: row.status ?? true,
  createdAt: row.created_at ?? null,
  updatedAt: row.updated_at ?? null,
});
