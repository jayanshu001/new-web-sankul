import { contentRepository } from "./content.repository";
import { toContentDto } from "./content.transformer";
import { slugify, uniqueSlug } from "../../utils/slug";
import { syncContentToSearchIndex, removeFromSearchIndex } from "../jobs-search/search.service";
import { revalidateJobsApiCache, jobsApiEntityForContentType } from "../../utils/jobsApiCache";
import { JOB_CONTENT_TYPES } from "./content.types";
import logger from "../../utils/logger";
import type {
  ContentListQuery,
  ContentWriteInput,
  JobContentDto,
  JobContentStatus,
  JobContentType,
} from "./content.types";

export const parseContentId = (id: string): bigint | null => (/^\d+$/.test(id) ? BigInt(id) : null);

// Search-index sync is a best-effort side effect of a write that already
// succeeded — it must never turn a successful create/update/delete into a
// failure response for the caller. Failures are logged, not thrown.
const safeSyncSearchIndex = async (contentId: bigint) => {
  try {
    await syncContentToSearchIndex(contentId);
  } catch (error) {
    logger.error("jobs-content: search index sync failed", { contentId: contentId.toString(), error });
  }
};

const safeRemoveFromSearchIndex = async (type: string, contentId: bigint) => {
  try {
    await removeFromSearchIndex(type, contentId);
  } catch (error) {
    logger.error("jobs-content: search index removal failed", { contentId: contentId.toString(), type, error });
  }
};

// Same best-effort contract as safeSyncSearchIndex above — a jobs-api outage
// must never turn a successful admin write into a failure response.
const safeRevalidateJobsApiCache = async (type: string, slug: string) => {
  try {
    await revalidateJobsApiCache(jobsApiEntityForContentType(type), slug);
  } catch (error) {
    logger.error("jobs-content: jobs-api cache revalidate failed", { type, slug, error });
  }
};

export const resolveContentType = (value?: string): JobContentType | undefined => {
  if (!value) return undefined;
  return (JOB_CONTENT_TYPES as readonly string[]).find((t) => t === value) as JobContentType | undefined;
};

export const listContentPaged = async (
  q: ContentListQuery
): Promise<{ items: JobContentDto[]; total: number }> => {
  const [rows, total] = await Promise.all([contentRepository.findPage(q), contentRepository.count(q)]);
  return { items: rows.map((row) => toContentDto(row as never)), total };
};

export const getContentById = async (id: string): Promise<JobContentDto | null> => {
  const numId = parseContentId(id);
  if (numId === null) return null;
  const row = await contentRepository.findById(numId);
  return row ? toContentDto(row) : null;
};

const resolveSlug = async (input: ContentWriteInput, excludeId?: bigint): Promise<string> =>
  uniqueSlug(input.slug || input.title, async (candidate) => {
    const existing = await contentRepository.findBySlug(input.type, candidate);
    return existing !== null && existing.id !== excludeId;
  });

export const createContent = async (input: ContentWriteInput): Promise<JobContentDto> => {
  const slug = await resolveSlug(input);
  const row = await contentRepository.create({ ...input, slug });
  await safeSyncSearchIndex(row.id);
  await safeRevalidateJobsApiCache(row.type, row.slug);
  return toContentDto(row as never);
};

// featuredImageId / seo.ogImageId only arrive in the write payload when the
// admin uploaded a NEW file this save (see content.controller.ts's
// applyContentUploads — it's only set on an actual upload). Left as-is, a
// plain edit that doesn't touch the image would fall through to `?? null` in
// the repository and silently clear the existing featured/OG image on every
// save. Carry the current id forward when the payload doesn't replace it.
const preserveExistingImages = async (
  numId: bigint,
  input: ContentWriteInput
): Promise<ContentWriteInput> => {
  if (input.featuredImageId !== undefined && (!input.seo || input.seo.ogImageId !== undefined)) return input;
  const existing = await contentRepository.findById(numId);
  if (!existing) return input;
  return {
    ...input,
    featuredImageId: input.featuredImageId ?? existing.featuredImageId ?? undefined,
    seo: input.seo ? { ...input.seo, ogImageId: input.seo.ogImageId ?? existing.seo?.ogImageId ?? undefined } : input.seo,
  };
};

export const updateContent = async (id: string, input: ContentWriteInput): Promise<JobContentDto | null> => {
  const numId = parseContentId(id);
  if (numId === null) return null;
  const slug = input.slug ? slugify(input.slug) : undefined;
  const resolvedSlug = await resolveSlug({ ...input, slug }, numId);
  const mergedInput = await preserveExistingImages(numId, input);
  let row;
  try {
    row = await contentRepository.update(numId, { ...mergedInput, slug: resolvedSlug });
  } catch {
    return null;
  }
  await safeSyncSearchIndex(numId);
  await safeRevalidateJobsApiCache(row.type, row.slug);
  return toContentDto(row);
};

export const setContentStatus = async (
  id: string,
  status: JobContentStatus
): Promise<JobContentDto | null> => {
  const numId = parseContentId(id);
  if (numId === null) return null;
  let row;
  try {
    const publishedAt = status === "published" ? new Date() : undefined;
    row = await contentRepository.updateStatus(numId, status, publishedAt);
  } catch {
    return null;
  }
  await safeSyncSearchIndex(numId);
  await safeRevalidateJobsApiCache(row.type, row.slug);
  return toContentDto(row);
};

export const deleteContent = async (id: string): Promise<boolean> => {
  const numId = parseContentId(id);
  if (numId === null) return false;
  const existing = await contentRepository.findById(numId);
  if (!existing) return false;
  try {
    await contentRepository.delete(numId);
  } catch {
    return false;
  }
  await safeRemoveFromSearchIndex(existing.type, numId);
  await safeRevalidateJobsApiCache(existing.type, existing.slug);
  return true;
};

export const reorderContent = async (orders: { id: string; order: number }[]): Promise<void> => {
  const parsed = orders
    .map(({ id, order }) => ({ id: parseContentId(id), order }))
    .filter((o): o is { id: bigint; order: number } => o.id !== null);
  if (parsed.length === 0) return;
  await contentRepository.reorder(parsed);
  try {
    await revalidateJobsApiCache("content");
  } catch (error) {
    logger.error("jobs-content: jobs-api cache revalidate failed (reorder)", { error });
  }
};
