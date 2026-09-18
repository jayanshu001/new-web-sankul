import type { Prisma } from "@prisma/client";
import type { CONTENT_FULL_INCLUDE } from "./content.repository";
import type { JobContentDto, RefDto } from "./content.types";

type ContentRow = Prisma.JobContentGetPayload<{ include: typeof CONTENT_FULL_INCLUDE }>;

const toRef = (row: { id: bigint; name?: string | null; label?: string | null; slug?: string | null } | null | undefined): RefDto | undefined =>
  row ? { _id: String(row.id), name: row.name ?? row.label ?? undefined, slug: row.slug ?? undefined } : undefined;

// Snake_case, un-typed on purpose — see content.repository.ts's comment.
// `card` fields win over `detail` fields when both are present, matching
// Laravel's `Content::field()` precedence (card → detail → base column).
type Raw = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
};
const bool = (v: unknown, fallback: boolean): boolean => {
  if (typeof v === "boolean") return v;
  if (v === "1" || v === 1) return true;
  if (v === "0" || v === 0) return false;
  return fallback;
};
const date = (v: unknown): Date | undefined => {
  if (typeof v !== "string" || !v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export const toContentDto = (row: ContentRow): JobContentDto => {
  const card = (row.card as Raw | null) ?? {};
  const detail = (row.detail as Raw | null) ?? {};
  const merged: Raw = { ...detail, ...card };
  const seo = (detail.seo as Raw | undefined) ?? {};

  return {
    _id: String(row.id),
    type: row.type,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle ?? undefined,
    organization: toRef(row.organization),
    category: toRef(row.category),
    status: row.status,
    publishedAt: row.publishedAt ?? undefined,
    featured: row.featured,
    badge: row.badge ?? undefined,
    sortOrder: row.sortOrder,
    bodyHtml: row.bodyHtml ?? undefined,
    featuredImageUrl: str(merged.featured_image_url),
    featuredImageAlt: str(merged.featured_image_alt),
    seo: detail.seo
      ? {
          seoTitle: str(seo.seo_title),
          metaDescription: str(seo.meta_description),
          metaKeywords: str(seo.meta_keywords),
          canonicalUrl: str(seo.canonical_url),
          ogTitle: str(seo.og_title),
          ogDescription: str(seo.og_description),
          ogImageUrl: str(seo.og_image_url),
          schemaType: str(seo.schema_type),
          robotsIndex: bool(seo.robots_index, true),
          robotsFollow: bool(seo.robots_follow, true),
          focusKeyword: str(seo.focus_keyword),
        }
      : undefined,
    facts: arr(card.card_facts).map((f, i) => ({
      _id: String(i),
      icon: str(f.icon),
      metaKey: str(f.meta_key),
      metaValue: str(f.meta_value),
    })),
    products: arr(detail.products).map((p, i) => ({
      _id: String(i),
      productType: p.product_type as JobContentDto["products"][number]["productType"],
      productId: String(p.product_id),
      isFeatured: bool(p.is_featured, false),
    })),
    sections: arr(detail.sections).map((s, i) => ({
      _id: String(i),
      title: str(s.title),
      blockType: s.block_type as JobContentDto["sections"][number]["blockType"],
      position: (str(s.position) ?? "main") as JobContentDto["sections"][number]["position"],
      icon: str(s.icon),
      isVisible: bool(s.is_visible, true),
      items: arr(s.items).map((item, j) => ({
        _id: String(j),
        icon: str(item.icon),
        title: str(item.title),
        value: str(item.value),
        extra: str(item.extra),
      })),
    })),
    steps: [
      ...arr(detail.selection_process),
      ...arr(detail.download_steps),
      ...arr(detail.how_to_check_steps),
      ...arr(detail.objection_steps),
    ].map((s, i) => ({ _id: String(i), title: str(s.title), description: str(s.description) })),
    dateItems: arr(detail.important_dates).map((d, i) => ({
      _id: String(i),
      label: str(d.label) ?? "",
      dateValue: date(d.date_value),
      note: str(d.note),
    })),
    feeItems: arr(detail.application_fees).map((f, i) => ({
      _id: String(i),
      categoryLabel: str(f.category_label) ?? "",
      amountLabel: str(f.amount_label) ?? "",
    })),
    paymentModes: strArr(detail.payment_modes),
    notes: strArr(detail.notes),
    relatedPosts: arr(detail.related_posts).map((r) => ({ _id: String(r.id), name: str(r.title), slug: str(r.slug) })),
    syllabusStages: arr(detail.stages).map((stage, i) => ({
      _id: String(i),
      stage: str(stage.title) ?? "",
      description: str(stage.description),
      mode: str(stage.mode),
      medium: str(stage.medium),
      totalMarks: str(stage.total_marks),
      subjects: arr(stage.subjects).map((subject, j) => ({
        _id: `${i}-${j}`,
        subject: str(subject.title) ?? "",
        topics: strArr(subject.topics).map((topic, k) => ({ _id: `${i}-${j}-${k}`, topic })),
      })),
    })),
    jobDetail:
      row.type === "job"
        ? {
            applicationStart: date(merged.application_start),
            applicationEnd: date(merged.application_end),
            location: str(merged.location),
            qualification: str(merged.qualification),
            excerpt: str(merged.excerpt),
            totalPosts: str(merged.total_posts),
            applyUrl: str(merged.apply_url),
            officialNotificationUrl: str(merged.official_notification_url),
          }
        : undefined,
    admitCardDetail:
      row.type === "admit_card"
        ? {
            tierLabel: str(merged.tier_label),
            releasedAt: date(merged.released_at),
            examDateLabel: str(merged.exam_date_label),
            releaseStatus: (str(merged.release_status) ?? "coming_soon") as "released" | "coming_soon",
            downloadUrl: str(merged.download_url),
            notifyUrl: str(merged.notify_url),
          }
        : undefined,
    resultDetail:
      row.type === "result"
        ? { declaredAt: date(merged.declared_at), officialUrl: str(merged.official_url), downloadUrl: str(merged.download_url) }
        : undefined,
    answerKeyDetail:
      row.type === "answer_key"
        ? {
            keyStatus: (str(merged.key_status) ?? "provisional") as "final" | "provisional",
            releasedAt: date(merged.released_at),
            downloadUrl: str(merged.download_url),
            tags: strArr(merged.tags),
          }
        : undefined,
    otherDetail:
      row.type === "other"
        ? {
            summary: str(merged.summary),
            tags: strArr(merged.tags),
            cardMeta: Array.isArray(merged.card_meta) ? undefined : (merged.card_meta as Record<string, string> | undefined),
          }
        : undefined,
    examCalendarDetail:
      row.type === "exam_calendar"
        ? {
            examDate: date(merged.exam_date),
            applyStartDate: date(merged.apply_start_date),
            applyEndDate: date(merged.apply_end_date),
            admitCardDate: date(merged.admit_card_date),
            admitCardNote: str(merged.admit_card_note),
          }
        : undefined,
    syllabusDetail:
      row.type === "syllabus"
        ? {
            subtitle: row.subtitle ?? undefined,
            languages: str(merged.languages),
            sectionsCount: num(merged.sections_count),
            downloadUrl: str(merged.download_url),
          }
        : undefined,
    createdAt: row.createdAt ?? undefined,
    updatedAt: row.updatedAt ?? undefined,
  };
};
