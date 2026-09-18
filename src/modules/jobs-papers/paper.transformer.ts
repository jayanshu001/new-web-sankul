import type { Prisma } from "@prisma/client";
import type { PAPER_INCLUDE } from "./paper.repository";
import type { PaperDto, PaperProductDto } from "./paper.types";

type PaperRow = Prisma.JobPreviousPaperGetPayload<{ include: typeof PAPER_INCLUDE }>;

const asStringArray = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

const asProducts = (value: unknown): PaperProductDto[] => {
  if (!Array.isArray(value)) return [];
  return value.map((p, i) => {
    const row = p as Record<string, unknown>;
    return {
      _id: String(i),
      productType: row.productType as PaperProductDto["productType"],
      productId: String(row.productId),
      isFeatured: Boolean(row.isFeatured),
    };
  });
};

export const toPaperDto = (row: PaperRow): PaperDto => ({
  _id: String(row.id),
  slug: row.slug ?? undefined,
  title: row.title ?? undefined,
  subtitle: row.subtitle ?? undefined,
  subject: row.subject ?? undefined,
  formatLabel: row.formatLabel ?? undefined,
  yearsLabel: row.yearsLabel ?? undefined,
  year: row.year ?? undefined,
  papersCount: row.papersCount,
  downloadsCount: row.downloadsCount,
  tier: row.tier ?? undefined,
  language: row.language ?? undefined,
  isSolved: row.isSolved ?? false,
  organizationId: row.organizationId ? String(row.organizationId) : undefined,
  categoryId: row.categoryId ? String(row.categoryId) : undefined,
  previewUrl: row.previewUrl ?? undefined,
  description: row.description ?? undefined,
  status: row.status,
  publishedAt: row.publishedAt ?? undefined,
  files: row.pdfUrl ? [{ _id: "1", url: row.pdfUrl }] : [],
  jobIds: asStringArray(row.jobIds),
  tags: row.tags.map((t) => t.tag ?? "").filter(Boolean),
  products: asProducts(row.products),
  createdAt: row.createdAt ?? undefined,
  updatedAt: row.updatedAt ?? undefined,
});
