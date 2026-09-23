import { Prisma } from "@prisma/client";
import { HttpError } from "../../middlewares/errorHandler";
import { suggestedProductRepository } from "./suggested-product.repository";
import { toSuggestedProductDto } from "./suggested-product.transformer";
import { revalidateJobsApiCache } from "../../utils/jobsApiCache";
import logger from "../../utils/logger";
import type {
  SuggestedProductCreateInput,
  SuggestedProductDto,
  SuggestedProductListQuery,
  SuggestedProductUpdateInput,
} from "./suggested-product.types";

export const parseSuggestedProductId = (id: string): bigint | null => (/^\d+$/.test(id) ? BigInt(id) : null);

// Best-effort side effect of a write that already succeeded — never turns a
// successful create/update/delete into a failure response for the caller.
// No placement id passed: the two repos' enum encodings (JobSuggestedPlacement
// here vs SuggestedProductPlacement there) aren't guaranteed to line up
// byte-for-byte, so a broad clear of this entity is the safe choice.
const safeRevalidateSuggestedProducts = async () => {
  try {
    await revalidateJobsApiCache("suggestedproducts");
  } catch (error) {
    logger.error("jobs-suggested-products: jobs-api cache revalidate failed", { error });
  }
};

const DUPLICATE_MESSAGE = "This product is already suggested for this placement.";

const runOrThrowDuplicate = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new HttpError(422, DUPLICATE_MESSAGE);
    }
    throw err;
  }
};

export const listSuggestedProductsPaged = async (
  q: SuggestedProductListQuery
): Promise<{ items: SuggestedProductDto[]; total: number }> => {
  const [rows, total] = await Promise.all([
    suggestedProductRepository.findPage(q),
    suggestedProductRepository.count(q.placementType),
  ]);
  return { items: rows.map(toSuggestedProductDto), total };
};

export const getSuggestedProductById = async (id: string): Promise<SuggestedProductDto | null> => {
  const numId = parseSuggestedProductId(id);
  if (numId === null) return null;
  const row = await suggestedProductRepository.findById(numId);
  return row ? toSuggestedProductDto(row) : null;
};

export const createSuggestedProduct = async (
  input: SuggestedProductCreateInput
): Promise<SuggestedProductDto> =>
  runOrThrowDuplicate(async () => {
    const row = await suggestedProductRepository.create(input);
    await safeRevalidateSuggestedProducts();
    return toSuggestedProductDto(row);
  });

export const updateSuggestedProduct = async (
  id: string,
  input: SuggestedProductUpdateInput
): Promise<SuggestedProductDto | null> => {
  const numId = parseSuggestedProductId(id);
  if (numId === null) return null;
  return runOrThrowDuplicate(async () => {
    const row = await suggestedProductRepository.update(numId, input);
    await safeRevalidateSuggestedProducts();
    return toSuggestedProductDto(row);
  });
};

export const deleteSuggestedProduct = async (id: string): Promise<boolean> => {
  const numId = parseSuggestedProductId(id);
  if (numId === null) return false;
  try {
    await suggestedProductRepository.delete(numId);
  } catch {
    return false;
  }
  await safeRevalidateSuggestedProducts();
  return true;
};
