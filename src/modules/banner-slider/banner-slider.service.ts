import { bannerSliderRepository } from "./banner-slider.repository";
import { toBannerDto, resolveBannerKey } from "./banner-slider.transformer";
import { topSlotOrder } from "../../utils/listOrdering";
import type {
  BannerCreateInput,
  BannerKey,
  BannerSliderDto,
  BannerUpdateInput,
} from "./banner-slider.types";

export const parseBannerId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const listBanners = async (opts?: {
  key?: string;
}): Promise<BannerSliderDto[]> => {
  const key = resolveBannerKey(opts?.key);
  const rows = await bannerSliderRepository.findMany(key ? { key } : undefined);
  return rows.map(toBannerDto);
};

/**
 * Admin server-side search + sort + opt-in pagination. `skip`/`take` apply only
 * when provided (absent → full filtered list). Always returns the total count.
 */
export const listBannersPaged = async (q: {
  key?: string;
  search?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  skip?: number;
  take?: number;
}): Promise<{ items: BannerSliderDto[]; total: number }> => {
  const key = resolveBannerKey(q.key);
  const opts = { key, search: q.search, sortBy: q.sortBy, sortDir: q.sortDir, skip: q.skip, take: q.take };
  const [rows, total] = await Promise.all([
    bannerSliderRepository.findPage(opts),
    bannerSliderRepository.count(opts),
  ]);
  return { items: rows.map(toBannerDto), total };
};

/**
 * Client list: orderBy asc, optional `key` filter + pagination. Banner rows are
 * image + redirect only (no natural text field) → pagination ONLY, no `search`.
 */
export const listBannersClientPaged = async (q: {
  key?: string;
  skip?: number;
  take?: number;
}): Promise<{ items: BannerSliderDto[]; total: number }> => {
  const key = resolveBannerKey(q.key);
  const opts = { key, skip: q.skip, take: q.take };
  const [rows, total] = await Promise.all([
    bannerSliderRepository.findPage(opts),
    bannerSliderRepository.count(opts),
  ]);
  return { items: rows.map(toBannerDto), total };
};

export const getBannerById = async (
  id: string
): Promise<BannerSliderDto | null> => {
  const numId = parseBannerId(id);
  if (!numId) return null;
  const row = await bannerSliderRepository.findById(numId);
  return row ? toBannerDto(row) : null;
};

export const createBanner = async (
  input: BannerCreateInput
): Promise<BannerSliderDto> => {
  // No explicit orderBy → land on TOP of this key's list (utils/listOrdering),
  // so a newly created banner is visible without a drag. An explicit value is
  // honoured as-is.
  const orderBy =
    input.orderBy ??
    topSlotOrder(await bannerSliderRepository.minOrderBy(input.key));
  const row = await bannerSliderRepository.create({ ...input, orderBy });
  return toBannerDto(row);
};

export const updateBanner = async (
  id: string,
  input: BannerUpdateInput
): Promise<BannerSliderDto | null> => {
  const numId = parseBannerId(id);
  if (!numId) return null;
  try {
    const row = await bannerSliderRepository.update(numId, input);
    return toBannerDto(row);
  } catch {
    return null;
  }
};

export const deleteBanner = async (id: string): Promise<boolean> => {
  const numId = parseBannerId(id);
  if (!numId) return false;
  try {
    await bannerSliderRepository.delete(numId);
    return true;
  } catch {
    return false;
  }
};

/**
 * Reorder banners. Returns the count of rows updated.
 * Only numeric ids apply.
 */
export const reorderBanners = async (
  orders: { id: string; orderBy: number }[]
): Promise<number> => {
  const ops = orders
    .map((o) => ({ id: parseBannerId(o.id), orderBy: o.orderBy }))
    .filter((o): o is { id: number; orderBy: number } => o.id !== null);
  if (!ops.length) return 0;
  await bannerSliderRepository.reorder(ops);
  return ops.length;
};

export type { BannerKey };
