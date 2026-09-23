import type { BannerSlider } from "@prisma/client";
import {
  BANNER_KEYS,
  BANNER_KEY_TO_MODEL,
  BANNER_KEY_TO_MYSQL,
  MYSQL_KEY_TO_BANNER_KEY,
  bannerKeyNeedsTarget,
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

/** `key_id` is a positive int column; anything else stores as NULL. */
const parseKeyId = (raw?: string | number | null): number | null => {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * A target id only belongs on a key that references a collection — `Explore`
 * (and a key-less banner) must always store NULL, so a key switch can't strand
 * an orphan id on the row.
 */
const targetIdFor = (
  key: BannerKey | undefined,
  keyId?: string | number | null
): number | null => (key && bannerKeyNeedsTarget(key) ? parseKeyId(keyId) : null);

/** MySQL row → API DTO (Mongo-compatible). */
export const toBannerDto = (row: BannerSlider): BannerSliderDto => {
  const key = resolveBannerKey(row.key);
  return {
    _id: String(row.id),
    image: row.image,
    ...(key ? { key, keyRef: BANNER_KEY_TO_MODEL[key] } : {}),
    keyId: row.keyId ?? null,
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
    keyId: targetIdFor(key, input.keyId),
    orderBy: input.orderBy ?? 0,
    created_at: new Date(),
    updated_at: new Date(),
  };
};

export const toPrismaBannerUpdate = (input: BannerUpdateInput) => {
  const key = input.key !== undefined ? resolveBannerKey(input.key) : undefined;
  return {
    ...(input.image !== undefined ? { image: input.image } : {}),
    // `key` and `key_id` move together: re-keying a banner re-points (or clears)
    // its target in the same write, so the row can never hold a target that
    // belongs to the previous collection.
    ...(input.key !== undefined
      ? {
          key: key ? BANNER_KEY_TO_MYSQL[key] : null,
          keyId: targetIdFor(key, input.keyId),
        }
      : input.keyId !== undefined
        ? { keyId: parseKeyId(input.keyId) }
        : {}),
    ...(input.orderBy !== undefined ? { orderBy: input.orderBy } : {}),
    updated_at: new Date(),
  };
};
