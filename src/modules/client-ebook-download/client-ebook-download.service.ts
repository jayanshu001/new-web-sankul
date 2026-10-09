// Ebook downloads: record, list, count and remove a customer's offline ebooks.
import { prisma } from "../../config/prisma";
import { signMediaToken } from "../../utils/mediaToken";
import { parsePositiveInt } from "../../utils/parseId";

/**
 * An "active download" is a download row whose subscription is active
 * (status=true, endAt>now). The ebook's own status is not required: an owner keeps
 * access to a deactivated ebook (deactivation only hides it from browse/purchase).
 */

export const parseDlId = parsePositiveInt;

const activeSubEbookIds = async (customerId: number, now: Date, filter?: number[]): Promise<Set<string>> => {
  const rows = await prisma.eBookSubscription.findMany({
    where: { customerId, status: true, endAt: { gt: now }, ...(filter && filter.length ? { ebookId: { in: filter } } : {}) },
    select: { ebookId: true },
  });
  return new Set(rows.map((r) => String(r.ebookId)));
};

// No `active` filter: the download endpoint gates on the subscription, so an
// owner can still download a deactivated ebook.
export const findActiveEbook = (ebookId: number) =>
  prisma.eBook.findFirst({ where: { id: ebookId }, select: { id: true, name: true, bookUrl: true } });

export const hasActiveSub = async (customerId: number, ebookId: number, now = new Date()): Promise<boolean> =>
  (await activeSubEbookIds(customerId, now, [ebookId])).has(String(ebookId));

/** Idempotent: refreshes `downloadedAt` on an existing row. */
export const recordDownload = async (customerId: number, ebookId: number, now = new Date()): Promise<void> => {
  const existing = await prisma.ebookDownload.findFirst({ where: { customerId, ebookId }, select: { id: true } });
  if (existing) await prisma.ebookDownload.update({ where: { id: existing.id }, data: { downloadedAt: now } });
  else await prisma.ebookDownload.create({ data: { customerId, ebookId, downloadedAt: now } });
};

// Only rows with an active subscription, each with a fresh media token.
export const listDownloads = async (customerId: number, now = new Date()) => {
  const rows = await prisma.ebookDownload.findMany({ where: { customerId }, orderBy: { downloadedAt: "desc" } });
  if (!rows.length) return [];
  const ebookIds = [...new Set(rows.map((r) => r.ebookId))];
  const [activeIds, ebooks] = await Promise.all([
    activeSubEbookIds(customerId, now, ebookIds),
    // No `active` filter: deactivated-but-owned ebooks stay listed.
    prisma.eBook.findMany({ where: { id: { in: ebookIds } }, select: { id: true, name: true, author: true, image: true, thumbnail: true, bookUrl: true, language: true } }),
  ]);
  const byId = new Map(ebooks.map((e) => [e.id, e]));
  return rows
    .filter((r) => activeIds.has(String(r.ebookId)) && byId.has(r.ebookId))
    .map((r) => {
      const e = byId.get(r.ebookId)!;
      // Rows are already filtered to active subscriptions, so the customer is entitled.
      const mediaToken = e.bookUrl ? signMediaToken({ k: "ebook", id: e.id, scope: { kind: "ebook", id: e.id }, cust: customerId }) : null;
      return { _id: String(r.id), ebookId: String(e.id), name: e.name, author: e.author ?? null, image: e.image ?? null, thumbnail: e.thumbnail ?? null, language: e.language ?? null, mediaToken, downloadedAt: r.downloadedAt };
    });
};

/** Profile-dashboard count: downloads with a live ebook + active subscription. */
export const countActiveDownloads = async (customerId: number, now = new Date()): Promise<number> => {
  const rows = await prisma.ebookDownload.findMany({ where: { customerId }, select: { ebookId: true } });
  if (!rows.length) return 0;
  const ebookIds = [...new Set(rows.map((r) => r.ebookId))];
  const [activeIds, live] = await Promise.all([
    activeSubEbookIds(customerId, now, ebookIds),
  // No `active` filter: deactivated-but-owned ebooks count too.
    prisma.eBook.findMany({ where: { id: { in: ebookIds } }, select: { id: true } }),
  ]);
  const liveIds = new Set(live.map((e) => String(e.id)));
  return rows.reduce((n, r) => (activeIds.has(String(r.ebookId)) && liveIds.has(String(r.ebookId)) ? n + 1 : n), 0);
};

export const removeDownload = async (customerId: number, ebookId: number): Promise<boolean> => {
  const r = await prisma.ebookDownload.deleteMany({ where: { customerId, ebookId } });
  return r.count > 0;
};
