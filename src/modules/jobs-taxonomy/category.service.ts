import { categoryRepository } from "./category.repository";
import { toCategoryDto } from "./category.transformer";
import { slugify, uniqueSlug } from "../../utils/slug";
import { revalidateJobsApiCache } from "../../utils/jobsApiCache";
import logger from "../../utils/logger";
import type { CategoryCreateInput, CategoryDto, CategoryListQuery, CategoryUpdateInput } from "./category.types";

export const parseCategoryId = (id: string): bigint | null => {
  if (!/^\d+$/.test(id)) return null;
  return BigInt(id);
};

// Best-effort side effect of a write that already succeeded — never turns a
// successful create/update/delete into a failure response for the caller.
const safeRevalidateCategories = async () => {
  try {
    await revalidateJobsApiCache("categories");
  } catch (error) {
    logger.error("jobs-taxonomy: jobs-api cache revalidate failed (categories)", { error });
  }
};

export const listCategoriesPaged = async (
  q: CategoryListQuery
): Promise<{ items: CategoryDto[]; total: number }> => {
  const [rows, total] = await Promise.all([
    categoryRepository.findPage(q),
    categoryRepository.count(q.search),
  ]);
  return { items: rows.map(toCategoryDto), total };
};

export const getCategoryById = async (id: string): Promise<CategoryDto | null> => {
  const numId = parseCategoryId(id);
  if (numId === null) return null;
  const row = await categoryRepository.findById(numId);
  return row ? toCategoryDto(row) : null;
};

export const createCategory = async (input: CategoryCreateInput): Promise<CategoryDto> => {
  const slug = await uniqueSlug(
    input.slug || input.label,
    async (candidate) => (await categoryRepository.findBySlug(candidate)) !== null
  );
  const row = await categoryRepository.create({ ...input, slug });
  await safeRevalidateCategories();
  return toCategoryDto(row);
};

export const updateCategory = async (
  id: string,
  input: CategoryUpdateInput
): Promise<CategoryDto | null> => {
  const numId = parseCategoryId(id);
  if (numId === null) return null;
  const nextInput = { ...input };
  if (input.slug !== undefined) {
    const normalized = slugify(input.slug);
    nextInput.slug = await uniqueSlug(normalized, async (candidate) => {
      const existing = await categoryRepository.findBySlug(candidate);
      return existing !== null && existing.id !== numId;
    });
  }
  try {
    const row = await categoryRepository.update(numId, nextInput);
    await safeRevalidateCategories();
    return toCategoryDto(row);
  } catch {
    return null;
  }
};

export const deleteCategory = async (id: string): Promise<boolean> => {
  const numId = parseCategoryId(id);
  if (numId === null) return false;
  try {
    await categoryRepository.delete(numId);
  } catch {
    return false;
  }
  await safeRevalidateCategories();
  return true;
};

export const reorderCategories = async (orders: { id: string; order: number }[]): Promise<void> => {
  const parsed = orders
    .map(({ id, order }) => ({ id: parseCategoryId(id), order }))
    .filter((o): o is { id: bigint; order: number } => o.id !== null);
  if (parsed.length === 0) return;
  await categoryRepository.reorder(parsed);
  await safeRevalidateCategories();
};
