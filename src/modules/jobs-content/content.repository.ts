import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";
import type { ContentListQuery, ContentWriteInput, JobContentType } from "./content.types";

// `wsj_content_seo`/`_facts`/`_products`/`_sections`(+items)/`_steps`/
// `_date_items`/`_fee_items`/`_payment_modes`/`_notes`/`_related_posts` and
// every `wsj_*_details`/`wsj_syllabus_*` table were dropped from prod. Their
// data was migrated (before this repository was rewritten) into the
// `wsj_contents.card`/`.detail` JSON columns, using the SAME snake_case
// shape the legacy Laravel admin (`App\Models\GovtJob\Content`) always used
// — `card` = short/list-view fields, `detail` = long-form/detail-page
// fields, and Laravel's own `Content::field()` reads card first, then
// detail (see websankul-mobile-app-admin-panel). This repository preserves
// that exact split and key naming on write, and content.transformer.ts
// merges card+detail (card wins) the same way on read. DO NOT switch this
// to camelCase or restructure it — it must stay byte-compatible with the
// already-migrated production rows.
export const CONTENT_LIST_INCLUDE = {
  organization: true,
  category: true,
} as const;

export const CONTENT_FULL_INCLUDE = CONTENT_LIST_INCLUDE;

const buildWhere = (q: Partial<ContentListQuery>) => {
  const where: Record<string, unknown> = {};
  if (q.type) where.type = q.type;
  if (q.status) where.status = q.status;
  if (q.organizationId) where.organizationId = q.organizationId;
  if (q.categoryId) where.categoryId = q.categoryId;
  const search = buildPrismaSearch(q.search, ["title", "subtitle"]);
  if (search) where.AND = search.AND;
  return where;
};

const toDateStr = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

