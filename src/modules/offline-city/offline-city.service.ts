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
