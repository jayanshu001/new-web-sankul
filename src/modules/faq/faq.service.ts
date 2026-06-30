import { faqRepository } from "./faq.repository";
import { toFaqDto, toFaqTypeDto } from "./faq.transformer";
import type {
  FaqCategory,
  FaqCreateInput,
  FaqCreateMongoInput,
  FaqDto,
  FaqTypeDto,
  FaqUpdateInput,
  FaqUpdateMongoInput,
} from "./faq.types";
import { FAQ_TYPES } from "./faq.types";

export const parseFaqId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const resolveCategoryFilter = (
  typeId?: string
): FaqCategory | undefined => {
  if (!typeId) return undefined;
  if ((FAQ_TYPES as readonly string[]).includes(typeId)) {
    return typeId as FaqCategory;
  }
  return undefined;
};

// ─── FAQ CRUD ────────────────────────────────────────────────────────────────

export const listFaqs = async (opts?: {
  typeId?: string;
}): Promise<FaqDto[]> => {
  const type = resolveCategoryFilter(opts?.typeId);
  const rows = await faqRepository.findMany(type ? { type } : undefined);
  return rows.map(toFaqDto);
};

/**
 * Admin server-side search + sort + opt-in pagination. `skip`/`take` apply only
 * when provided (absent → full filtered list). Always returns the total count.
 */
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

export const getFaqById = async (id: string): Promise<FaqDto | null> => {
  const numId = parseFaqId(id);
  if (!numId) return null;
  const row = await faqRepository.findById(numId);
  return row ? toFaqDto(row) : null;
};

export const createFaq = async (
  input: FaqCreateInput | FaqCreateMongoInput
): Promise<FaqDto> => {
  const row = await faqRepository.create(input as FaqCreateInput);
  return toFaqDto(row);
};

export const updateFaq = async (
  id: string,
  input: FaqUpdateInput | FaqUpdateMongoInput
): Promise<FaqDto | null> => {
  const numId = parseFaqId(id);
  if (!numId) return null;
  try {
    const row = await faqRepository.update(numId, input as FaqUpdateInput);
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

export const isFaqTypeInUse = async (typeIdOrCategory: string): Promise<boolean> => {
  if ((FAQ_TYPES as readonly string[]).includes(typeIdOrCategory)) {
    return (await countFaqsByCategory(typeIdOrCategory as FaqCategory)) > 0;
  }
  return false;
};

// ─── FAQ types (synthetic list on MySQL) ─────────────────────────────────────

export const listFaqTypes = async (): Promise<FaqTypeDto[]> => {
  return FAQ_TYPES.map((t) => ({
    ...toFaqTypeDto(t),
    createdAt: undefined,
    updatedAt: undefined,
  }));
};
