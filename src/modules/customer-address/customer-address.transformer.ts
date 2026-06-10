import type { CustomerAddress } from "@prisma/client";
import type { AddressDto } from "./customer-address.types";

/** Stringify a BigInt/number phone column, preserving null. */
const phoneStr = (v: bigint | number | null): string | null =>
  v === null || v === undefined ? null : String(v);

/** Stringify an int FK, preserving null (keeps the Mongo `_id`-string shape). */
const idStr = (v: number | null): string | null =>
  v === null || v === undefined ? null : String(v);

export const toAddressDto = (row: CustomerAddress): AddressDto => ({
  _id: String(row.id),
  name: row.name,
  phone: phoneStr(row.phone),
  alternatePhone: phoneStr(row.alternate_phone),
  email: row.email ?? null,
  address: row.address,
  address2: row.address_2 ?? "",
  city: row.city,
  stateId: idStr(row.state),
  cityId: idStr(row.cityId),
  pincode: String(row.pincode),
  label: row.label ?? null,
  isDefault: row.isDefault ?? false,
  customerId: idStr(row.userId),
  status: row.status ?? true,
  createdAt: row.created_at ?? null,
  updatedAt: row.updated_at ?? null,
});
