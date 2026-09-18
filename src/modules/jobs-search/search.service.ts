import { prisma } from "../../config/prisma";
import { searchRepository } from "./search.repository";

const HREF_PREFIX: Record<string, string> = {
  job: "/students-corner",
  admit_card: "/call-letters",
  result: "/results",
  answer_key: "/answer-keys",
  syllabus: "/syllabus",
  other: "/others",
  exam_calendar: "/exam-calendar",
};

/** Keeps `wsj_search_documents` in sync with one content row. Only
 * `status: "published"` rows are indexed — everything else is removed. */
export const syncContentToSearchIndex = async (contentId: bigint): Promise<void> => {
  const content = await prisma.jobContent.findUnique({
    where: { id: contentId },
    include: { organization: true, categories: { include: { category: true } } },
  });
  if (!content) {
    await searchRepository.deleteByContent("__unknown__", contentId);
    return;
  }
  if (content.status !== "published") {
    await searchRepository.deleteByContent(content.type, contentId);
    return;
  }
  const categorySlugs = content.categories.map((link) => link.category.slug).join(",");
  await searchRepository.upsert({
    contentType: content.type,
    contentId,
    slug: content.slug,
    title: content.title,
    subtitle: content.subtitle,
    orgName: content.organization?.name ?? null,
    categorySlugs: categorySlugs || null,
    href: `${HREF_PREFIX[content.type] ?? ""}/${content.slug}`,
    publishedAt: content.publishedAt,
  });
};

export const removeFromSearchIndex = async (contentType: string, contentId: bigint): Promise<void> => {
  await searchRepository.deleteByContent(contentType, contentId);
};

export const removeManyFromSearchIndex = async (contentType: string, contentIds: bigint[]): Promise<void> => {
  if (contentIds.length === 0) return;
  await searchRepository.deleteByContentIds(contentType, contentIds);
};
