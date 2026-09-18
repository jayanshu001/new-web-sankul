export const JOB_CONTENT_TYPES = [
  "job",
  "result",
  "admit_card",
  "answer_key",
  "syllabus",
  "other",
  "exam_calendar",
] as const;
export type JobContentType = (typeof JOB_CONTENT_TYPES)[number];

export const JOB_CONTENT_STATUSES = [
  "draft",
  "published",
  "expired",
  "scheduled",
  "archived",
] as const;
export type JobContentStatus = (typeof JOB_CONTENT_STATUSES)[number];

export const JOB_SECTION_BLOCK_TYPES = [
  "important_dates",
  "table",
  "list",
  "steps",
  "faq",
  "rich_text",
  "custom",
  "related_posts",
  "related_products",
] as const;
export type JobSectionBlockType = (typeof JOB_SECTION_BLOCK_TYPES)[number];

export const JOB_SECTION_POSITIONS = ["main", "sidebar"] as const;
export type JobSectionPosition = (typeof JOB_SECTION_POSITIONS)[number];

export const JOB_STEP_GROUPS = [
  "selection_process",
  "download_steps",
  "how_to_check_steps",
  "objection_steps",
] as const;
export type JobStepGroup = (typeof JOB_STEP_GROUPS)[number];

export const JOB_PRODUCT_TYPES = ["course", "package", "book", "ebook"] as const;
export type JobProductType = (typeof JOB_PRODUCT_TYPES)[number];

// ─── DTO ────────────────────────────────────────────────────────────────────

export interface RefDto {
  _id: string;
  name?: string;
  slug?: string;
}

export interface SeoDto {
  seoTitle?: string;
  metaDescription?: string;
  metaKeywords?: string;
  canonicalUrl?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: { _id: string; url: string; altText?: string };
  schemaType?: string;
  robotsIndex: boolean;
  robotsFollow: boolean;
  focusKeyword?: string;
}

export interface FactDto {
  _id: string;
  icon?: string;
  metaKey?: string;
  metaValue?: string;
}

export interface ProductDto {
  _id: string;
  productType: JobProductType;
  productId: string;
  isFeatured: boolean;
}

export interface SectionItemDto {
  _id: string;
  icon?: string;
  title?: string;
  value?: string;
  extra?: string;
}

export interface SectionDto {
  _id: string;
  title?: string;
  blockType: JobSectionBlockType;
  position: JobSectionPosition;
  icon?: string;
  isVisible: boolean;
  items: SectionItemDto[];
}

export interface StepDto {
  _id: string;
  title?: string;
  description?: string;
}

export interface DateItemDto {
  _id: string;
  label: string;
  dateValue?: Date;
  note?: string;
}

export interface FeeItemDto {
  _id: string;
  categoryLabel: string;
  amountLabel: string;
}

export interface SyllabusTopicDto {
  _id: string;
  topic: string;
}

export interface SyllabusSubjectDto {
  _id: string;
  subject: string;
  topics: SyllabusTopicDto[];
}

export interface SyllabusStageDto {
  _id: string;
  stage: string;
  description?: string;
  mode?: string;
  medium?: string;
  totalMarks?: string;
  subjects: SyllabusSubjectDto[];
}

export interface JobContentDto {
  _id: string;
  type: JobContentType;
  slug: string;
  title: string;
  subtitle?: string;
  organization?: RefDto;
  categories: RefDto[];
  status: JobContentStatus;
  publishedAt?: Date;
  featured: boolean;
  badge?: string;
  sortOrder: number;
  bodyHtml?: string;
  featuredImage?: { _id: string; url: string; altText?: string };
  seo?: SeoDto;
  facts: FactDto[];
  products: ProductDto[];
  sections: SectionDto[];
  steps: StepDto[];
  dateItems: DateItemDto[];
  feeItems: FeeItemDto[];
  paymentModes: string[];
  notes: string[];
  relatedPosts: RefDto[];
  syllabusStages: SyllabusStageDto[];
  jobDetail?: {
    applicationStart?: Date;
    applicationEnd?: Date;
    location?: string;
    qualification?: string;
    excerpt?: string;
    totalPosts?: string;
    applyUrl?: string;
    officialNotificationUrl?: string;
  };
  admitCardDetail?: {
    tierLabel?: string;
    releasedAt?: Date;
    examDateLabel?: string;
    releaseStatus: "released" | "coming_soon";
    downloadUrl?: string;
    notifyUrl?: string;
  };
  resultDetail?: { declaredAt?: Date; officialUrl?: string; downloadUrl?: string };
  answerKeyDetail?: {
    keyStatus: "final" | "provisional";
    releasedAt?: Date;
    downloadUrl?: string;
    tags: string[];
  };
  otherDetail?: { summary?: string; tags: string[]; cardMeta?: Record<string, string> };
  examCalendarDetail?: {
    examDate?: Date;
    applyStartDate?: Date;
    applyEndDate?: Date;
    admitCardDate?: Date;
    admitCardNote?: string;
  };
  syllabusDetail?: {
    subtitle?: string;
    languages?: string;
    sectionsCount?: number;
    downloadUrl?: string;
  };
  createdAt?: Date;
  updatedAt?: Date;
}

