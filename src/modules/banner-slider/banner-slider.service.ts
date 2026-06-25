import mongoose from "mongoose";
import {
  BannerSlider,
  BANNER_KEY_TO_MODEL,
  type BannerKey as MongoBannerKey,
} from "../../models/system/BannerSlider.model";
import { isMysqlModule } from "../../config/migration";
import { buildSearchFilter } from "../../utils/searchFilter";
import { bannerSliderRepository } from "./banner-slider.repository";
import { toBannerDto, resolveBannerKey } from "./banner-slider.transformer";
import type {
  BannerCreateInput,
  BannerKey,
  BannerSliderDto,
  BannerUpdateInput,
} from "./banner-slider.types";

const MODULE = "banner-slider";

export const parseBannerId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Mongo lean doc → DTO (derives keyRef like the legacy controller transform). */
const fromMongoDoc = (d: Record<string, unknown>): BannerSliderDto => {
  const key = d.key as MongoBannerKey | undefined;
  return {
    _id: String(d._id),
    image: d.image as string,
    ...(key ? { key, keyRef: BANNER_KEY_TO_MODEL[key] } : {}),
    keyId: (d.keyId as unknown) ?? null,
    orderBy: (d.orderBy as number) ?? 0,
    createdAt: d.createdAt as Date | undefined,
    updatedAt: d.updatedAt as Date | undefined,
  };
};

export const listBanners = async (opts?: {
  key?: string;
}): Promise<BannerSliderDto[]> => {
  if (isMysqlModule(MODULE)) {
    const key = resolveBannerKey(opts?.key);
    const rows = await bannerSliderRepository.findMany(key ? { key } : undefined);
    return rows.map(toBannerDto);
  }

  const filter: Record<string, unknown> = {};
  if (opts?.key) filter.key = opts.key;
  const docs = await BannerSlider.find(filter)
    .sort({ orderBy: 1 })
    .populate("keyId")
    .lean();
  return docs.map((d) => fromMongoDoc(d as Record<string, unknown>));
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
  if (isMysqlModule(MODULE)) {
    const key = resolveBannerKey(q.key);
    const opts = { key, search: q.search, sortBy: q.sortBy, sortDir: q.sortDir, skip: q.skip, take: q.take };
    const [rows, total] = await Promise.all([
      bannerSliderRepository.findPage(opts),
      bannerSliderRepository.count(opts),
    ]);
    return { items: rows.map(toBannerDto), total };
  }

  const filter: Record<string, unknown> = {};
  if (q.key) filter.key = q.key;
  Object.assign(filter, buildSearchFilter(q.search, ["image", "key"]));
  const sortField = q.sortBy === "createdAt" ? "createdAt" : q.sortBy === "updatedAt" ? "updatedAt" : "orderBy";
  const sortNum = q.sortDir === "desc" ? -1 : 1;
  let query = BannerSlider.find(filter).sort({ [sortField]: sortNum }).populate("keyId");
  if (q.skip != null) query = query.skip(q.skip);
  if (q.take != null) query = query.limit(q.take);
  const [docs, total] = await Promise.all([query.lean(), BannerSlider.countDocuments(filter)]);
  return { items: docs.map((d) => fromMongoDoc(d as Record<string, unknown>)), total };
};

export const getBannerById = async (
  id: string
): Promise<BannerSliderDto | null> => {
  if (isMysqlModule(MODULE)) {
    const numId = parseBannerId(id);
    if (!numId) return null;
    const row = await bannerSliderRepository.findById(numId);
    return row ? toBannerDto(row) : null;
  }

  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await BannerSlider.findById(id).populate("keyId").lean();
  return doc ? fromMongoDoc(doc as Record<string, unknown>) : null;
};

export const createBanner = async (
  input: BannerCreateInput
): Promise<BannerSliderDto> => {
  if (isMysqlModule(MODULE)) {
    const row = await bannerSliderRepository.create(input);
    return toBannerDto(row);
  }

  const payload: Record<string, unknown> = { ...input };
  if (input.key) payload.keyRef = BANNER_KEY_TO_MODEL[input.key as MongoBannerKey];
  const doc = await BannerSlider.create(payload);
  return fromMongoDoc(doc.toObject() as unknown as Record<string, unknown>);
};

export const updateBanner = async (
  id: string,
  input: BannerUpdateInput
): Promise<BannerSliderDto | null> => {
  if (isMysqlModule(MODULE)) {
    const numId = parseBannerId(id);
    if (!numId) return null;
    try {
      const row = await bannerSliderRepository.update(numId, input);
      return toBannerDto(row);
    } catch {
      return null;
    }
  }

  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const payload: Record<string, unknown> = { ...input };
  if (input.key) payload.keyRef = BANNER_KEY_TO_MODEL[input.key as MongoBannerKey];
  const doc = await BannerSlider.findByIdAndUpdate(
    id,
    { $set: payload },
    { new: true }
  ).lean();
  return doc ? fromMongoDoc(doc as Record<string, unknown>) : null;
};

export const deleteBanner = async (id: string): Promise<boolean> => {
  if (isMysqlModule(MODULE)) {
    const numId = parseBannerId(id);
    if (!numId) return false;
    try {
      await bannerSliderRepository.delete(numId);
      return true;
    } catch {
      return false;
    }
  }

  if (!mongoose.Types.ObjectId.isValid(id)) return false;
  const doc = await BannerSlider.findByIdAndDelete(id);
  return !!doc;
};

/**
 * Reorder banners. Returns the count of rows updated.
 * On MySQL only numeric ids apply; on Mongo only ObjectIds apply (matching
 * the legacy controller's filter behavior).
 */
export const reorderBanners = async (
  orders: { id: string; orderBy: number }[]
): Promise<number> => {
  if (isMysqlModule(MODULE)) {
    const ops = orders
      .map((o) => ({ id: parseBannerId(o.id), orderBy: o.orderBy }))
      .filter((o): o is { id: number; orderBy: number } => o.id !== null);
    if (!ops.length) return 0;
    await bannerSliderRepository.reorder(ops);
    return ops.length;
  }

  const ops = orders
    .filter((o) => mongoose.Types.ObjectId.isValid(o.id))
    .map((o) => ({
      updateOne: {
        filter: { _id: o.id },
        update: { $set: { orderBy: o.orderBy } },
      },
    }));
  if (!ops.length) return 0;
  await BannerSlider.bulkWrite(ops);
  return ops.length;
};

export type { BannerKey };
