/**
 * Jobs Management — one-time backfill from wsj_contents.card/detail JSON and
 * wsj_previous_papers.pdf_url/job_ids/products into the normalized tables
 * created by docs/migration/schema-changes/2026-09-17_jobs_normalize_content.sql.
 *
 * Usage:
 *   npx tsx scripts/backfill-jobs-normalize.ts
 *
 * Idempotent: every insert is preceded by a deleteMany scoped to the parent
 * row, so re-running reproduces the same end state instead of duplicating
 * rows. Source columns (card, detail, pdf_url, job_ids, products, ...) are
 * left untouched — this script only writes to the new tables.
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};

const asArray = (value: unknown): JsonRecord[] =>
  Array.isArray(value) ? value.filter((item) => item && typeof item === "object") as JsonRecord[] : [];

const asString = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str.length > 0 ? str : null;
};

const asDate = (value: unknown): Date | null => {
  const str = asString(value);
  if (!str) return null;
  const date = new Date(str);
  return Number.isNaN(date.getTime()) ? null : date;
};

const asBool = (value: unknown): boolean => value === true || value === "1" || value === 1;

const asBigInt = (value: unknown): bigint | null => {
  const str = asString(value);
  if (!str || !/^\d+$/.test(str)) return null;
  return BigInt(str);
};

const PRODUCT_TYPES = new Set(["course", "package", "book", "ebook"]);

const main = async () => {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("Missing DATABASE_URL. Copy .env.example → .env and set MySQL URL.");
    process.exit(1);
  }

  const { prisma, disconnectPrisma } = await import("../src/config/prisma");

  let contentRows = 0;
  let paperRows = 0;

  try {
    const contents = await prisma.jobContent.findMany();
    for (const content of contents) {
      await backfillContent(prisma, content);
      contentRows += 1;
    }

    const papers = await prisma.jobPreviousPaper.findMany();
    for (const paper of papers) {
      await backfillPaper(prisma, paper);
      paperRows += 1;
    }

    console.log(`Backfilled ${contentRows} wsj_contents rows and ${paperRows} wsj_previous_papers rows.`);
  } catch (err) {
    console.error("Backfill failed:", err);
    process.exit(1);
  } finally {
    await disconnectPrisma();
  }
};

const backfillContent = async (prisma: any, content: any) => {
  const contentId = content.id as bigint;
  const card = asRecord(content.card);
  const detail = asRecord(content.detail);

  await prisma.$transaction(async (tx: any) => {
    // Category (legacy single category_id → many-to-many join row).
    await tx.jobContentCategory.deleteMany({ where: { contentId } });
    if (content.categoryId) {
      await tx.jobContentCategory.create({
        data: { contentId, categoryId: content.categoryId, sortOrder: 0 },
      });
    }

    // SEO (today only populated for type=job).
    await tx.jobContentSeo.deleteMany({ where: { contentId } });
    const seo = asRecord(detail.seo);
    if (Object.keys(seo).length > 0) {
      await tx.jobContentSeo.create({
        data: {
          contentId,
          seoTitle: asString(seo.seo_title),
          metaDescription: asString(seo.meta_description),
          canonicalUrl: asString(seo.canonical_url),
          ogTitle: asString(seo.og_title),
          ogDescription: asString(seo.og_description),
          schemaType: asString(seo.schema_type),
          robotsIndex: seo.robots_index === undefined ? true : asBool(seo.robots_index),
          robotsFollow: seo.robots_follow === undefined ? true : asBool(seo.robots_follow),
        },
      });
    }

    // Card facts (job listing-card icon+meta repeater).
    await tx.jobContentFact.deleteMany({ where: { contentId } });
    const facts = asArray(card.card_facts);
    for (let i = 0; i < facts.length; i++) {
      const fact = facts[i];
      await tx.jobContentFact.create({
        data: {
          contentId,
          icon: asString(fact.icon),
          metaKey: asString(fact.meta_key ?? fact.title),
          metaValue: asString(fact.meta_value ?? fact.value),
          sortOrder: i,
        },
      });
    }

    // Attached catalog products.
    await tx.jobContentProduct.deleteMany({ where: { contentId } });
    const products = asArray(detail.products);
    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const productType = asString(product.product_type);
      const productId = asBigInt(product.product_id);
      if (!productType || !PRODUCT_TYPES.has(productType) || productId === null) continue;
      await tx.jobContentProduct.create({
        data: {
          contentId,
          productType: productType as any,
          productId,
          isFeatured: asBool(product.is_featured),
          sortOrder: i,
        },
      });
    }

    // Related posts.
    await tx.jobContentRelatedPost.deleteMany({ where: { contentId } });
    const relatedPosts = Array.isArray(detail.related_posts) ? detail.related_posts : [];
    let relatedOrder = 0;
    for (const relatedId of relatedPosts) {
      const relatedContentId = asBigInt(relatedId);
      if (relatedContentId === null || relatedContentId === contentId) continue;
      await tx.jobContentRelatedPost.create({
        data: { contentId, relatedContentId, sortOrder: relatedOrder },
      });
      relatedOrder += 1;
    }

    // Extra detail-page sections (generic block repeater).
    await tx.jobContentSectionItem.deleteMany({ where: { section: { contentId } } });
    await tx.jobContentSection.deleteMany({ where: { contentId } });
    const sections = asArray(detail.sections);
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const blockType = asString(section.block_type);
      if (!blockType) continue;
      const created = await tx.jobContentSection.create({
        data: {
          contentId,
          title: asString(section.title),
          blockType: blockType as any,
          position: (asString(section.position) as any) ?? "main",
          icon: asString(section.icon),
          isVisible: section.is_visible === undefined ? true : asBool(section.is_visible),
          sortOrder: i,
        },
      });
      const items = asArray(section.items);
      for (let j = 0; j < items.length; j++) {
        const item = items[j];
        await tx.jobContentSectionItem.create({
          data: {
            sectionId: created.id,
            icon: asString(item.icon),
            title: asString(item.title),
            value: asString(item.value),
            extra: asString(item.extra),
            sortOrder: j,
          },
        });
      }
    }

    // Generic step groups shared by admit_card/result/answer_key, and job's
    // selection_process.
    await tx.jobContentStep.deleteMany({ where: { contentId } });
    const stepSources: Array<[string, unknown]> = [
      ["selection_process", detail.selection_process],
      ["download_steps", detail.download_steps],
      ["how_to_check_steps", detail.how_to_check_steps],
      ["objection_steps", detail.objection_steps],
    ];
    for (const [stepGroup, source] of stepSources) {
      const steps = asArray(source);
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        await tx.jobContentStep.create({
          data: {
            contentId,
            stepGroup: stepGroup as any,
            title: asString(step.title),
            description: asString(step.description),
            sortOrder: i,
          },
        });
      }
    }

    // Job-only repeaters.
    await tx.jobContentDateItem.deleteMany({ where: { contentId } });
    const dateItems = asArray(detail.important_dates);
    for (let i = 0; i < dateItems.length; i++) {
      const item = dateItems[i];
      const label = asString(item.label ?? item.title);
      if (!label) continue;
      await tx.jobContentDateItem.create({
        data: { contentId, label, dateValue: asDate(item.date ?? item.value), note: asString(item.note), sortOrder: i },
      });
    }

    await tx.jobContentFeeItem.deleteMany({ where: { contentId } });
    const feeItems = asArray(detail.application_fees);
    for (let i = 0; i < feeItems.length; i++) {
      const item = feeItems[i];
      const categoryLabel = asString(item.category_label ?? item.category);
      const amountLabel = asString(item.amount_label ?? item.amount);
      if (!categoryLabel || !amountLabel) continue;
      await tx.jobContentFeeItem.create({ data: { contentId, categoryLabel, amountLabel, sortOrder: i } });
    }

    await tx.jobContentPaymentMode.deleteMany({ where: { contentId } });
    const paymentModes = Array.isArray(detail.payment_modes) ? detail.payment_modes : [];
    let paymentOrder = 0;
    for (const mode of paymentModes) {
      const label = asString(mode);
      if (!label) continue;
      await tx.jobContentPaymentMode.create({ data: { contentId, label, sortOrder: paymentOrder } });
      paymentOrder += 1;
    }

    await tx.jobContentNote.deleteMany({ where: { contentId } });
    const notes = Array.isArray(detail.notes) ? detail.notes : [];
    let noteOrder = 0;
    for (const note of notes) {
      const text = asString(note);
      if (!text) continue;
      await tx.jobContentNote.create({ data: { contentId, text, sortOrder: noteOrder } });
      noteOrder += 1;
    }

    // Per-type detail row.
    if (content.type === "job") {
      await tx.jobDetailJob.deleteMany({ where: { contentId } });
      await tx.jobDetailJob.create({
        data: {
          contentId,
          applicationStart: asDate(card.application_start),
          applicationEnd: asDate(card.application_end),
          location: asString(card.location),
          qualification: asString(card.qualification),
          excerpt: asString(card.excerpt ?? card.summary),
          totalPosts: asString(card.total_posts),
          applyUrl: asString(card.apply_url),
          officialNotificationUrl: asString(card.official_notification_url),
        },
      });
    } else if (content.type === "admit_card") {
      await tx.jobDetailAdmitCard.deleteMany({ where: { contentId } });
      await tx.jobDetailAdmitCard.create({
        data: {
          contentId,
          tierLabel: asString(card.tier_label),
          releasedAt: asDate(card.released_at),
          examDateLabel: asString(card.exam_date_label),
          releaseStatus: card.release_status === "released" ? "released" : "coming_soon",
          downloadUrl: asString(card.download_url),
          notifyUrl: asString(card.notify_url),
        },
      });
    } else if (content.type === "result") {
      await tx.jobDetailResult.deleteMany({ where: { contentId } });
      await tx.jobDetailResult.create({
        data: {
          contentId,
          declaredAt: asDate(card.declared_at),
          officialUrl: asString(card.official_url),
          downloadUrl: asString(card.download_url),
        },
      });
    } else if (content.type === "answer_key") {
      await tx.jobDetailAnswerKey.deleteMany({ where: { contentId } });
      await tx.jobDetailAnswerKey.create({
        data: {
          contentId,
          keyStatus: card.key_status === "final" ? "final" : "provisional",
          releasedAt: asDate(card.released_at),
          downloadUrl: asString(card.download_url),
          tags: card.tags ?? undefined,
        },
      });
    } else if (content.type === "other") {
      await tx.jobDetailOther.deleteMany({ where: { contentId } });
      await tx.jobDetailOther.create({
        data: {
          contentId,
          summary: asString(card.summary),
          tags: card.tags ?? undefined,
          cardMeta: card.card_meta ?? undefined,
        },
      });
    } else if (content.type === "exam_calendar") {
      await tx.jobDetailExamCalendar.deleteMany({ where: { contentId } });
      await tx.jobDetailExamCalendar.create({
        data: {
          contentId,
          examDate: asDate(card.exam_date),
          applyStartDate: asDate(card.apply_start_date),
          applyEndDate: asDate(card.apply_end_date),
          admitCardDate: asDate(card.admit_card_date),
          admitCardNote: asString(card.admit_card_note),
        },
      });
    } else if (content.type === "syllabus") {
      await tx.jobDetailSyllabus.deleteMany({ where: { contentId } });
      await tx.jobDetailSyllabus.create({
        data: {
          contentId,
          subtitle: asString(card.subtitle),
          languages: asString(card.languages),
          sectionsCount: typeof card.sections_count === "number" ? card.sections_count : null,
          downloadUrl: asString(card.download_url),
        },
      });

      await tx.jobSyllabusTopic.deleteMany({ where: { subject: { stage: { contentId } } } });
      await tx.jobSyllabusSubject.deleteMany({ where: { stage: { contentId } } });
      await tx.jobSyllabusStage.deleteMany({ where: { contentId } });
      const stages = asArray(detail.stages);
      for (let i = 0; i < stages.length; i++) {
        const stage = stages[i];
        const stageTitle = asString(stage.title ?? stage.stage_key);
        if (!stageTitle) continue;
        const createdStage = await tx.jobSyllabusStage.create({
          data: {
            contentId,
            stage: stageTitle,
            description: asString(stage.description),
            mode: asString(stage.mode),
            medium: asString(stage.medium),
            totalMarks: asString(stage.total_marks),
            sortOrder: i,
          },
        });
        const subjects = asArray(stage.subjects);
        for (let j = 0; j < subjects.length; j++) {
          const subject = subjects[j];
          const subjectTitle = asString(subject.title);
          if (!subjectTitle) continue;
          const createdSubject = await tx.jobSyllabusSubject.create({
            data: { stageId: createdStage.id, subject: subjectTitle, sortOrder: j },
          });
          const topics = Array.isArray(subject.topics) ? subject.topics : [];
          let topicOrder = 0;
          for (const topic of topics) {
            const topicText = asString(topic);
            if (!topicText) continue;
            await tx.jobSyllabusTopic.create({
              data: { subjectId: createdSubject.id, topic: topicText, sortOrder: topicOrder },
            });
            topicOrder += 1;
          }
        }
      }
    }
  });
};

const backfillPaper = async (prisma: any, paper: any) => {
  const paperId = paper.id as bigint;

  await prisma.$transaction(async (tx: any) => {
    // pdf_url is either a plain URL string or a JSON-encoded array of
    // {label, url} objects in the same VARCHAR column.
    await tx.jobPreviousPaperFile.deleteMany({ where: { paperId } });
    const pdfUrl = asString(paper.pdfUrl);
    if (pdfUrl) {
      let files: JsonRecord[] = [];
      try {
        const parsed = JSON.parse(pdfUrl);
        files = asArray(parsed);
      } catch {
        files = [{ url: pdfUrl }];
      }
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const url = asString(file.url);
        if (!url) continue;
        await tx.jobPreviousPaperFile.create({
          data: { paperId, label: asString(file.label), url, sortOrder: i },
        });
      }
    }

    // job_ids (JSON array) with a fallback to the legacy single content_id.
    await tx.jobPreviousPaperJobLink.deleteMany({ where: { paperId } });
    const jobIds = Array.isArray(paper.jobIds) ? paper.jobIds : [];
    const linkedIds = new Set<string>();
    for (const jobId of jobIds) {
      const contentId = asBigInt(jobId);
      if (contentId === null) continue;
      linkedIds.add(contentId.toString());
    }
    if (linkedIds.size === 0 && paper.contentId) {
      linkedIds.add((paper.contentId as bigint).toString());
    }
    for (const contentId of linkedIds) {
      await tx.jobPreviousPaperJobLink.create({
        data: { paperId, contentId: BigInt(contentId) },
      });
    }

    // Attached catalog products.
    await tx.jobContentProduct.deleteMany({ where: { paperId } });
    const products = asArray(paper.products);
    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const productType = asString(product.product_type);
      const productId = asBigInt(product.product_id);
      if (!productType || !PRODUCT_TYPES.has(productType) || productId === null) continue;
      await tx.jobContentProduct.create({
        data: {
          paperId,
          productType: productType as any,
          productId,
          isFeatured: asBool(product.is_featured),
          sortOrder: i,
        },
      });
    }
  });
};

main();