const buildCardAndDetail = async (
  input: ContentWriteInput
): Promise<{ card: Record<string, unknown>; detail: Record<string, unknown> }> => {
  const relatedPostIds = input.relatedPostIds ?? [];
  const relatedPosts =
    relatedPostIds.length > 0
      ? await prisma.jobContent.findMany({
          where: { id: { in: relatedPostIds } },
          select: { id: true, title: true, slug: true },
        })
      : [];

  const card: Record<string, unknown> = {};
  const detail: Record<string, unknown> = {
    seo: input.seo
      ? {
          seo_title: input.seo.seoTitle ?? null,
          meta_description: input.seo.metaDescription ?? null,
          meta_keywords: input.seo.metaKeywords ?? null,
          canonical_url: input.seo.canonicalUrl ?? null,
          og_title: input.seo.ogTitle ?? null,
          og_description: input.seo.ogDescription ?? null,
          og_image_url: input.seo.ogImageUrl ?? null,
          schema_type: input.seo.schemaType ?? null,
          robots_index: input.seo.robotsIndex ?? true,
          robots_follow: input.seo.robotsFollow ?? true,
          focus_keyword: input.seo.focusKeyword ?? null,
        }
      : undefined,
    products: (input.products ?? []).map((p) => ({
      product_id: String(p.productId),
      product_type: p.productType,
      ...(p.isFeatured ? { is_featured: "1" } : {}),
    })),
    sections: (input.sections ?? []).map((s) => ({
      title: s.title ?? null,
      block_type: s.blockType,
      position: s.position ?? "main",
      icon: s.icon ?? null,
      is_visible: s.isVisible ?? true,
      items: (s.items ?? []).map((i) => ({ icon: i.icon ?? null, title: i.title ?? null, value: i.value ?? null, extra: i.extra ?? null })),
    })),
    related_posts: relatedPosts.map((r) => ({ id: String(r.id), title: r.title, slug: r.slug })),
  };

  card.featured_image_url = input.featuredImageUrl ?? null;
  card.featured_image_alt = input.featuredImageAlt ?? null;

  if (input.type === "job" && input.jobFields) {
    const f = input.jobFields;
    Object.assign(card, {
      location: f.location ?? null,
      qualification: f.qualification ?? null,
      excerpt: f.excerpt ?? null,
      total_posts: f.totalPosts ?? null,
      apply_url: f.applyUrl ?? null,
      official_notification_url: f.officialNotificationUrl ?? null,
      application_start: toDateStr(f.applicationStart),
      application_end: toDateStr(f.applicationEnd),
      card_facts: (input.facts ?? []).map((fact) => ({
        icon: fact.icon ?? "",
        meta_key: fact.metaKey ?? null,
        meta_value: fact.metaValue ?? null,
      })),
    });
    detail.selection_process = (f.selectionProcess ?? []).map((s) => ({ title: s.title ?? null, description: s.description ?? null }));
    detail.important_dates = (f.importantDates ?? []).map((d) => ({ label: d.label, date_value: toDateStr(d.dateValue), note: d.note ?? null }));
    detail.application_fees = (f.applicationFees ?? []).map((fee) => ({ category_label: fee.categoryLabel, amount_label: fee.amountLabel }));
    detail.payment_modes = f.paymentModes ?? [];
    detail.notes = f.notes ?? [];
  }

  if (input.type === "admit_card" && input.admitCardFields) {
    const f = input.admitCardFields;
    Object.assign(card, {
      tier_label: f.tierLabel ?? null,
      released_at: toDateStr(f.releasedAt),
      exam_date_label: f.examDateLabel ?? null,
      release_status: f.releaseStatus ?? "coming_soon",
      download_url: f.downloadUrl ?? null,
      notify_url: f.notifyUrl ?? null,
    });
    detail.download_steps = (f.downloadSteps ?? []).map((s) => ({ title: s.title ?? null, description: s.description ?? null }));
  }

  if (input.type === "result" && input.resultFields) {
    const f = input.resultFields;
    Object.assign(card, {
      declared_at: toDateStr(f.declaredAt),
      official_url: f.officialUrl ?? null,
      download_url: f.downloadUrl ?? null,
    });
    detail.how_to_check_steps = (f.howToCheckSteps ?? []).map((s) => ({ title: s.title ?? null, description: s.description ?? null }));
  }

  if (input.type === "answer_key" && input.answerKeyFields) {
    const f = input.answerKeyFields;
    Object.assign(card, {
      key_status: f.keyStatus ?? "provisional",
      released_at: toDateStr(f.releasedAt),
      download_url: f.downloadUrl ?? null,
      tags: f.tags ?? [],
    });
    detail.objection_steps = (f.objectionSteps ?? []).map((s) => ({ title: s.title ?? null, description: s.description ?? null }));
  }

  if (input.type === "other" && input.otherFields) {
    const f = input.otherFields;
    Object.assign(card, {
      tags: f.tags ?? [],
      summary: f.summary ?? null,
      card_meta: f.cardMeta ?? {},
    });
  }

  if (input.type === "exam_calendar" && input.examCalendarFields) {
    const f = input.examCalendarFields;
    Object.assign(card, {
      exam_date: toDateStr(f.examDate),
      apply_start_date: toDateStr(f.applyStartDate),
      apply_end_date: toDateStr(f.applyEndDate),
      admit_card_date: toDateStr(f.admitCardDate),
      admit_card_note: f.admitCardNote ?? null,
    });
  }

  if (input.type === "syllabus" && input.syllabusFields) {
    const f = input.syllabusFields;
    Object.assign(card, {
      languages: f.languages ?? null,
      download_url: f.downloadUrl ?? null,
      sections_count: f.sectionsCount ?? null,
    });
    detail.stages = (f.stages ?? []).map((stage, i) => ({
      title: stage.stage,
      stage_key: stage.stage,
      description: stage.description ?? null,
      mode: stage.mode ?? null,
      medium: stage.medium ?? null,
      total_marks: stage.totalMarks ?? null,
      sort_order: i,
      subjects: (stage.subjects ?? []).map((subject, j) => ({
        title: subject.subject,
        topics: subject.topics ?? [],
        sort_order: j,
      })),
    }));
  }

  return { card, detail };
};

