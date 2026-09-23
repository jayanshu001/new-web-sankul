import { paperRepository } from "./paper.repository";
import { toPaperDto } from "./paper.transformer";
import { slugify, uniqueSlug } from "../../utils/slug";
import { prisma } from "../../config/prisma";
import { revalidateJobsApiCache } from "../../utils/jobsApiCache";
import logger from "../../utils/logger";
import type { PaperDto, PaperListQuery, PaperWriteInput } from "./paper.types";

export const parsePaperId = (id: string): bigint | null => (/^\d+$/.test(id) ? BigInt(id) : null);

// Best-effort side effect of a write that already succeeded — never turns a
// successful create/update/delete into a failure response for the caller.
const safeRevalidatePreviousPapers = async (id: string) => {
  try {
    await revalidateJobsApiCache("previouspapers", id);
  } catch (error) {
    logger.error("jobs-papers: jobs-api cache revalidate failed", { id, error });
  }
};

export const listPapersPaged = async (
  q: PaperListQuery
): Promise<{ items: PaperDto[]; total: number }> => {
  const [rows, total] = await Promise.all([paperRepository.findPage(q), paperRepository.count(q)]);
  return { items: rows.map(toPaperDto), total };
};

export const getPaperById = async (id: string): Promise<PaperDto | null> => {
  const numId = parsePaperId(id);
  if (numId === null) return null;
  const row = await paperRepository.findById(numId);
  return row ? toPaperDto(row) : null;
};

const paperSlugExists = async (candidate: string, excludeId?: bigint) => {
  const existing = await prisma.jobPreviousPaper.findFirst({ where: { slug: candidate } });
  return existing !== null && existing.id !== excludeId;
};

export const createPaper = async (input: PaperWriteInput): Promise<PaperDto> => {
  const slug = input.slug
    ? await uniqueSlug(slugify(input.slug), (c) => paperSlugExists(c))
    : input.title
      ? await uniqueSlug(input.title, (c) => paperSlugExists(c))
      : undefined;
  const row = await paperRepository.create({ ...input, slug });
  await safeRevalidatePreviousPapers(row.slug ?? String(row.id));
  return toPaperDto(row);
};

export const updatePaper = async (id: string, input: PaperWriteInput): Promise<PaperDto | null> => {
  const numId = parsePaperId(id);
  if (numId === null) return null;
  const slug = input.slug ? await uniqueSlug(slugify(input.slug), (c) => paperSlugExists(c, numId)) : undefined;

  try {
    const row = await paperRepository.update(numId, { ...input, slug });
    await safeRevalidatePreviousPapers(row.slug ?? String(row.id));
    return toPaperDto(row);
  } catch {
    return null;
  }
};

export const deletePaper = async (id: string): Promise<boolean> => {
  const numId = parsePaperId(id);
  if (numId === null) return false;
  const existing = await paperRepository.findById(numId);
  try {
    await paperRepository.delete(numId);
  } catch {
    return false;
  }
  if (existing) await safeRevalidatePreviousPapers(existing.slug ?? String(existing.id));
  return true;
};
