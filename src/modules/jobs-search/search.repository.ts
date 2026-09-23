import { prisma } from "../../config/prisma";

export interface SearchDocumentWrite {
  contentType: string;
  contentId: bigint;
  slug: string;
  title: string;
  subtitle?: string | null;
  orgName?: string | null;
  categorySlugs?: string | null;
  href: string;
  publishedAt?: Date | null;
}

export const searchRepository = {
  upsert: (doc: SearchDocumentWrite) =>
    prisma.jobSearchDocument.upsert({
      where: { contentType_contentId: { contentType: doc.contentType, contentId: doc.contentId } },
      create: { ...doc, updatedAt: new Date() },
      update: { ...doc, updatedAt: new Date() },
    }),

  deleteByContent: (contentType: string, contentId: bigint) =>
    prisma.jobSearchDocument.deleteMany({ where: { contentType, contentId } }),

  deleteByContentIds: (contentType: string, contentIds: bigint[]) =>
    prisma.jobSearchDocument.deleteMany({ where: { contentType, contentId: { in: contentIds } } }),
};