export const contentRepository = {
  findPage: (q: ContentListQuery) =>
    prisma.jobContent.findMany({
      where: buildWhere(q),
      include: CONTENT_LIST_INCLUDE,
      orderBy: [{ sortOrder: "asc" }, { id: "desc" }],
      skip: q.skip,
      take: q.take,
    }),

  count: (q: Partial<ContentListQuery>) => prisma.jobContent.count({ where: buildWhere(q) }),

  findById: (id: bigint) => prisma.jobContent.findUnique({ where: { id }, include: CONTENT_FULL_INCLUDE }),

  findBySlug: (type: JobContentType, slug: string) =>
    prisma.jobContent.findUnique({ where: { type_slug: { type, slug } } }),

  create: async (input: ContentWriteInput & { slug: string }) => {
    const { card, detail } = await buildCardAndDetail(input);
    return prisma.jobContent.create({
      data: {
        type: input.type,
        slug: input.slug,
        title: input.title,
        subtitle: input.subtitle,
        organizationId: input.organizationId ?? undefined,
        categoryId: input.categoryId ?? undefined,
        status: input.status,
        publishedAt: input.publishedAt ?? undefined,
        featured: input.featured ?? false,
        badge: input.badge,
        sortOrder: input.sortOrder ?? 0,
        bodyHtml: input.bodyHtml,
        card: card as never,
        detail: detail as never,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      include: CONTENT_FULL_INCLUDE,
    });
  },

  update: async (id: bigint, input: ContentWriteInput & { slug: string }) => {
    const { card, detail } = await buildCardAndDetail(input);
    return prisma.jobContent.update({
      where: { id },
      data: {
        type: input.type,
        slug: input.slug,
        title: input.title,
        subtitle: input.subtitle,
        organizationId: input.organizationId ?? null,
        categoryId: input.categoryId ?? null,
        status: input.status,
        publishedAt: input.publishedAt ?? null,
        featured: input.featured ?? false,
        badge: input.badge,
        sortOrder: input.sortOrder ?? 0,
        bodyHtml: input.bodyHtml,
        card: card as never,
        detail: detail as never,
        updatedAt: new Date(),
      },
      include: CONTENT_FULL_INCLUDE,
    });
  },

  updateStatus: (id: bigint, status: string, publishedAt?: Date | null) =>
    prisma.jobContent.update({
      where: { id },
      data: { status: status as never, publishedAt: publishedAt ?? undefined, updatedAt: new Date() },
      include: CONTENT_FULL_INCLUDE,
    }),

  delete: (id: bigint) => prisma.jobContent.delete({ where: { id } }),

  reorder: (orders: { id: bigint; order: number }[]) =>
    prisma.$transaction(
      orders.map(({ id, order }) => prisma.jobContent.update({ where: { id }, data: { sortOrder: order } }))
    ),

  // `jobDetail` relation is gone — `application_end` now lives inside the
  // `card` JSON (see comment above). Raw JSON_EXTRACT, same pattern as the
  // purchase-history VARCHAR/INT fix (see MIGRATION_QUERY_CHANGES.md).
  findStaleJobIds: async (asOf: Date): Promise<bigint[]> => {
    const rows = await prisma.$queryRawUnsafe<{ id: bigint }[]>(
      `SELECT id FROM wsj_contents
       WHERE type = 'job' AND status = 'published'
         AND JSON_UNQUOTE(JSON_EXTRACT(card, '$.application_end')) < ?`,
      asOf.toISOString().slice(0, 10)
    );
    return rows.map((row) => BigInt(row.id));
  },

  bulkSetStatus: (ids: bigint[], status: string) =>
    prisma.jobContent.updateMany({ where: { id: { in: ids } }, data: { status: status as never, updatedAt: new Date() } }),
};
