import { organizationRepository } from "./organization.repository";
import { toOrganizationDto } from "./organization.transformer";
import { slugify, uniqueSlug } from "../../utils/slug";
import { revalidateJobsApiCache } from "../../utils/jobsApiCache";
import logger from "../../utils/logger";
import type {
  OrganizationCreateInput,
  OrganizationDto,
  OrganizationUpdateInput,
} from "./organization.types";

export const parseOrganizationId = (id: string): bigint | null => {
  if (!/^\d+$/.test(id)) return null;
  return BigInt(id);
};

// Organizations have no standalone public list/detail in jobs-api — their
// name/logo are only ever embedded inline in cached content/paper responses,
// so an edit on an org already linked to published content needs a broad
// flush (no per-org cache entity exists to target narrowly). Best-effort,
// never turns a successful write into a failure response.
const safeRevalidateAll = async () => {
  try {
    await revalidateJobsApiCache("all");
  } catch (error) {
    logger.error("jobs-taxonomy: jobs-api cache revalidate failed (organizations)", { error });
  }
};

export const listOrganizationsPaged = async (q: {
  search?: string;
  skip: number;
  take: number;
}): Promise<{ items: OrganizationDto[]; total: number }> => {
  const [rows, total] = await Promise.all([
    organizationRepository.findPage(q),
    organizationRepository.count(q.search),
  ]);
  return { items: rows.map(toOrganizationDto), total };
};

export const getOrganizationById = async (id: string): Promise<OrganizationDto | null> => {
  const numId = parseOrganizationId(id);
  if (numId === null) return null;
  const row = await organizationRepository.findById(numId);
  return row ? toOrganizationDto(row) : null;
};

export const createOrganization = async (
  input: OrganizationCreateInput
): Promise<OrganizationDto> => {
  const slug = await uniqueSlug(
    input.slug || input.name,
    async (candidate) => (await organizationRepository.findBySlug(candidate)) !== null
  );
  const row = await organizationRepository.create({ ...input, slug });
  return toOrganizationDto(row);
};

export const updateOrganization = async (
  id: string,
  input: OrganizationUpdateInput
): Promise<OrganizationDto | null> => {
  const numId = parseOrganizationId(id);
  if (numId === null) return null;
  const nextInput = { ...input };
  if (input.slug !== undefined) {
    const normalized = slugify(input.slug);
    nextInput.slug = await uniqueSlug(normalized, async (candidate) => {
      const existing = await organizationRepository.findBySlug(candidate);
      return existing !== null && existing.id !== numId;
    });
  }
  try {
    const row = await organizationRepository.update(numId, nextInput);
    await safeRevalidateAll();
    return toOrganizationDto(row);
  } catch {
    return null;
  }
};

export const deleteOrganization = async (id: string): Promise<boolean> => {
  const numId = parseOrganizationId(id);
  if (numId === null) return false;
  try {
    await organizationRepository.delete(numId);
  } catch {
    return false;
  }
  await safeRevalidateAll();
  return true;
};
