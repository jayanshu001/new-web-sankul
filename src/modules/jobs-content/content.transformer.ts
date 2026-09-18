import type { Prisma } from "@prisma/client";
import { CONTENT_FULL_INCLUDE } from "./content.repository";
import type { JobContentDto, RefDto } from "./content.types";

type ContentRow = Prisma.JobContentGetPayload<{ include: typeof CONTENT_FULL_INCLUDE }>;

const toRef = (row: { id: bigint; name?: string | null; slug?: string | null } | null | undefined): RefDto | undefined =>
  row ? { _id: String(row.id), name: row.name ?? undefined, slug: row.slug ?? undefined } : undefined;

export const toContentDto = (row: ContentRow): JobContentDto => ({
  _id: String(row.id),
  type: row.type,
  slug: row.slug,
  title: row.title,
  subtitle: row.subtitle ?? undefined,
  organization: toRef(row.organization),
  categories: row.categories.map((c) => ({ _id: String(c.category.id), name: c.category.label, slug: c.category.slug })),
  status: row.status,
  publishedAt: row.publishedAt ?? undefined,
  featured: row.featured,
  badge: row.badge ?? undefined,
  sortOrder: row.sortOrder,
  bodyHtml: row.bodyHtml ?? undefined,
  featuredImage: row.featuredImage
    ? { _id: String(row.featuredImage.id), url: row.featuredImage.url, altText: row.featuredImage.altText ?? undefined }
    : undefined,
  seo: row.seo
    ? {
        seoTitle: row.seo.seoTitle ?? undefined,
        metaDescription: row.seo.metaDescription ?? undefined,
        metaKeywords: row.seo.metaKeywords ?? undefined,
        canonicalUrl: row.seo.canonicalUrl ?? undefined,
        ogTitle: row.seo.ogTitle ?? undefined,
        ogDescription: row.seo.ogDescription ?? undefined,
        ogImage: row.seo.ogImage
          ? { _id: String(row.seo.ogImage.id), url: row.seo.ogImage.url, altText: row.seo.ogImage.altText ?? undefined }
          : undefined,
        schemaType: row.seo.schemaType ?? undefined,
        robotsIndex: row.seo.robotsIndex,
        robotsFollow: row.seo.robotsFollow,
        focusKeyword: row.seo.focusKeyword ?? undefined,
      }
    : undefined,
  facts: (row.facts ?? []).map((f) => ({
    _id: String(f.id),
    icon: f.icon ?? undefined,
    metaKey: f.metaKey ?? undefined,
    metaValue: f.metaValue ?? undefined,
  })),
  products: (row.products ?? []).map((p) => ({
    _id: String(p.id),
    productType: p.productType,
    productId: String(p.productId),
    isFeatured: p.isFeatured,
  })),
  sections: (row.sections ?? []).map((s) => ({
    _id: String(s.id),
    title: s.title ?? undefined,
    blockType: s.blockType,
    position: s.position,
    icon: s.icon ?? undefined,
    isVisible: s.isVisible,
    items: s.items.map((i) => ({
      _id: String(i.id),
      icon: i.icon ?? undefined,
      title: i.title ?? undefined,
      value: i.value ?? undefined,
      extra: i.extra ?? undefined,
    })),
  })),
  steps: (row.steps ?? []).map((s) => ({ _id: String(s.id), title: s.title ?? undefined, description: s.description ?? undefined })),
  dateItems: (row.dateItems ?? []).map((d) => ({
    _id: String(d.id),
    label: d.label,
    dateValue: d.dateValue ?? undefined,
    note: d.note ?? undefined,
  })),
  feeItems: (row.feeItems ?? []).map((f) => ({ _id: String(f.id), categoryLabel: f.categoryLabel, amountLabel: f.amountLabel })),
  paymentModes: (row.paymentModes ?? []).map((p) => p.label),
  notes: (row.notes ?? []).map((n) => n.text),
  relatedPosts: (row.relatedPostsFrom ?? []).map((r) => ({ _id: String(r.relatedContent.id), name: r.relatedContent.title, slug: r.relatedContent.slug })),
  syllabusStages: (row.syllabusStages ?? []).map((stage) => ({
    _id: String(stage.id),
    stage: stage.stage,
    description: stage.description ?? undefined,
    mode: stage.mode ?? undefined,
    medium: stage.medium ?? undefined,
    totalMarks: stage.totalMarks ?? undefined,
    subjects: stage.subjects.map((subject) => ({
      _id: String(subject.id),
      subject: subject.subject,
      topics: subject.topics.map((t) => ({ _id: String(t.id), topic: t.topic })),
    })),
  })),
  jobDetail: row.jobDetail
    ? {
        applicationStart: row.jobDetail.applicationStart ?? undefined,
        applicationEnd: row.jobDetail.applicationEnd ?? undefined,
        location: row.jobDetail.location ?? undefined,
        qualification: row.jobDetail.qualification ?? undefined,
        excerpt: row.jobDetail.excerpt ?? undefined,
        totalPosts: row.jobDetail.totalPosts ?? undefined,
        applyUrl: row.jobDetail.applyUrl ?? undefined,
        officialNotificationUrl: row.jobDetail.officialNotificationUrl ?? undefined,
      }
    : undefined,
  admitCardDetail: row.admitCardDetail
    ? {
        tierLabel: row.admitCardDetail.tierLabel ?? undefined,
        releasedAt: row.admitCardDetail.releasedAt ?? undefined,
        examDateLabel: row.admitCardDetail.examDateLabel ?? undefined,
        releaseStatus: row.admitCardDetail.releaseStatus,
        downloadUrl: row.admitCardDetail.downloadUrl ?? undefined,
        notifyUrl: row.admitCardDetail.notifyUrl ?? undefined,
      }
    : undefined,
  resultDetail: row.resultDetail
    ? {
        declaredAt: row.resultDetail.declaredAt ?? undefined,
        officialUrl: row.resultDetail.officialUrl ?? undefined,
        downloadUrl: row.resultDetail.downloadUrl ?? undefined,
      }
    : undefined,
  answerKeyDetail: row.answerKeyDetail
    ? {
        keyStatus: row.answerKeyDetail.keyStatus,
        releasedAt: row.answerKeyDetail.releasedAt ?? undefined,
        downloadUrl: row.answerKeyDetail.downloadUrl ?? undefined,
        tags: Array.isArray(row.answerKeyDetail.tags) ? (row.answerKeyDetail.tags as string[]) : [],
      }
    : undefined,
  otherDetail: row.otherDetail
    ? {
        summary: row.otherDetail.summary ?? undefined,
        tags: Array.isArray(row.otherDetail.tags) ? (row.otherDetail.tags as string[]) : [],
        cardMeta: (row.otherDetail.cardMeta as Record<string, string> | null) ?? undefined,
      }
    : undefined,
  examCalendarDetail: row.examCalendarDetail
    ? {
        examDate: row.examCalendarDetail.examDate ?? undefined,
        applyStartDate: row.examCalendarDetail.applyStartDate ?? undefined,
        applyEndDate: row.examCalendarDetail.applyEndDate ?? undefined,
        admitCardDate: row.examCalendarDetail.admitCardDate ?? undefined,
        admitCardNote: row.examCalendarDetail.admitCardNote ?? undefined,
      }
    : undefined,
  syllabusDetail: row.syllabusDetail
    ? {
        subtitle: row.syllabusDetail.subtitle ?? undefined,
        languages: row.syllabusDetail.languages ?? undefined,
        sectionsCount: row.syllabusDetail.sectionsCount ?? undefined,
        downloadUrl: row.syllabusDetail.downloadUrl ?? undefined,
      }
    : undefined,
  createdAt: row.createdAt ?? undefined,
  updatedAt: row.updatedAt ?? undefined,
});
