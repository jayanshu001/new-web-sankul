import { popupRepository } from "./popup.repository";
import { toPopupDto } from "./popup.transformer";
import type { PopupCreateInput, PopupDto, PopupUpdateInput } from "./popup.types";

export const parsePopupId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const listPopups = async (): Promise<PopupDto[]> => {
  const rows = await popupRepository.findMany();
  return rows.map(toPopupDto);
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
  const opts = { search: q.search, sortBy: q.sortBy, sortDir: q.sortDir, skip: q.skip, take: q.take };
  const [rows, total] = await Promise.all([
    popupRepository.findPage(opts),
    popupRepository.count(opts),
  ]);
  return { items: rows.map(toPopupDto), total };
};

export const getPopupById = async (id: string): Promise<PopupDto | null> => {
  const numId = parsePopupId(id);
  if (!numId) return null;
  const row = await popupRepository.findById(numId);
  return row ? toPopupDto(row) : null;
};

export const createPopup = async (
  input: PopupCreateInput
): Promise<PopupDto> => {
  const row = await popupRepository.create(input);
  return toPopupDto(row);
};

export const updatePopup = async (
  id: string,
  input: PopupUpdateInput
): Promise<PopupDto | null> => {
  const numId = parsePopupId(id);
  if (!numId) return null;
  try {
    const row = await popupRepository.update(numId, input);
    return toPopupDto(row);
  } catch {
    return null;
  }
};

export const deletePopup = async (id: string): Promise<boolean> => {
  const numId = parsePopupId(id);
  if (!numId) return false;
  try {
    await popupRepository.delete(numId);
    return true;
  } catch {
    return false;
  }
};

/**
 * Client active popup: status:true AND promoExpireAt > now, newest first.
 * Returns the single most recent match or null (matches legacy `findOne`).
 */
export const getActivePopup = async (): Promise<PopupDto | null> => {
  const now = new Date();
  const row = await popupRepository.findActive(now);
  return row ? toPopupDto(row) : null;
};
