import mongoose from "mongoose";
import { PopupNotification } from "../../models/system/PopupNotification.model";
import { isMysqlModule } from "../../config/migration";
import { buildSearchFilter } from "../../utils/searchFilter";
import { popupRepository } from "./popup.repository";
import { toPopupDto } from "./popup.transformer";
import type { PopupCreateInput, PopupDto, PopupUpdateInput } from "./popup.types";

const MODULE = "popup";

export const parsePopupId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const fromMongoDoc = (d: Record<string, unknown>): PopupDto => ({
  _id: String(d._id),
  title: d.title as string,
  description: d.description as string,
  image: d.image as string,
  discount: (d.discount as string) ?? "",
  promocode: (d.promocode as string) ?? "",
  promoExpireAt: (d.promoExpireAt as Date) ?? null,
  status: (d.status as boolean) ?? true,
  createdAt: d.createdAt as Date | undefined,
  updatedAt: d.updatedAt as Date | undefined,
});

export const listPopups = async (): Promise<PopupDto[]> => {
  if (isMysqlModule(MODULE)) {
    const rows = await popupRepository.findMany();
    return rows.map(toPopupDto);
  }
  const docs = await PopupNotification.find().sort({ createdAt: -1 }).lean();
  return docs.map((d) => fromMongoDoc(d as Record<string, unknown>));
};

/**
 * Admin server-side search + sort + opt-in pagination. `skip`/`take` apply only
 * when provided (absent → full filtered list). Always returns the total count.
 */
export const listPopupsPaged = async (q: {
  search?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  skip?: number;
  take?: number;
}): Promise<{ items: PopupDto[]; total: number }> => {
  if (isMysqlModule(MODULE)) {
    const opts = { search: q.search, sortBy: q.sortBy, sortDir: q.sortDir, skip: q.skip, take: q.take };
    const [rows, total] = await Promise.all([
      popupRepository.findPage(opts),
      popupRepository.count(opts),
    ]);
    return { items: rows.map(toPopupDto), total };
  }

  const filter = buildSearchFilter(q.search, ["title", "description", "discount", "promocode"]);
  const sortField = q.sortBy === "title" ? "title" : q.sortBy === "status" ? "status" : q.sortBy === "updatedAt" ? "updatedAt" : "createdAt";
  const sortNum = q.sortDir === "asc" ? 1 : -1;
  let query = PopupNotification.find(filter).sort({ [sortField]: sortNum });
  if (q.skip != null) query = query.skip(q.skip);
  if (q.take != null) query = query.limit(q.take);
  const [docs, total] = await Promise.all([query.lean(), PopupNotification.countDocuments(filter)]);
  return { items: docs.map((d) => fromMongoDoc(d as Record<string, unknown>)), total };
};

export const getPopupById = async (id: string): Promise<PopupDto | null> => {
  if (isMysqlModule(MODULE)) {
    const numId = parsePopupId(id);
    if (!numId) return null;
    const row = await popupRepository.findById(numId);
    return row ? toPopupDto(row) : null;
  }
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await PopupNotification.findById(id).lean();
  return doc ? fromMongoDoc(doc as Record<string, unknown>) : null;
};

export const createPopup = async (
  input: PopupCreateInput
): Promise<PopupDto> => {
  if (isMysqlModule(MODULE)) {
    const row = await popupRepository.create(input);
    return toPopupDto(row);
  }
  const doc = await PopupNotification.create({
    ...input,
    promoExpireAt: new Date(input.promoExpireAt),
    discount: input.discount ?? "",
    promocode: input.promocode ?? "",
    status: input.status ?? true,
  });
  return fromMongoDoc(doc.toObject() as unknown as Record<string, unknown>);
};

export const updatePopup = async (
  id: string,
  input: PopupUpdateInput
): Promise<PopupDto | null> => {
  if (isMysqlModule(MODULE)) {
    const numId = parsePopupId(id);
    if (!numId) return null;
    try {
      const row = await popupRepository.update(numId, input);
      return toPopupDto(row);
    } catch {
      return null;
    }
  }
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const payload: Record<string, unknown> = { ...input };
  if (input.promoExpireAt !== undefined) {
    payload.promoExpireAt = new Date(input.promoExpireAt);
  }
  const doc = await PopupNotification.findByIdAndUpdate(
    id,
    { $set: payload },
    { new: true }
  ).lean();
  return doc ? fromMongoDoc(doc as Record<string, unknown>) : null;
};

export const deletePopup = async (id: string): Promise<boolean> => {
  if (isMysqlModule(MODULE)) {
    const numId = parsePopupId(id);
    if (!numId) return false;
    try {
      await popupRepository.delete(numId);
      return true;
    } catch {
      return false;
    }
  }
  if (!mongoose.Types.ObjectId.isValid(id)) return false;
  const doc = await PopupNotification.findByIdAndDelete(id);
  return !!doc;
};

/**
 * Client active popup: status:true AND promoExpireAt > now, newest first.
 * Returns the single most recent match or null (matches legacy `findOne`).
 */
export const getActivePopup = async (): Promise<PopupDto | null> => {
  const now = new Date();
  if (isMysqlModule(MODULE)) {
    const row = await popupRepository.findActive(now);
    return row ? toPopupDto(row) : null;
  }
  const doc = await PopupNotification.findOne({
    status: true,
    promoExpireAt: { $gt: now },
  })
    .sort({ createdAt: -1 })
    .lean();
  return doc ? fromMongoDoc(doc as Record<string, unknown>) : null;
};
