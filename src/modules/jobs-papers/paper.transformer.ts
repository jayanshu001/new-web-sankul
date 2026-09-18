import type { Prisma } from "@prisma/client";
import type { PAPER_INCLUDE } from "./paper.repository";
import type { PaperDto, PaperFileDto, PaperProductDto } from "./paper.types";

type PaperRow = Prisma.JobPreviousPaperGetPayload<{ include: typeof PAPER_INCLUDE }>;

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

// pdf_url is a JSON-encoded [{label,url}] (legacy admin) or a plain URL (older rows).
const parseFiles = (pdfUrl: string | null): PaperFileDto[] => {
  const raw = pdfUrl?.trim();
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const files: PaperFileDto[] = [];
        parsed.forEach((f) => {
          const row = f as Record<string, unknown>;
          const url = str(row?.url);
          if (url) files.push({ _id: String(files.length + 1), label: str(row?.label), url });
        });
        return files;
      }
    } catch {
      // fall through — treat as a plain URL
    }
  }
  return [{ _id: "1", url: raw }];
};

// job_ids holds ints (legacy) or strings; content_id is the single-link fallback.
const parseJobIds = (jobIds: unknown, contentId: bigint | null): string[] => {
  const ids = Array.isArray(jobIds) ? jobIds.map((v) => String(v)).filter((v) => /^\d+$/.test(v)) : [];
  if (ids.length) return [...new Set(ids)];
  return contentId ? [String(contentId)] : [];
};

// products hold snake_case rows (legacy); camelCase accepted for safety.
const asProducts = (value: unknown): PaperProductDto[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((p, i) => {
      const row = p as Record<string, unknown>;
      const productId = row.product_id ?? row.productId;
      const productType = row.product_type ?? row.productType;
      const featured = row.is_featured ?? row.isFeatured;
      return {
        _id: String(i),
        productType: productType as PaperProductDto["productType"],
        productId: String(productId ?? ""),
        isFeatured: featured === true || featured === 1 || featured === "1" || featured === "true",
      };
    })
    .filter((p) => p.productType && /^\d+$/.test(p.productId));
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
  files: parseFiles(row.pdfUrl),
  jobIds: parseJobIds(row.jobIds, row.contentId),
  tags: row.tags.map((t) => t.tag ?? "").filter(Boolean),
  products: asProducts(row.products),
  createdAt: row.createdAt ?? undefined,
  updatedAt: row.updatedAt ?? undefined,
});
