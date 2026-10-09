// Commerce prices: active plan lookups by package, ebook or course.
import { commercePriceRepository as repo } from "./commerce-price.repository";
import { toPriceDto } from "./commerce-price.transformer";
import type { PriceDto } from "./commerce-price.types";

export const listActivePricesByPackage = async (packageId: number): Promise<PriceDto[]> => {
  const rows = await repo.listActiveByPackage(packageId);
  return rows.map(toPriceDto);
};

/** Batched `listActivePricesByPackage`: same filter and duration-asc order, one query. */
export const listActivePricesByPackages = async (packageIds: number[]): Promise<PriceDto[]> => {
  const rows = await repo.listActiveByPackages(packageIds);
  return rows.map(toPriceDto);
};

export const listActivePricesByEbook = async (ebookId: number): Promise<PriceDto[]> => {
  const rows = await repo.listActiveByEbook(ebookId);
  return rows.map(toPriceDto);
};

export const listActivePricesByCourses = async (courseIds: number[]): Promise<PriceDto[]> => {
  const rows = await repo.listActiveByCourses(courseIds);
  return rows.map(toPriceDto);
};

export const listActivePricesByEbooks = async (ebookIds: number[]): Promise<PriceDto[]> => {
  const rows = await repo.listActiveByEbooks(ebookIds);
  return rows.map(toPriceDto);
};
