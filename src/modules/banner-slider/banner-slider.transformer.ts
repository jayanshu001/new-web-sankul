import type { BannerSlider } from "@prisma/client";
import {
  BANNER_KEYS,
  BANNER_KEY_TO_MODEL,
  BANNER_KEY_TO_MYSQL,
  MYSQL_KEY_TO_BANNER_KEY,
  type BannerCreateInput,
  type BannerKey,
  type BannerSliderDto,
  type BannerUpdateInput,
} from "./banner-slider.types";

/** Resolve a banner key from either Mongo casing or raw MySQL value. */
export const resolveBannerKey = (raw?: string | null): BannerKey | undefined => {
  if (!raw) return undefined;
  if ((BANNER_KEYS as readonly string[]).includes(raw)) return raw as BannerKey;
  return MYSQL_KEY_TO_BANNER_KEY[raw.toLowerCase()];
};

/** MySQL row → API DTO (Mongo-compatible). */
export const toBannerDto = (row: BannerSlider): BannerSliderDto => {
  const key = resolveBannerKey(row.key);
  return {
    _id: String(row.id),
    image: row.image,
    ...(key ? { key, keyRef: BANNER_KEY_TO_MODEL[key] } : {}),
    keyId: null,
    orderBy: row.orderBy,
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
  };
};

export const toPrismaBannerCreate = (input: BannerCreateInput) => {
  const key = resolveBannerKey(input.key);
  return {
    image: input.image,
    key: key ? BANNER_KEY_TO_MYSQL[key] : null,
    keyId: null,
    orderBy: input.orderBy ?? 0,
    created_at: new Date(),
    updated_at: new Date(),
  };
};

export const toPrismaBannerUpdate = (input: BannerUpdateInput) => {
  const key = input.key !== undefined ? resolveBannerKey(input.key) : undefined;
  return {
    ...(input.image !== undefined ? { image: input.image } : {}),
    ...(input.key !== undefined
      ? { key: key ? BANNER_KEY_TO_MYSQL[key] : null }
      : {}),
    ...(input.orderBy !== undefined ? { orderBy: input.orderBy } : {}),
    updated_at: new Date(),
  };
};
