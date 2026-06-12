/**
 * Offline · Batch/Center service — dual-path (MySQL/Prisma ↔ Mongo/Mongoose).
 *
 * Module key: `offline-batch` (flag OFF). Reproduces the offline browse reads:
 * centers (+ city / + nested batches), batches (+ center→city), and the offline
 * dashboard composition. Cities come from the `offline-city` module.
 *
 * READ only — `submitEnquiry` (POST → ws_offline_enquiry) is a WRITE path, not
 * built here. No SQL `status` column on center/batch → all rows treated active.
 */
import { isMysqlModule } from "../../config/migration";
import { offlineBatchRepository as repo } from "./offline-batch.repository";
import {
  toOfflineBatchDto,
  toOfflineCenterDto,
  toOfflineCityRef,
} from "./offline-batch.transformer";
import type {
  OfflineBatchDto,
  OfflineCenterWithBatchesDto,
  OfflineCenterWithCityDto,
} from "./offline-batch.types";

export const OFFLINE_BATCH_MODULE = "offline-batch";
export const isOfflineBatchMysql = (): boolean => isMysqlModule(OFFLINE_BATCH_MODULE);

/** Parse a string id to a positive int, else null. */
export const parseOfflineId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// ── centers ───────────────────────────────────────────────────────────────

/** Centers (+ city ref), optional cityId + name search. */
export const listCenters = async (opts?: {
  cityId?: number;
  search?: string;
}): Promise<OfflineCenterWithCityDto[]> => {
  const rows = await repo.listCenters({
    cityId: opts?.cityId,
    search: opts?.search?.trim() || undefined,
  });
  return rows.map((r) => ({ ...toOfflineCenterDto(r), city: toOfflineCityRef(r.city) }));
};

/** Single center (+ city) with its batches nested, or null. */
export const getCenterDetail = async (
  id: number
): Promise<(OfflineCenterWithCityDto & { batches: OfflineBatchDto[] }) | null> => {
  const row = await repo.findCenterById(id);
  if (!row) return null;
  const batches = await repo.listBatchesByCenters([id]);
  return {
    ...toOfflineCenterDto(row),
    city: toOfflineCityRef(row.city),
    batches: batches.map(toOfflineBatchDto),
  };
};

// ── batches ───────────────────────────────────────────────────────────────

/** Batches (+ center→city), optional center/city/upcoming/name filters. */
export const listBatches = async (opts?: {
  centerId?: number;
  cityId?: number;
  upcoming?: boolean;
  search?: string;
  now?: Date;
}): Promise<Array<OfflineBatchDto & { center: OfflineCenterWithCityDto | null }>> => {
  // city filter resolves to that city's center ids (the Mongo path does the same).
  let centerIds: number[] | undefined;
  if (opts?.centerId == null && opts?.cityId != null) {
    const centers = await repo.listCentersByCities([opts.cityId]);
    centerIds = centers.map((c) => c.id);
    if (!centerIds.length) return [];
  }

  const rows = await repo.listBatches({
    centerId: opts?.centerId,
    centerIds,
    search: opts?.search?.trim() || undefined,
    upcomingAfter: opts?.upcoming ? opts?.now ?? new Date() : undefined,
  });

  return rows.map((r) => ({
    ...toOfflineBatchDto(r),
    center: r.center
      ? { ...toOfflineCenterDto(r.center), city: toOfflineCityRef(r.center.city) }
      : null,
  }));
};

/** Single batch (+ center→city), or null. */
export const getBatchDetail = async (
  id: number
): Promise<(OfflineBatchDto & { center: OfflineCenterWithCityDto | null }) | null> => {
  const row = await repo.findBatchById(id);
  if (!row) return null;
  return {
    ...toOfflineBatchDto(row),
    center: row.center
      ? { ...toOfflineCenterDto(row.center), city: toOfflineCityRef(row.center.city) }
      : null,
  };
};

// ── dashboard composition ────────────────────────────────────────────────

/** Centers (each with active batches) grouped under the given city ids. */
export const getCentersWithBatchesByCities = async (
  cityIds: number[]
): Promise<Map<string, OfflineCenterWithBatchesDto[]>> => {
  const centers = await repo.listCentersByCities(cityIds);
  const centerIds = centers.map((c) => c.id);
  const batches = await repo.listBatchesByCenters(centerIds);

  const batchesByCenter = new Map<string, OfflineBatchDto[]>();
  for (const b of batches) {
    const key = String(b.centerId);
    if (!batchesByCenter.has(key)) batchesByCenter.set(key, []);
    batchesByCenter.get(key)!.push(toOfflineBatchDto(b));
  }

  const byCity = new Map<string, OfflineCenterWithBatchesDto[]>();
  for (const c of centers) {
    const dto = toOfflineCenterDto(c);
    const withBatches: OfflineCenterWithBatchesDto = {
      ...dto,
      batches: batchesByCenter.get(dto._id) ?? [],
    };
    const cityKey = dto.cityId;
    if (!byCity.has(cityKey)) byCity.set(cityKey, []);
    byCity.get(cityKey)!.push(withBatches);
  }
  return byCity;
};

/** Upcoming active batches (+ center→city), soonest first, capped. */
export const listUpcomingBatches = async (
  now: Date = new Date(),
  limit = 10
): Promise<Array<OfflineBatchDto & { center: OfflineCenterWithCityDto | null }>> => {
  const rows = await repo.listUpcoming(now, limit);
  return rows.map((r) => ({
    ...toOfflineBatchDto(r),
    center: r.center
      ? { ...toOfflineCenterDto(r.center), city: toOfflineCityRef(r.center.city) }
      : null,
  }));
};
