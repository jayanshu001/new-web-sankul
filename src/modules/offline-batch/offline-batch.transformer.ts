// Offline batches: row to DTO mapping (response shape is frozen).
import type { OfflineBatch, OfflineCenter, OfflineCity } from "@prisma/client";
import type {
  OfflineBatchDto,
  OfflineCenterDto,
  OfflineCityRefDto,
} from "./offline-batch.types";

/** SQL `image` JSON (array of URLs, or a bare string) → `images: string[]`. */
const toImages = (image: unknown): string[] => {
  if (Array.isArray(image)) return image.filter((x): x is string => typeof x === "string");
  if (typeof image === "string" && image) return [image];
  return [];
};

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

export const toOfflineCityRef = (city: OfflineCity | null | undefined): OfflineCityRefDto | null =>
  city ? { _id: String(city.id), name: city.name } : null;
