export const JOB_PAPER_TIERS = ["tier_1", "tier_2", "pre", "mains", "all"] as const;
export type JobPaperTier = (typeof JOB_PAPER_TIERS)[number];

export const JOB_PAPER_STATUSES = ["draft", "published", "expired"] as const;
export type JobPaperStatus = (typeof JOB_PAPER_STATUSES)[number];

export interface PaperFileDto {
  _id: string;
  label?: string;
  url: string;
}

export interface PaperProductDto {
  _id: string;
  productType: "course" | "package" | "book" | "ebook";
  productId: string;
  isFeatured: boolean;
}

export interface PaperDto {
  _id: string;
  slug?: string;
  title?: string;
  subtitle?: string;
  subject?: string;
  formatLabel?: string;
  yearsLabel?: string;
  year?: number;
  papersCount: number;
  downloadsCount: number;
  tier?: JobPaperTier;
  language?: string;
  isSolved: boolean;
  organizationId?: string;
  categoryId?: string;
  previewUrl?: string;
  description?: string;
  status: JobPaperStatus;
  publishedAt?: Date;
  // Single-file: `wsj_previous_paper_files` no longer exists, so only the
  // first uploaded file (`pdfUrl`) is kept — 0 or 1 items, never more.
  files: PaperFileDto[];
  jobIds: string[];
  tags: string[];
  products: PaperProductDto[];
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PaperWriteInput {
  slug?: string;
  title?: string;
  subtitle?: string;
  subject?: string;
  formatLabel?: string;
  yearsLabel?: string;
  year?: number;
  tier?: JobPaperTier;
  language?: string;
  isSolved?: boolean;
  organizationId?: bigint | null;
  categoryId?: bigint | null;
  previewUrl?: string | null;
  description?: string;
  status: JobPaperStatus;
  publishedAt?: Date | null;
  files?: { label?: string; url: string }[];
  jobIds?: bigint[];
  tags?: string[];
  products?: { productType: "course" | "package" | "book" | "ebook"; productId: bigint; isFeatured?: boolean }[];
}

export interface PaperListQuery {
  status?: JobPaperStatus;
  tier?: JobPaperTier;
  organizationId?: bigint;
  categoryId?: bigint;
  search?: string;
  skip: number;
  take: number;
}
