import { z } from "zod";
import { JOB_PAPER_STATUSES, JOB_PAPER_TIERS } from "./paper.types";

const zBool = z.preprocess((v) => (typeof v === "string" ? v === "true" : v), z.boolean());

export const paperWriteSchema = z.object({
  slug: z.string().max(255).optional(),
  title: z.string().max(255).optional(),
  subtitle: z.string().max(255).optional(),
  subject: z.string().max(255).optional(),
  formatLabel: z.string().max(50).optional(),
  yearsLabel: z.string().max(255).optional(),
  year: z.coerce.number().int().optional(),
  tier: z.enum(JOB_PAPER_TIERS).optional(),
  language: z.string().max(255).optional(),
  isSolved: zBool.optional(),
  organizationId: z.coerce.bigint().optional(),
  categoryId: z.coerce.bigint().optional(),
  previewUrl: z.string().max(1000).optional(),
  description: z.string().optional(),
  status: z.enum(JOB_PAPER_STATUSES),
  publishedAt: z.coerce.date().optional().nullable(),
  files: z.array(z.object({ label: z.string().optional(), url: z.string().min(1) })).optional(),
  jobIds: z.array(z.coerce.bigint()).optional(),
  tags: z.array(z.string()).optional(),
  products: z
    .array(
      z.object({
        productType: z.enum(["course", "package", "book", "ebook"]),
        productId: z.coerce.bigint(),
        isFeatured: zBool.optional(),
      })
    )
    .optional(),
});

export const paperUpdateSchema = paperWriteSchema.partial().extend({
  status: z.enum(JOB_PAPER_STATUSES),
});
