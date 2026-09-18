import type { Prisma } from "@prisma/client";
import type { PAPER_INCLUDE } from "./paper.repository";
import type { PaperDto } from "./paper.types";

type PaperRow = Prisma.JobPreviousPaperGetPayload<{ include: typeof PAPER_INCLUDE }>;

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
  previewMedia: row.previewMedia
    ? { _id: String(row.previewMedia.id), url: row.previewMedia.url, altText: row.previewMedia.altText ?? undefined }
    : undefined,
  description: row.description ?? undefined,
  status: row.status,
  publishedAt: row.publishedAt ?? undefined,
  files: row.files.map((f) => ({ _id: String(f.id), label: f.label ?? undefined, url: f.url })),
  jobIds: row.jobLinks.map((l) => String(l.contentId)),
  tags: row.tags.map((t) => t.tag ?? "").filter(Boolean),
  products: row.contentProducts.map((p) => ({
    _id: String(p.id),
    productType: p.productType,
    productId: String(p.productId),
    isFeatured: p.isFeatured,
  })),
  createdAt: row.createdAt ?? undefined,
  updatedAt: row.updatedAt ?? undefined,
});
