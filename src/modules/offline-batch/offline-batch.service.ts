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
export const isOfflineBatchMysql = (): boolean => true;

/** Parse a string id to a positive int, else null. */
export const parseOfflineId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// ── centers ───────────────────────────────────────────────────────────────

/** Centers (+ city ref), optional cityId + name search, paginated. Returns the
 *  page + total matching count for the pagination envelope. */
export const listCenters = async (opts?: {
  cityId?: number;
  search?: string;
  skip?: number;
  take?: number;
}): Promise<{ data: OfflineCenterWithCityDto[]; total: number }> => {
  const filter = { cityId: opts?.cityId, search: opts?.search?.trim() || undefined };
  const [rows, total] = await Promise.all([
    repo.listCenters({ ...filter, skip: opts?.skip, take: opts?.take }),
    repo.countCentersList(filter),
  ]);
  return {
    data: rows.map((r) => ({ ...toOfflineCenterDto(r), city: toOfflineCityRef(r.city) })),
    total,
  };
};

/** Admin centers (+ city ref): optional cityId + name search, newest first,
 *  paginated when skip/take are provided. Returns rows + total for the UI. */
export const listCentersAdmin = async (opts?: {
  cityId?: number;
  search?: string;
  skip?: number;
  take?: number;
}): Promise<{ data: OfflineCenterWithCityDto[]; total: number }> => {
  const filter = { cityId: opts?.cityId, search: opts?.search?.trim() || undefined };
  const [rows, total] = await Promise.all([
    repo.listCenters({ ...filter, skip: opts?.skip, take: opts?.take }),
    repo.countCentersList(filter),
  ]);
  return {
    data: rows.map((r) => ({ ...toOfflineCenterDto(r), city: toOfflineCityRef(r.city) })),
    total,
  };
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

/** Batches (+ center→city), optional center/city/upcoming/name filters,
 *  paginated. Returns the page + total matching count. */
export const listBatches = async (opts?: {
  centerId?: number;
  cityId?: number;
  upcoming?: boolean;
  search?: string;
  now?: Date;
  skip?: number;
  take?: number;
}): Promise<{
  data: Array<OfflineBatchDto & { center: OfflineCenterWithCityDto | null }>;
  total: number;
}> => {
  // city filter resolves to that city's center ids (the Mongo path does the same).
  let centerIds: number[] | undefined;
  if (opts?.centerId == null && opts?.cityId != null) {
    const centers = await repo.listCentersByCities([opts.cityId]);
    centerIds = centers.map((c) => c.id);
    if (!centerIds.length) return { data: [], total: 0 };
  }

  const filter = {
    centerId: opts?.centerId,
    centerIds,
    search: opts?.search?.trim() || undefined,
    upcomingAfter: opts?.upcoming ? opts?.now ?? new Date() : undefined,
  };
  const [rows, total] = await Promise.all([
    repo.listBatches({ ...filter, skip: opts?.skip, take: opts?.take }),
    repo.countBatches(filter),
  ]);

  return {
    data: rows.map((r) => ({
      ...toOfflineBatchDto(r),
      center: r.center
        ? { ...toOfflineCenterDto(r.center), city: toOfflineCityRef(r.center.city) }
        : null,
    })),
    total,
  };
};

/** Admin batches (+ center→city): optional center/name/upcoming filters, newest
 *  created first, paginated when skip/take are provided. Returns rows + total. */
export const listBatchesAdmin = async (opts?: {
  centerId?: number;
  search?: string;
  upcoming?: boolean;
  now?: Date;
  skip?: number;
  take?: number;
}): Promise<{
  data: Array<OfflineBatchDto & { center: OfflineCenterWithCityDto | null }>;
  total: number;
}> => {
  const filter = {
    centerId: opts?.centerId,
    search: opts?.search?.trim() || undefined,
    upcomingAfter: opts?.upcoming ? opts?.now ?? new Date() : undefined,
  };
  const [rows, total] = await Promise.all([
    repo.listBatchesAdmin({ ...filter, skip: opts?.skip, take: opts?.take }),
    repo.countBatchesList(filter),
  ]);
  return {
    data: rows.map((r) => ({
      ...toOfflineBatchDto(r),
      center: r.center
        ? { ...toOfflineCenterDto(r.center), city: toOfflineCityRef(r.center.city) }
        : null,
    })),
    total,
  };
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

// ── admin CRUD (Wave 8) ──────────────────────────────────────────────────────
// Center/Batch have NO SQL `status` column → `status` is dropped on write and
// synthesized true on read (toOfflineCenterDto/toOfflineBatchDto). `images[]`
// stores into the JSON `image` column; `phone` → BigInt; `description`→`discription`.

type Envelope<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

const centerWithCity = (r: any) => ({ ...toOfflineCenterDto(r), city: toOfflineCityRef(r.city) });
const batchWithCenter = (r: any) => ({
  ...toOfflineBatchDto(r),
  center: r.center ? { ...toOfflineCenterDto(r.center), city: toOfflineCityRef(r.center.city) } : null,
});

// ── center writes ──
export const createCenter = async (input: {
  name: string; images: string[]; address: string; latitude: number; longitude: number;
  phone: string | number; cityId: number;
}): Promise<Envelope<any>> => {
  if (!(await repo.cityExists(input.cityId))) return { ok: false, status: 404, message: "City not found." };
  const row = await repo.createCenter({
    name: input.name, image: input.images, address: input.address,
    latitude: input.latitude, longitude: input.longitude,
    phone: BigInt(input.phone), cityId: input.cityId,
  });
  return { ok: true, data: centerWithCity(row) };
};

export const updateCenter = async (
  id: number,
  input: { name?: string; images?: string[]; address?: string; latitude?: number; longitude?: number; phone?: string | number; cityId?: number }
): Promise<Envelope<any>> => {
  const exists = await repo.findCenterById(id);
  if (!exists) return { ok: false, status: 404, message: "Center not found." };
  if (input.cityId != null && !(await repo.cityExists(input.cityId)))
    return { ok: false, status: 404, message: "City not found." };
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.images !== undefined) data.image = input.images;
  if (input.address !== undefined) data.address = input.address;
  if (input.latitude !== undefined) data.latitude = input.latitude;
  if (input.longitude !== undefined) data.longitude = input.longitude;
  if (input.phone !== undefined) data.phone = BigInt(input.phone);
  if (input.cityId !== undefined) data.cityId = input.cityId;
  const row = await repo.updateCenter(id, data);
  return { ok: true, data: centerWithCity(row) };
};

export const deleteCenter = async (id: number): Promise<Envelope<null>> => {
  const exists = await repo.findCenterById(id);
  if (!exists) return { ok: false, status: 404, message: "Center not found." };
  const batches = await repo.countBatchesInCenter(id);
  if (batches > 0)
    return { ok: false, status: 409, message: `Cannot delete — center has ${batches} batches.` };
  await repo.deleteCenter(id);
  return { ok: true, data: null };
};

// ── batch writes ──
export const createBatch = async (input: {
  name: string; image: string; description: string; startAt: string | Date; duration: string; centerId: number;
}): Promise<Envelope<any>> => {
  const center = await repo.findCenterById(input.centerId);
  if (!center) return { ok: false, status: 404, message: "Center not found." };
  const row = await repo.createBatch({
    name: input.name, image: input.image, discription: input.description,
    startAt: new Date(input.startAt), duration: input.duration, centerId: input.centerId,
  });
  return { ok: true, data: batchWithCenter(row) };
};

export const updateBatch = async (
  id: number,
  input: { name?: string; image?: string; description?: string; startAt?: string | Date; duration?: string; centerId?: number }
): Promise<Envelope<any>> => {
  const exists = await repo.findBatchById(id);
  if (!exists) return { ok: false, status: 404, message: "Batch not found." };
  if (input.centerId != null && !(await repo.findCenterById(input.centerId)))
    return { ok: false, status: 404, message: "Center not found." };
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.image !== undefined) data.image = input.image;
  if (input.description !== undefined) data.discription = input.description;
  if (input.startAt !== undefined) data.startAt = new Date(input.startAt);
  if (input.duration !== undefined) data.duration = input.duration;
  if (input.centerId !== undefined) data.centerId = input.centerId;
  const row = await repo.updateBatch(id, data);
  return { ok: true, data: batchWithCenter(row) };
};

