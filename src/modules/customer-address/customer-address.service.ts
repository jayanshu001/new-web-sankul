// Customer addresses: address book CRUD and default selection.
import { customerAddressRepository as repo } from "./customer-address.repository";
import { toAddressDto } from "./customer-address.transformer";
import type { AddressCreateInput, AddressUpdateInput } from "./customer-address.types";
import { parsePositiveInt } from "../../utils/parseId";

export const parseAddressId = parsePositiveInt;

type Result<T> = { ok: true; status: number; data: T } | { ok: false; status: number; message: string };

export const listAddresses = async (customerId: number) => {
  const rows = await repo.listByCustomer(customerId);
  return rows.map(toAddressDto);
};

export const getAddress = async (id: number, customerId: number) => {
  const row = await repo.findOwned(id, customerId);
  return row ? toAddressDto(row) : null;
};

export const createAddress = async (input: AddressCreateInput) => {
  const row = await repo.create(input);
  return toAddressDto(row);
};

export const updateAddress = async (
  id: number,
  customerId: number,
  input: AddressUpdateInput
): Promise<Result<ReturnType<typeof toAddressDto>>> => {
  const res = await repo.updateOwned(id, customerId, input);
  if (res.count === 0) return { ok: false, status: 404, message: "Address not found" };
  const row = await repo.findOwned(id, customerId);
  if (!row) return { ok: false, status: 404, message: "Address not found" };
  return { ok: true, status: 200, data: toAddressDto(row) };
};

// Soft delete (status=false); 404 when not owned.
export const deleteAddress = async (id: number, customerId: number): Promise<Result<null>> => {
  const res = await repo.softDeleteOwned(id, customerId);
  if (res.count === 0) return { ok: false, status: 404, message: "Address not found" };
  return { ok: true, status: 200, data: null };
};

// Make this the customer's only default; 404 when not owned or inactive.
export const setDefaultAddress = async (id: number, customerId: number): Promise<Result<null>> => {
  const count = await repo.setDefault(id, customerId);
  if (count === 0) return { ok: false, status: 404, message: "Address not found" };
  return { ok: true, status: 200, data: null };
};