// ─── Write input (flat, from the admin editor) ─────────────────────────────

export interface ContentWriteInput {
  type: JobContentType;
  title: string;
  slug?: string;
  subtitle?: string;
  organizationId?: bigint | null;
  categoryIds?: bigint[];
  status: JobContentStatus;
  publishedAt?: Date | null;
  featured?: boolean;
  badge?: string;
  sortOrder?: number;
  bodyHtml?: string;
  featuredImageId?: bigint | null;
  seo?: {
    seoTitle?: string;
    metaDescription?: string;
    metaKeywords?: string;
    canonicalUrl?: string;
    ogTitle?: string;
    ogDescription?: string;
    ogImageId?: bigint;
    schemaType?: string;
    robotsIndex?: boolean;
    robotsFollow?: boolean;
    focusKeyword?: string;
  };
  facts?: { icon?: string; metaKey?: string; metaValue?: string }[];
  products?: { productType: JobProductType; productId: bigint; isFeatured?: boolean }[];
  sections?: {
    title?: string;
    blockType: JobSectionBlockType;
    position?: JobSectionPosition;
    icon?: string;
    isVisible?: boolean;
    items?: { icon?: string; title?: string; value?: string; extra?: string }[];
  }[];
  relatedPostIds?: bigint[];
  jobFields?: {
    applicationStart?: Date | null;
    applicationEnd?: Date | null;
    location?: string;
    qualification?: string;
    excerpt?: string;
    totalPosts?: string;
    applyUrl?: string;
    officialNotificationUrl?: string;
    selectionProcess?: { title?: string; description?: string }[];
    importantDates?: { label: string; dateValue?: Date | null; note?: string }[];
    applicationFees?: { categoryLabel: string; amountLabel: string }[];
    paymentModes?: string[];
    notes?: string[];
  };
  admitCardFields?: {
    tierLabel?: string;
    releasedAt?: Date | null;
    examDateLabel?: string;
    releaseStatus?: "released" | "coming_soon";
    downloadUrl?: string;
    notifyUrl?: string;
    downloadSteps?: { title?: string; description?: string }[];
  };
  resultFields?: {
    declaredAt?: Date | null;
    officialUrl?: string;
    downloadUrl?: string;
    howToCheckSteps?: { title?: string; description?: string }[];
  };
  answerKeyFields?: {
    keyStatus?: "final" | "provisional";
    releasedAt?: Date | null;
    downloadUrl?: string;
    tags?: string[];
    objectionSteps?: { title?: string; description?: string }[];
  };
  otherFields?: { summary?: string; tags?: string[]; cardMeta?: Record<string, string> };
  examCalendarFields?: {
    examDate?: Date | null;
    applyStartDate?: Date | null;
    applyEndDate?: Date | null;
    admitCardDate?: Date | null;
    admitCardNote?: string;
  };
  syllabusFields?: {
    subtitle?: string;
    languages?: string;
    sectionsCount?: number;
    downloadUrl?: string;
    stages?: {
      stage: string;
      description?: string;
      mode?: string;
      medium?: string;
      totalMarks?: string;
      subjects?: { subject: string; topics?: string[] }[];
    }[];
  };
}

export interface ContentListQuery {
  type?: JobContentType;
  status?: JobContentStatus;
  organizationId?: bigint;
  categoryId?: bigint;
  search?: string;
  skip: number;
  take: number;
}