export const deleteBatch = async (id: number): Promise<Envelope<null>> => {
  const exists = await repo.findBatchById(id);
  if (!exists) return { ok: false, status: 404, message: "Batch not found." };
  await repo.deleteBatch(id); // soft delete: flags deletedAt, keeps enquiries intact
  return { ok: true, data: null };
};

// ── offline banner (OfflineBannerSlider; order_by added via Wave 8 ALTER) ─────
const bannerDto = (r: any) => ({
  _id: String(r.id), image: r.image, key: r.key ?? null, keyId: r.keyId ?? null,
  orderBy: r.orderBy, createdAt: r.createdAt ?? null, updatedAt: r.updatedAt ?? null,
});

export const listBanners = async () => (await repo.listBanners()).map(bannerDto);

export const createBanner = async (input: { image: string; key?: string; keyId?: number; orderBy?: number }) => {
  const row = await repo.createBanner({
    image: input.image, key: input.key ?? null, keyId: input.keyId ?? null, orderBy: input.orderBy ?? 0,
  });
  return bannerDto(row);
};

export const updateBanner = async (id: number, input: { image?: string; key?: string; keyId?: number; orderBy?: number }): Promise<Envelope<any>> => {
  if (!(await repo.findBannerById(id))) return { ok: false, status: 404, message: "Not found." };
  const data: any = {};
  if (input.image !== undefined) data.image = input.image;
  if (input.key !== undefined) data.key = input.key;
  if (input.keyId !== undefined) data.keyId = input.keyId;
  if (input.orderBy !== undefined) data.orderBy = input.orderBy;
  const row = await repo.updateBanner(id, data);
  return { ok: true, data: bannerDto(row) };
};

export const deleteBanner = async (id: number): Promise<boolean> => {
  if (!(await repo.findBannerById(id))) return false;
  await repo.deleteBanner(id);
  return true;
};

/** Reorder banners by [{id, orderBy}]; returns count applied. */
export const reorderBanners = async (orders: { id: string; orderBy: number }[]): Promise<number> => {
  let count = 0;
  for (const o of orders) {
    const nid = parseOfflineId(o.id);
    if (nid == null) continue;
    const r = await repo.reorderBanner(nid, o.orderBy);
    count += r.count;
  }
  return count;
};
