/**
 * Customer address service — dual-path (MySQL/Prisma ↔ Mongo/Mongoose).
 *
 * The MySQL branch is gated behind `isMysqlModule("customer-address")`. It is
 * intentionally NOT enabled in `MIGRATION_MYSQL_MODULES` until OfflineCity + the
 * cart checkout flow migrate, because cart resolves `cityId` → `OfflineCity.name`
 * and the two backends use different id spaces (ObjectId vs int FK). See
 * `customer-address.types.ts` for the contract-divergence notes.
 *
 * Callers (the controller) keep doing zod validation; this service only decides
 * the backend and returns a uniform `{ ok, status, message?, data? }` envelope
 * so the controller's response shape is unchanged.
 */
import { isMysqlModule } from "../../config/migration";
import { customerAddressRepository as repo } from "./customer-address.repository";
import { toAddressDto } from "./customer-address.transformer";
import type { AddressCreateInput, AddressUpdateInput } from "./customer-address.types";

export const ADDRESS_MODULE = "customer-address";
export const isAddressMysql = (): boolean => isMysqlModule(ADDRESS_MODULE);

/** Parse a string id (route param / customer id) to a positive int, else null. */
export const parseAddressId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

type Result<T> = { ok: true; status: number; data: T } | { ok: false; status: number; message: string };

// ─── List ────────────────────────────────────────────────────────────────────
export const listAddresses = async (customerId: number) => {
  const rows = await repo.listByCustomer(customerId);
  return rows.map(toAddressDto);
};

// ─── Get one ───────────────────────────────────────────────────────────────────
export const getAddress = async (id: number, customerId: number) => {
  const row = await repo.findOwned(id, customerId);
  return row ? toAddressDto(row) : null;
};

// ─── Create ────────────────────────────────────────────────────────────────────
export const createAddress = async (input: AddressCreateInput) => {
  const row = await repo.create(input);
  return toAddressDto(row);
};

// ─── Update ────────────────────────────────────────────────────────────────────
export const updateAddress = async (
  id: number,
  customerId: number,
  input: AddressUpdateInput
): Promise<Result<ReturnType<typeof toAddressDto>>> => {
  const res = await repo.updateOwned(id, customerId, input);
  if (res.count === 0) return { ok: false, status: 404, message: "Address not found" };
  const row = await repo.findOwned(id, customerId);
  // findOwned can't be null here (we just updated it), but guard for types.
  if (!row) return { ok: false, status: 404, message: "Address not found" };
  return { ok: true, status: 200, data: toAddressDto(row) };
};

// ─── Soft delete ───────────────────────────────────────────────────────────────
export const deleteAddress = async (id: number, customerId: number): Promise<Result<null>> => {
  const res = await repo.softDeleteOwned(id, customerId);
  if (res.count === 0) return { ok: false, status: 404, message: "Address not found" };
  return { ok: true, status: 200, data: null };
};

// ─── Set default ───────────────────────────────────────────────────────────────
export const setDefaultAddress = async (id: number, customerId: number): Promise<Result<null>> => {
  const count = await repo.setDefault(id, customerId);
  if (count === 0) return { ok: false, status: 404, message: "Address not found" };
  return { ok: true, status: 200, data: null };
};
