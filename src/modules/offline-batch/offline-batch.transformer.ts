import type { OfflineBatch, OfflineCenter, OfflineCity } from "@prisma/client";
import type {
  OfflineBatchDto,
  OfflineCenterDto,
  OfflineCityRefDto,
} from "./offline-batch.types";

/** SQL `image` JSON (array of URLs, or a bare string) → Mongo `images: string[]`. */
const toImages = (image: unknown): string[] => {
  if (Array.isArray(image)) return image.filter((x): x is string => typeof x === "string");
  if (typeof image === "string" && image) return [image];
  return [];
};

/** `ws_offline_batch` row → DTO. `discription`→`description`; status synth true. */
export const toOfflineBatchDto = (row: OfflineBatch): OfflineBatchDto => ({
  _id: String(row.id),
  name: row.name,
  image: row.image,
  description: row.discription, // SQL column typo
  startAt: row.startAt,
  duration: row.duration,
  centerId: String(row.centerId),
  status: true, // no SQL status column — all rows active
  createdAt: row.createdAt ?? null,
  updatedAt: row.updatedAt ?? null,
});

/**
 * `ws_offline_center` row → DTO. `image` JSON → `images[]`; `phone` bigint →
 * string (Mongo stores phone as a string); status synthesized true.
 */
export const toOfflineCenterDto = (row: OfflineCenter): OfflineCenterDto => ({
  _id: String(row.id),
  name: row.name,
  images: toImages(row.image),
  address: row.address,
  latitude: row.latitude,
  longitude: row.longitude,
  phone: String(row.phone),
  cityId: String(row.cityId),
  status: true, // no SQL status column — all rows active
  createdAt: row.createdAt ?? null,
  updatedAt: row.updatedAt ?? null,
});

/** `ws_offline_city` row → lightweight `{_id, name}` ref. */
export const toOfflineCityRef = (city: OfflineCity | null | undefined): OfflineCityRefDto | null =>
  city ? { _id: String(city.id), name: city.name } : null;
