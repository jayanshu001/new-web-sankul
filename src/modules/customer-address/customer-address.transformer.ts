// Customer addresses: row to DTO mapping (response shape is frozen).
import type { CustomerAddress } from "@prisma/client";
import type { AddressDto } from "./customer-address.types";

/**
 * `phone` is NOT NULL, so older rows carry a `0` sentinel; surface it as null so
 * the client prefills from the profile instead of rendering "0".
 */
const phoneStr = (v: bigint | number | null): string | null =>
  v === null || v === undefined || Number(v) === 0 ? null : String(v);

const idStr = (v: number | null): string | null =>
  v === null || v === undefined ? null : String(v);

export const toAddressDto = (row: CustomerAddress): AddressDto => ({
  _id: String(row.id),
  name: row.name,
  phone: phoneStr(row.phone),
  alternatePhone: phoneStr(row.alternate_phone),
  // Empty-string sentinel → null, same prefill reason as `phone`.
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
