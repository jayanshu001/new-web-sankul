import { prisma } from "../../config/prisma";
import { buildPrismaSearch } from "../../utils/searchFilter";
import type { ContentListQuery, ContentWriteInput, JobContentType } from "./content.types";

export const CONTENT_LIST_INCLUDE = {
  organization: true,
  categories: { include: { category: true } },
  featuredImage: true,
} as const;

export const CONTENT_FULL_INCLUDE = {
  ...CONTENT_LIST_INCLUDE,
  seo: { include: { ogImage: true } },
  facts: { orderBy: { sortOrder: "asc" as const } },
  products: { orderBy: { sortOrder: "asc" as const } },
  sections: {
    orderBy: { sortOrder: "asc" as const },
    include: { items: { orderBy: { sortOrder: "asc" as const } } },
  },
  steps: { orderBy: { sortOrder: "asc" as const } },
  dateItems: { orderBy: { sortOrder: "asc" as const } },
  feeItems: { orderBy: { sortOrder: "asc" as const } },
  paymentModes: { orderBy: { sortOrder: "asc" as const } },
  notes: { orderBy: { sortOrder: "asc" as const } },
  relatedPostsFrom: { include: { relatedContent: true }, orderBy: { sortOrder: "asc" as const } },
  jobDetail: true,
  admitCardDetail: true,
  resultDetail: true,
  answerKeyDetail: true,
  otherDetail: true,
  examCalendarDetail: true,
  syllabusDetail: true,
  syllabusStages: {
    orderBy: { sortOrder: "asc" as const },
    include: {
      subjects: {
        orderBy: { sortOrder: "asc" as const },
        include: { topics: { orderBy: { sortOrder: "asc" as const } } },
      },
    },
  },
} as const;

