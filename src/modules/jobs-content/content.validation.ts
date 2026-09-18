import { z } from "zod";
import { JOB_CONTENT_STATUSES, JOB_CONTENT_TYPES, JOB_SECTION_BLOCK_TYPES, JOB_SECTION_POSITIONS } from "./content.types";
import { jobContentSeoSchema } from "../jobs-seo/seo.validation";

const zBool = z.preprocess((v) => (typeof v === "string" ? v === "true" : v), z.boolean());
const zDate = z.coerce.date();
const zBigIntArray = z.array(z.coerce.bigint());
const zStringArray = z.array(z.string());

const stepSchema = z.object({ title: z.string().optional(), description: z.string().optional() });

const factSchema = z.object({
  icon: z.string().optional(),
  metaKey: z.string().optional(),
  metaValue: z.string().optional(),
});

const productSchema = z.object({
  productType: z.enum(["course", "package", "book", "ebook"]),
  productId: z.coerce.bigint(),
  isFeatured: zBool.optional(),
});

const sectionItemSchema = z.object({
  icon: z.string().optional(),
  title: z.string().optional(),
  value: z.string().optional(),
  extra: z.string().optional(),
});

const sectionSchema = z.object({
  title: z.string().optional(),
  blockType: z.enum(JOB_SECTION_BLOCK_TYPES),
  position: z.enum(JOB_SECTION_POSITIONS).optional(),
  icon: z.string().optional(),
  isVisible: zBool.optional(),
  items: z.array(sectionItemSchema).optional(),
});

const jobFieldsSchema = z.object({
  applicationStart: zDate.optional().nullable(),
  applicationEnd: zDate.optional().nullable(),
  location: z.string().optional(),
  qualification: z.string().optional(),
  excerpt: z.string().optional(),
  totalPosts: z.string().optional(),
  applyUrl: z.string().optional(),
  officialNotificationUrl: z.string().optional(),
  selectionProcess: z.array(stepSchema).optional(),
  importantDates: z
    .array(z.object({ label: z.string(), dateValue: zDate.optional().nullable(), note: z.string().optional() }))
    .optional(),
  applicationFees: z.array(z.object({ categoryLabel: z.string(), amountLabel: z.string() })).optional(),
  paymentModes: zStringArray.optional(),
  notes: zStringArray.optional(),
});

const admitCardFieldsSchema = z.object({
  tierLabel: z.string().optional(),
  releasedAt: zDate.optional().nullable(),
  examDateLabel: z.string().optional(),
  releaseStatus: z.enum(["released", "coming_soon"]).optional(),
  downloadUrl: z.string().optional(),
  notifyUrl: z.string().optional(),
  downloadSteps: z.array(stepSchema).optional(),
});

const resultFieldsSchema = z.object({
  declaredAt: zDate.optional().nullable(),
  officialUrl: z.string().optional(),
  downloadUrl: z.string().optional(),
  howToCheckSteps: z.array(stepSchema).optional(),
});

const answerKeyFieldsSchema = z.object({
  keyStatus: z.enum(["final", "provisional"]).optional(),
  releasedAt: zDate.optional().nullable(),
  downloadUrl: z.string().optional(),
  tags: zStringArray.optional(),
  objectionSteps: z.array(stepSchema).optional(),
});

const otherFieldsSchema = z.object({
  summary: z.string().optional(),
  tags: zStringArray.optional(),
  cardMeta: z.record(z.string()).optional(),
});

const examCalendarFieldsSchema = z.object({
  examDate: zDate.optional().nullable(),
  applyStartDate: zDate.optional().nullable(),
  applyEndDate: zDate.optional().nullable(),
  admitCardDate: zDate.optional().nullable(),
  admitCardNote: z.string().optional(),
});

const syllabusFieldsSchema = z.object({
  subtitle: z.string().optional(),
  languages: z.string().optional(),
  sectionsCount: z.coerce.number().int().optional(),
  downloadUrl: z.string().optional(),
  stages: z
    .array(
      z.object({
        stage: z.string(),
        description: z.string().optional(),
        mode: z.string().optional(),
        medium: z.string().optional(),
        totalMarks: z.string().optional(),
        subjects: z
          .array(z.object({ subject: z.string(), topics: zStringArray.optional() }))
          .optional(),
      })
    )
    .optional(),
});

export const contentWriteSchema = z.object({
  type: z.enum(JOB_CONTENT_TYPES),
  title: z.string().min(1).max(255),
  slug: z.string().max(300).optional(),
  subtitle: z.string().max(255).optional(),
  organizationId: z.coerce.bigint().optional(),
  categoryIds: zBigIntArray.optional(),
  status: z.enum(JOB_CONTENT_STATUSES),
  publishedAt: zDate.optional().nullable(),
  featured: zBool.optional(),
  badge: z.string().max(50).optional(),
  sortOrder: z.coerce.number().int().optional(),
  bodyHtml: z.string().optional(),
  featuredImageId: z.coerce.bigint().optional(),
  seo: jobContentSeoSchema.optional(),
  facts: z.array(factSchema).optional(),
  products: z.array(productSchema).optional(),
  sections: z.array(sectionSchema).optional(),
  relatedPostIds: zBigIntArray.optional(),
  jobFields: jobFieldsSchema.optional(),
  admitCardFields: admitCardFieldsSchema.optional(),
  resultFields: resultFieldsSchema.optional(),
  answerKeyFields: answerKeyFieldsSchema.optional(),
  otherFields: otherFieldsSchema.optional(),
  examCalendarFields: examCalendarFieldsSchema.optional(),
  syllabusFields: syllabusFieldsSchema.optional(),
});

// The editor resubmits the full form on every save (delete-then-reinsert
// strategy in the repository), so update uses the same required shape as create.
export const contentUpdateSchema = contentWriteSchema;

// "scheduled" needs a publishedAt to arm the delayed-publish job (jobs.scheduler.ts)
// and this endpoint has no field to carry one — scheduling only happens through the
// full content save (create/update), which already includes publishedAt.
export const contentStatusSchema = z.object({
  status: z.enum(JOB_CONTENT_STATUSES).refine((status) => status !== "scheduled", {
    message: "Use the content editor to schedule a publish date.",
  }),
});

export const contentReorderSchema = z.object({
  orders: z.array(z.object({ id: z.string(), order: z.coerce.number().int() })),
});
