import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";
import type { PaperListQuery, PaperWriteInput } from "./paper.types";

export const PAPER_INCLUDE = {
  previewMedia: true,
  files: { orderBy: { sortOrder: "asc" as const } },
  jobLinks: true,
  tags: true,
  contentProducts: { orderBy: { sortOrder: "asc" as const } },
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

const writeChildren = async (tx: Tx, paperId: bigint, input: PaperWriteInput) => {
  for (const [i, file] of (input.files ?? []).entries()) {
    await tx.jobPreviousPaperFile.create({ data: { paperId, sortOrder: i, label: file.label, url: file.url } });
  }
  for (const contentId of input.jobIds ?? []) {
    await tx.jobPreviousPaperJobLink.create({ data: { paperId, contentId } });
  }
  for (const tag of input.tags ?? []) {
    await tx.jobPreviousPaperTag.create({ data: { paperId, tag } });
  }
  for (const [i, product] of (input.products ?? []).entries()) {
    await tx.jobContentProduct.create({
      data: { paperId, sortOrder: i, productType: product.productType, productId: product.productId, isFeatured: product.isFeatured ?? false },
    });
  }
};

const clearChildren = async (tx: Tx, paperId: bigint) => {
  await tx.jobPreviousPaperFile.deleteMany({ where: { paperId } });
  await tx.jobPreviousPaperJobLink.deleteMany({ where: { paperId } });
  await tx.jobPreviousPaperTag.deleteMany({ where: { paperId } });
  await tx.jobContentProduct.deleteMany({ where: { paperId } });
};

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
          organizationId: input.organizationId ?? undefined,
          categoryId: input.categoryId ?? undefined,
          previewMediaId: input.previewMediaId ?? undefined,
          description: input.description,
          status: input.status,
          publishedAt: input.publishedAt ?? undefined,
          papersCount: input.files?.length ?? 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await writeChildren(tx, base.id, input);
      return tx.jobPreviousPaper.findUniqueOrThrow({ where: { id: base.id }, include: PAPER_INCLUDE });
    }),

  update: (id: bigint, input: PaperWriteInput) =>
    prisma.$transaction(async (tx) => {
      await tx.jobPreviousPaper.update({
        where: { id },
        data: {
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
          organizationId: input.organizationId ?? null,
          categoryId: input.categoryId ?? null,
          previewMediaId: input.previewMediaId ?? null,
          description: input.description,
          status: input.status,
          publishedAt: input.publishedAt ?? null,
          papersCount: input.files?.length ?? 0,
          updatedAt: new Date(),
        },
      });
      await clearChildren(tx, id);
      await writeChildren(tx, id, input);
      return tx.jobPreviousPaper.findUniqueOrThrow({ where: { id }, include: PAPER_INCLUDE });
    }),

  delete: (id: bigint) => prisma.jobPreviousPaper.delete({ where: { id } }),
};