const buildWhere = (q: Partial<ContentListQuery>) => {
  const where: Record<string, unknown> = {};
  if (q.type) where.type = q.type;
  if (q.status) where.status = q.status;
  if (q.organizationId) where.organizationId = q.organizationId;
  if (q.categoryId) where.categories = { some: { categoryId: q.categoryId } };
  const search = buildPrismaSearch(q.search, ["title", "subtitle"]);
  if (search) where.AND = search.AND;
  return where;
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

  // Repeaters (facts/sections/steps/syllabus stages→subjects→topics, ...) are
  // written as sequential per-row creates below, so a content-heavy save (e.g.
  // a large syllabus) can run well past Prisma's 5s default interactive-
  // transaction timeout. 20s gives realistic repeater sizes headroom without
  // masking a genuinely stuck query.
  create: (input: ContentWriteInput & { slug: string }) =>
    prisma.$transaction(
      async (tx) => {
        const base = await tx.jobContent.create({
          data: {
            type: input.type,
            slug: input.slug,
            title: input.title,
            subtitle: input.subtitle,
            organizationId: input.organizationId ?? undefined,
            status: input.status,
            publishedAt: input.publishedAt ?? undefined,
            featured: input.featured ?? false,
            badge: input.badge,
            sortOrder: input.sortOrder ?? 0,
            bodyHtml: input.bodyHtml,
            featuredImageId: input.featuredImageId ?? undefined,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
        await writeChildren(tx, base.id, input);
        return tx.jobContent.findUniqueOrThrow({ where: { id: base.id }, include: CONTENT_FULL_INCLUDE });
      },
      { timeout: 20_000 }
    ),

  update: (id: bigint, input: ContentWriteInput & { slug: string }) =>
    prisma.$transaction(
      async (tx) => {
        await tx.jobContent.update({
          where: { id },
          data: {
            type: input.type,
            slug: input.slug,
            title: input.title,
            subtitle: input.subtitle,
            organizationId: input.organizationId ?? null,
            status: input.status,
            publishedAt: input.publishedAt ?? null,
            featured: input.featured ?? false,
            badge: input.badge,
            sortOrder: input.sortOrder ?? 0,
            bodyHtml: input.bodyHtml,
            featuredImageId: input.featuredImageId ?? null,
            updatedAt: new Date(),
          },
        });
        await clearChildren(tx, id);
        await writeChildren(tx, id, input);
        return tx.jobContent.findUniqueOrThrow({ where: { id }, include: CONTENT_FULL_INCLUDE });
      },
      { timeout: 20_000 }
    ),

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

  findStaleJobIds: async (asOf: Date): Promise<bigint[]> => {
    const rows = await prisma.jobContent.findMany({
      where: { type: "job", status: "published", jobDetail: { applicationEnd: { lt: asOf } } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  },

  bulkSetStatus: (ids: bigint[], status: string) =>
    prisma.jobContent.updateMany({ where: { id: { in: ids } }, data: { status: status as never, updatedAt: new Date() } }),
};

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

const clearChildren = async (tx: Tx, contentId: bigint) => {
  await tx.jobContentCategory.deleteMany({ where: { contentId } });
  await tx.jobContentSeo.deleteMany({ where: { contentId } });
  await tx.jobContentFact.deleteMany({ where: { contentId } });
  await tx.jobContentProduct.deleteMany({ where: { contentId } });
  await tx.jobContentSectionItem.deleteMany({ where: { section: { contentId } } });
  await tx.jobContentSection.deleteMany({ where: { contentId } });
  await tx.jobContentStep.deleteMany({ where: { contentId } });
  await tx.jobContentDateItem.deleteMany({ where: { contentId } });
  await tx.jobContentFeeItem.deleteMany({ where: { contentId } });
  await tx.jobContentPaymentMode.deleteMany({ where: { contentId } });
  await tx.jobContentNote.deleteMany({ where: { contentId } });
  await tx.jobContentRelatedPost.deleteMany({ where: { contentId } });
  await tx.jobDetailJob.deleteMany({ where: { contentId } });
  await tx.jobDetailAdmitCard.deleteMany({ where: { contentId } });
  await tx.jobDetailResult.deleteMany({ where: { contentId } });
  await tx.jobDetailAnswerKey.deleteMany({ where: { contentId } });
  await tx.jobDetailOther.deleteMany({ where: { contentId } });
  await tx.jobDetailExamCalendar.deleteMany({ where: { contentId } });
  await tx.jobDetailSyllabus.deleteMany({ where: { contentId } });
  await tx.jobSyllabusTopic.deleteMany({ where: { subject: { stage: { contentId } } } });
  await tx.jobSyllabusSubject.deleteMany({ where: { stage: { contentId } } });
  await tx.jobSyllabusStage.deleteMany({ where: { contentId } });
};

const writeChildren = async (tx: Tx, contentId: bigint, input: ContentWriteInput) => {
  const categoryIds = input.categoryIds ?? [];
  if (categoryIds.length > 0) {
    await tx.jobContentCategory.createMany({
      data: categoryIds.map((categoryId) => ({ contentId, categoryId, sortOrder: 0 })),
    });
  }

  if (input.seo) {
    await tx.jobContentSeo.create({
      data: {
        contentId,
        seoTitle: input.seo.seoTitle,
        metaDescription: input.seo.metaDescription,
        metaKeywords: input.seo.metaKeywords,
        canonicalUrl: input.seo.canonicalUrl,
        ogTitle: input.seo.ogTitle,
        ogDescription: input.seo.ogDescription,
        ogImageId: input.seo.ogImageId,
        schemaType: input.seo.schemaType,
        robotsIndex: input.seo.robotsIndex ?? true,
        robotsFollow: input.seo.robotsFollow ?? true,
        focusKeyword: input.seo.focusKeyword,
      },
    });
  }

  const facts = input.facts ?? [];
  if (facts.length > 0) {
    await tx.jobContentFact.createMany({ data: facts.map((fact, i) => ({ contentId, sortOrder: i, ...fact })) });
  }

  const products = input.products ?? [];
  if (products.length > 0) {
    await tx.jobContentProduct.createMany({
      data: products.map((product, i) => ({
        contentId,
        sortOrder: i,
        productType: product.productType,
        productId: product.productId,
        isFeatured: product.isFeatured ?? false,
      })),
    });
  }

  for (const [i, section] of (input.sections ?? []).entries()) {
    const created = await tx.jobContentSection.create({
      data: {
        contentId,
        sortOrder: i,
        title: section.title,
        blockType: section.blockType,
        position: section.position ?? "main",
        icon: section.icon,
        isVisible: section.isVisible ?? true,
      },
    });
    const items = section.items ?? [];
    if (items.length > 0) {
      await tx.jobContentSectionItem.createMany({
        data: items.map((item, j) => ({ sectionId: created.id, sortOrder: j, ...item })),
      });
    }
  }

  const relatedContentIds = (input.relatedPostIds ?? []).filter((id) => id !== contentId);
  if (relatedContentIds.length > 0) {
    await tx.jobContentRelatedPost.createMany({
      data: relatedContentIds.map((relatedContentId, i) => ({ contentId, relatedContentId, sortOrder: i })),
    });
  }

  if (input.type === "job" && input.jobFields) {
    const f = input.jobFields;
    await tx.jobDetailJob.create({
      data: {
        contentId,
        applicationStart: f.applicationStart ?? undefined,
        applicationEnd: f.applicationEnd ?? undefined,
        location: f.location,
        qualification: f.qualification,
        excerpt: f.excerpt,
        totalPosts: f.totalPosts,
        applyUrl: f.applyUrl,
        officialNotificationUrl: f.officialNotificationUrl,
      },
    });
    const selectionProcess = f.selectionProcess ?? [];
    if (selectionProcess.length > 0) {
      await tx.jobContentStep.createMany({
        data: selectionProcess.map((step, i) => ({ contentId, sortOrder: i, stepGroup: "selection_process" as const, ...step })),
      });
    }
    const importantDates = f.importantDates ?? [];
    if (importantDates.length > 0) {
      await tx.jobContentDateItem.createMany({
        data: importantDates.map((item, i) => ({ contentId, sortOrder: i, label: item.label, dateValue: item.dateValue ?? undefined, note: item.note })),
      });
    }
    const applicationFees = f.applicationFees ?? [];
    if (applicationFees.length > 0) {
      await tx.jobContentFeeItem.createMany({ data: applicationFees.map((fee, i) => ({ contentId, sortOrder: i, ...fee })) });
    }
    const paymentModes = f.paymentModes ?? [];
    if (paymentModes.length > 0) {
      await tx.jobContentPaymentMode.createMany({ data: paymentModes.map((label, i) => ({ contentId, sortOrder: i, label })) });
    }
    const notes = f.notes ?? [];
    if (notes.length > 0) {
      await tx.jobContentNote.createMany({ data: notes.map((text, i) => ({ contentId, sortOrder: i, text })) });
    }
  }

  if (input.type === "admit_card" && input.admitCardFields) {
    const f = input.admitCardFields;
    await tx.jobDetailAdmitCard.create({
      data: {
        contentId,
        tierLabel: f.tierLabel,
        releasedAt: f.releasedAt ?? undefined,
        examDateLabel: f.examDateLabel,
        releaseStatus: f.releaseStatus ?? "coming_soon",
        downloadUrl: f.downloadUrl,
        notifyUrl: f.notifyUrl,
      },
    });
    const downloadSteps = f.downloadSteps ?? [];
    if (downloadSteps.length > 0) {
      await tx.jobContentStep.createMany({
        data: downloadSteps.map((step, i) => ({ contentId, sortOrder: i, stepGroup: "download_steps" as const, ...step })),
      });
    }
  }

  if (input.type === "result" && input.resultFields) {
    const f = input.resultFields;
    await tx.jobDetailResult.create({
      data: { contentId, declaredAt: f.declaredAt ?? undefined, officialUrl: f.officialUrl, downloadUrl: f.downloadUrl },
    });
    const howToCheckSteps = f.howToCheckSteps ?? [];
    if (howToCheckSteps.length > 0) {
      await tx.jobContentStep.createMany({
        data: howToCheckSteps.map((step, i) => ({ contentId, sortOrder: i, stepGroup: "how_to_check_steps" as const, ...step })),
      });
    }
  }

  if (input.type === "answer_key" && input.answerKeyFields) {
    const f = input.answerKeyFields;
    await tx.jobDetailAnswerKey.create({
      data: {
        contentId,
        keyStatus: f.keyStatus ?? "provisional",
        releasedAt: f.releasedAt ?? undefined,
        downloadUrl: f.downloadUrl,
        tags: f.tags ?? undefined,
      },
    });
    const objectionSteps = f.objectionSteps ?? [];
    if (objectionSteps.length > 0) {
      await tx.jobContentStep.createMany({
        data: objectionSteps.map((step, i) => ({ contentId, sortOrder: i, stepGroup: "objection_steps" as const, ...step })),
      });
    }
  }

  if (input.type === "other" && input.otherFields) {
    const f = input.otherFields;
    await tx.jobDetailOther.create({
      data: { contentId, summary: f.summary, tags: f.tags ?? undefined, cardMeta: f.cardMeta ?? undefined },
    });
  }

  if (input.type === "exam_calendar" && input.examCalendarFields) {
    const f = input.examCalendarFields;
    await tx.jobDetailExamCalendar.create({
      data: {
        contentId,
        examDate: f.examDate ?? undefined,
        applyStartDate: f.applyStartDate ?? undefined,
        applyEndDate: f.applyEndDate ?? undefined,
        admitCardDate: f.admitCardDate ?? undefined,
        admitCardNote: f.admitCardNote,
      },
    });
  }

  if (input.type === "syllabus" && input.syllabusFields) {
    const f = input.syllabusFields;
    await tx.jobDetailSyllabus.create({
      data: {
        contentId,
        subtitle: f.subtitle,
        languages: f.languages,
        sectionsCount: f.sectionsCount,
        downloadUrl: f.downloadUrl,
      },
    });
    for (const [i, stage] of (f.stages ?? []).entries()) {
      const createdStage = await tx.jobSyllabusStage.create({
        data: {
          contentId,
          sortOrder: i,
          stage: stage.stage,
          description: stage.description,
          mode: stage.mode,
          medium: stage.medium,
          totalMarks: stage.totalMarks,
        },
      });
      for (const [j, subject] of (stage.subjects ?? []).entries()) {
        const createdSubject = await tx.jobSyllabusSubject.create({
          data: { stageId: createdStage.id, sortOrder: j, subject: subject.subject },
        });
        const topics = subject.topics ?? [];
        if (topics.length > 0) {
          await tx.jobSyllabusTopic.createMany({
            data: topics.map((topic, k) => ({ subjectId: createdSubject.id, sortOrder: k, topic })),
          });
        }
      }
    }
  }
};
