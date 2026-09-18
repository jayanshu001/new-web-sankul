import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";
import type { PaperListQuery, PaperWriteInput } from "./paper.types";

export const PAPER_INCLUDE = {
  tags: true,
} as const;

const buildWhere = (q: Partial<PaperListQuery>) => {
  const where: Record<string, unknown> = {};
  if (q.status) where.status = q.status;
  if (q.tier) where.tier = q.tier;
  if (q.organizationId) where.organizationId = q.organizationId;
  if (q.categoryId) where.categoryId = q.categoryId;
  const search = buildPrismaSearch(q.search, ["title", "subtitle", "subject"]);
  if (search) where.AND = search.AND;
  return where;
};

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

// `wsj_previous_paper_files`/`_job_links`/`_products` (as a distinct table)
// no longer exist. `jobIds`/`products` now live in the `Json?` columns
// already on `wsj_previous_papers`; a multi-file upload collapses to the
// first file's URL in `pdfUrl` (the only storage left for it).
const writeTags = async (tx: Tx, paperId: bigint, input: PaperWriteInput) => {
  await tx.jobPreviousPaperTag.deleteMany({ where: { paperId } });
  for (const tag of input.tags ?? []) {
    await tx.jobPreviousPaperTag.create({ data: { paperId, tag } });
  }
};

const baseData = (input: PaperWriteInput) => ({
  slug: input.slug,
  title: input.title,
  subtitle: input.subtitle,
  subject: input.subject,
  formatLabel: input.formatLabel,
  yearsLabel: input.yearsLabel,
  year: input.year,
  tier: input.tier,
  language: input.language,
  isSolved: input.isSolved ?? false,
  description: input.description,
  status: input.status,
  papersCount: input.files?.length ?? 0,
  pdfUrl: input.files?.[0]?.url,
  jobIds: input.jobIds ? input.jobIds.map(String) : undefined,
  products: input.products
    ? input.products.map((p) => ({ ...p, productId: String(p.productId) }))
    : undefined,
});

export const paperRepository = {
  findPage: (q: PaperListQuery) =>
    prisma.jobPreviousPaper.findMany({
      where: buildWhere(q),
      include: PAPER_INCLUDE,
      orderBy: [{ year: "desc" }, { id: "desc" }],
      skip: q.skip,
      take: q.take,
    }),

  count: (q: Partial<PaperListQuery>) => prisma.jobPreviousPaper.count({ where: buildWhere(q) }),

  findById: (id: bigint) => prisma.jobPreviousPaper.findUnique({ where: { id }, include: PAPER_INCLUDE }),

  create: (input: PaperWriteInput) =>
    prisma.$transaction(async (tx) => {
      const base = await tx.jobPreviousPaper.create({
        data: {
          ...baseData(input),
          organizationId: input.organizationId ?? undefined,
          categoryId: input.categoryId ?? undefined,
          previewUrl: input.previewUrl ?? undefined,
          publishedAt: input.publishedAt ?? undefined,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await writeTags(tx, base.id, input);
      return tx.jobPreviousPaper.findUniqueOrThrow({ where: { id: base.id }, include: PAPER_INCLUDE });
    }),

  update: (id: bigint, input: PaperWriteInput) =>
    prisma.$transaction(async (tx) => {
      await tx.jobPreviousPaper.update({
        where: { id },
        data: {
          ...baseData(input),
          organizationId: input.organizationId ?? null,
          categoryId: input.categoryId ?? null,
          ...(input.previewUrl !== undefined ? { previewUrl: input.previewUrl } : {}),
          publishedAt: input.publishedAt ?? null,
          updatedAt: new Date(),
        },
      });
      await writeTags(tx, id, input);
      return tx.jobPreviousPaper.findUniqueOrThrow({ where: { id }, include: PAPER_INCLUDE });
    }),

  delete: (id: bigint) => prisma.jobPreviousPaper.delete({ where: { id } }),
};
