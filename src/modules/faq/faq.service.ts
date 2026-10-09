// FAQs: listing, search, CRUD and the fixed FAQ type list.
import { faqRepository } from "./faq.repository";
import { toFaqDto, toFaqTypeDto } from "./faq.transformer";
import { matchesAllTokens } from "../../utils/searchFilter";
import type {
  FaqCategory,
  FaqCreateInput,
  FaqDto,
  FaqTypeDto,
  FaqUpdateInput,
} from "./faq.types";
import { FAQ_TYPES } from "./faq.types";
import { parsePositiveInt } from "../../utils/parseId";

export const parseFaqId = parsePositiveInt;

/**
 * Case- and space-insensitive, since the UI shows the label ("Referral") while
 * the slug is lowercase.
 *
 * `{ ok: false }` (unknown category) must not be treated as "no filter": that
 * would mix all types and hide the typo. Callers return 422, as
 * `/client/subscriptions/access` does for a bad `kinds`.
 */
export const resolveFaqTypeFilter = (
  typeId?: string
): { ok: true; type?: FaqCategory } | { ok: false } => {
  const raw = (typeId ?? "").trim();
  if (!raw) return { ok: true, type: undefined }; // absent → all types
  const match = (FAQ_TYPES as readonly string[]).find(
    (t) => t.toLowerCase() === raw.toLowerCase()
  );
  return match ? { ok: true, type: match as FaqCategory } : { ok: false };
};

export const FAQ_TYPE_FILTER_MESSAGE = `Invalid \`type\`. Allowed: ${FAQ_TYPES.join(", ")}.`;

const resolveCategoryFilter = (typeId?: string): FaqCategory | undefined => {
  const r = resolveFaqTypeFilter(typeId);
  return r.ok ? r.type : undefined;
};

export const listFaqs = async (opts?: {
  typeId?: string;
}): Promise<FaqDto[]> => {
  const type = resolveCategoryFilter(opts?.typeId);
  const rows = await faqRepository.findMany(type ? { type } : undefined);
  return rows.map(toFaqDto);
};

/** `skip`/`take` are opt-in; without them the full filtered list is returned. */
export const listFaqsPaged = async (q: {
  typeId?: string;
  search?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  skip?: number;
  take?: number;
}): Promise<{ items: FaqDto[]; total: number }> => {
  const type = resolveCategoryFilter(q.typeId);
  const opts = { type, search: q.search, sortBy: q.sortBy, sortDir: q.sortDir, skip: q.skip, take: q.take };
  const [rows, total] = await Promise.all([
    faqRepository.findPage(opts),
    faqRepository.count(opts),
  ]);
  return { items: rows.map(toFaqDto), total };
};

// Client list: oldest first, opt-in paging.
export const listFaqsClientPaged = async (q: {
  typeId?: string;
  search?: string;
  skip?: number;
  take?: number;
}): Promise<{ items: FaqDto[]; total: number }> => {
  const type = resolveCategoryFilter(q.typeId);
  const opts = {
    type,
    search: q.search,
    sortBy: "createdAt",
    sortDir: "asc" as const,
    skip: q.skip,
    take: q.take,
  };
  const [rows, total] = await Promise.all([
    faqRepository.findPage(opts),
    faqRepository.count(opts),
  ]);
  return { items: rows.map(toFaqDto), total };
};

export const getFaqById = async (id: string): Promise<FaqDto | null> => {
  const numId = parseFaqId(id);
  if (!numId) return null;
  const row = await faqRepository.findById(numId);
  return row ? toFaqDto(row) : null;
};

export const createFaq = async (
  input: FaqCreateInput
): Promise<FaqDto> => {
  const row = await faqRepository.create(input);
  return toFaqDto(row);
};

export const updateFaq = async (
  id: string,
  input: FaqUpdateInput
): Promise<FaqDto | null> => {
  const numId = parseFaqId(id);
  if (!numId) return null;
  try {
    const row = await faqRepository.update(numId, input);
    return toFaqDto(row);
  } catch {
    return null;
  }
};

export const deleteFaq = async (id: string): Promise<boolean> => {
  const numId = parseFaqId(id);
  if (!numId) return false;
  try {
    await faqRepository.delete(numId);
    return true;
  } catch {
    return false;
  }
};

export const countFaqsByCategory = async (
  type: FaqCategory
): Promise<number> => {
  return faqRepository.countByType(type);
};

export const listFaqTypes = async (): Promise<FaqTypeDto[]> => {
  return FAQ_TYPES.map((t) => ({
    ...toFaqTypeDto(t),
    createdAt: undefined,
    updatedAt: undefined,
  }));
};

/** FAQ types are a fixed list (no table), so search/paging apply in memory. */
export const listFaqTypesClientPaged = async (q: {
  search?: string;
  skip?: number;
  take?: number;
}): Promise<{ items: FaqTypeDto[]; total: number }> => {
  const all: FaqTypeDto[] = FAQ_TYPES.map((t) => ({
    ...toFaqTypeDto(t),
    createdAt: undefined,
    updatedAt: undefined,
  }));
  const filtered = all.filter((t) => matchesAllTokens(q.search, [t.title]));
  const total = filtered.length;
  const start = q.skip ?? 0;
  const items =
    q.take != null ? filtered.slice(start, start + q.take) : filtered.slice(start);
  return { items, total };
};
