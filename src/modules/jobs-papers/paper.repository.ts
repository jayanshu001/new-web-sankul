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

// Storage shape is the legacy Laravel admin's (GovtJobRecruitmentService::savePaper):
//  - pdf_url   : JSON-encoded [{label,url}] (a plain URL is legacy single-file)
//  - job_ids   : JSON array of ints; content_id mirrors the first one
//  - products  : JSON [{product_type, product_id:"123", is_featured:"1"?}]
const writeTags = async (tx: Tx, paperId: bigint, input: PaperWriteInput) => {
  await tx.jobPreviousPaperTag.deleteMany({ where: { paperId } });
  for (const tag of input.tags ?? []) {
    await tx.jobPreviousPaperTag.create({ data: { paperId, tag } });
  }
};

const pdfUrlOf = (files: PaperWriteInput["files"]) => {
  if (files === undefined) return undefined;
  const list = files.map((f) => ({ label: f.label?.trim() || null, url: f.url }));
  return list.length ? JSON.stringify(list) : null;
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
  ...(input.files !== undefined ? { papersCount: input.files.length } : {}),
  pdfUrl: pdfUrlOf(input.files),
  ...(input.jobIds !== undefined
    ? { jobIds: input.jobIds.map(Number), contentId: input.jobIds.length ? input.jobIds[0] : null }
    : {}),
  products: input.products
    ? input.products.map((p) => ({
        product_type: p.productType,
        product_id: String(p.productId),
        ...(p.isFeatured ? { is_featured: "1" } : {}),
      }))
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
          publishedAt: input.publishedAt ?? (input.status === "published" ? new Date() : undefined),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await writeTags(tx, base.id, input);
      return tx.jobPreviousPaper.findUniqueOrThrow({ where: { id: base.id }, include: PAPER_INCLUDE });
    }),

  update: (id: bigint, input: PaperWriteInput) =>
    prisma.$transaction(async (tx) => {
      const existing = await tx.jobPreviousPaper.findUniqueOrThrow({ where: { id }, select: { publishedAt: true } });
      await tx.jobPreviousPaper.update({
        where: { id },
        data: {
          ...baseData(input),
          organizationId: input.organizationId ?? null,
          categoryId: input.categoryId ?? null,
          ...(input.previewUrl !== undefined ? { previewUrl: input.previewUrl } : {}),
          publishedAt: input.publishedAt ?? existing.publishedAt ?? (input.status === "published" ? new Date() : null),
          updatedAt: new Date(),
        },
      });
      await writeTags(tx, id, input);
      return tx.jobPreviousPaper.findUniqueOrThrow({ where: { id }, include: PAPER_INCLUDE });
    }),

  delete: (id: bigint) => prisma.jobPreviousPaper.delete({ where: { id } }),
};
