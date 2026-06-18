/**
 * Offline city service — dual-path (MySQL/Prisma ↔ Mongo/Mongoose).
 *
 * Gated behind `isMysqlModule("offline-city")`. Scope: cities only — enough to
 * unblock `customer-address` (its `cityId` references OfflineCity, and cart
 * checkout resolves `cityId` → city name). Flip `offline-city` + `customer-address`
 * ON together so the int-id space is consistent across address ↔ city ↔ cart.
 *
 * Centers/batches/enquiry/admin stay on Mongo for a later offline pass.
 */
import { isMysqlModule } from "../../config/migration";
import { offlineCityRepository as repo } from "./offline-city.repository";
import { toCityDto, toCityNameDto } from "./offline-city.transformer";
import type { CityDto, CityNameDto } from "./offline-city.types";

export const OFFLINE_CITY_MODULE = "offline-city";
export const isOfflineCityMysql = (): boolean => isMysqlModule(OFFLINE_CITY_MODULE);

/** Parse a string id to a positive int, else null. */
export const parseCityId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Active cities (order, then name) — matches the Mongo `listCities` contract. */
export const listActiveCities = async (search?: string): Promise<CityDto[]> => {
  const rows = await repo.listActive({ search: search?.trim() || undefined });
  return rows.map(toCityDto);
};

/**
 * Resolve a city id → { _id, name } for the cart shipping snapshot.
 * Returns null if the id is invalid or the city doesn't exist.
 */
export const resolveCityName = async (cityId: string | number): Promise<CityNameDto | null> => {
  const n = typeof cityId === "number" ? cityId : parseCityId(String(cityId));
  if (!n) return null;
  const row = await repo.findNameById(n);
  return row ? toCityNameDto(row) : null;
};

// ── admin CRUD (Wave 8) ──────────────────────────────────────────────────────
// `ws_offline_city` has NO `stateId` column (Mongo field is optional/default null),
// so the admin state filter + populate are dropped — consistent with this module's
// read precedent. DTO is Mongo-shaped (toCityDto).
type Envelope<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

/** Admin list (includes inactive); optional status filter. State filter is a no-op (no SQL col). */
export const listCitiesAdmin = async (status?: boolean): Promise<CityDto[]> => {
  const rows = await repo.listAll({ status });
  return rows.map(toCityDto);
};

export const getCityAdmin = async (id: number): Promise<CityDto | null> => {
  const row = await repo.findById(id);
  return row ? toCityDto(row) : null;
};

export const createCityAdmin = async (input: {
  name: string; image: string; order?: number; status?: boolean;
}): Promise<CityDto> => {
  const row = await repo.create({
    name: input.name, image: input.image, order: input.order ?? 0, status: input.status ?? true,
  });
  return toCityDto(row);
};

export const updateCityAdmin = async (
  id: number,
  input: { name?: string; image?: string; order?: number; status?: boolean }
): Promise<Envelope<CityDto>> => {
  const exists = await repo.findById(id);
  if (!exists) return { ok: false, status: 404, message: "City not found." };
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.image !== undefined) data.image = input.image;
  if (input.order !== undefined) data.order = input.order;
  if (input.status !== undefined) data.status = input.status;
  const row = await repo.update(id, data);
  return { ok: true, data: toCityDto(row) };
};

export const deleteCityAdmin = async (id: number): Promise<Envelope<null>> => {
  const exists = await repo.findById(id);
  if (!exists) return { ok: false, status: 404, message: "City not found." };
  const centers = await repo.countCenters(id);
  if (centers > 0)
    return { ok: false, status: 409, message: `Cannot delete — city has ${centers} centers.` };
  await repo.remove(id);
  return { ok: true, data: null };
};
