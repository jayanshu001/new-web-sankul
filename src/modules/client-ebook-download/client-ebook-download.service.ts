import { prisma } from "../../config/prisma";
import { signMediaToken } from "../../utils/mediaToken";

/**
 * Ebook-download write+read path on SQL (Wave 7 — net-new ws_ebook_download).
 * Everything it touches is already SQL when the flags are on: customer
 * (req.user.id is the SQL int under customer-auth), ebook (catalog-ebook),
 * EBookSubscription (commerce-ebook-sub). So no content-id bridge is needed —
 * the ebook id arrives as a SQL int in the route.
 *
 * "Active download" = a download row whose ebook is live (status=true) AND whose
 * subscription is still active (status=true, endAt>now) — mirrors the Mongo
 * listEbookDownloads / countActiveEbookDownloads filter.
 */
export const EBOOK_DOWNLOAD_MODULE = "client-ebook-download";
export const isEbookDownloadMysql = (): boolean => true;

export const parseDlId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Set of ebook ids (string) with an active subscription for this customer. */
const activeSubEbookIds = async (customerId: number, now: Date, filter?: number[]): Promise<Set<string>> => {
  const rows = await prisma.eBookSubscription.findMany({
    where: { customerId, status: true, endAt: { gt: now }, ...(filter && filter.length ? { ebookId: { in: filter } } : {}) },
    select: { ebookId: true },
  });
  return new Set(rows.map((r) => String(r.ebookId)));
};

export const findActiveEbook = (ebookId: number) =>
  prisma.eBook.findFirst({ where: { id: ebookId, active: true }, select: { id: true, name: true, bookUrl: true } });

export const hasActiveSub = async (customerId: number, ebookId: number, now = new Date()): Promise<boolean> =>
  (await activeSubEbookIds(customerId, now, [ebookId])).has(String(ebookId));

/** Idempotent upsert of a download row (refresh downloadedAt). */
export const recordDownload = async (customerId: number, ebookId: number, now = new Date()): Promise<void> => {
  const existing = await prisma.ebookDownload.findFirst({ where: { customerId, ebookId }, select: { id: true } });
  if (existing) await prisma.ebookDownload.update({ where: { id: existing.id }, data: { downloadedAt: now } });
  else await prisma.ebookDownload.create({ data: { customerId, ebookId, downloadedAt: now } });
};

export const listDownloads = async (customerId: number, now = new Date()) => {
  const rows = await prisma.ebookDownload.findMany({ where: { customerId }, orderBy: { downloadedAt: "desc" } });
  if (!rows.length) return [];
  const ebookIds = [...new Set(rows.map((r) => r.ebookId))];
  const [activeIds, ebooks] = await Promise.all([
    activeSubEbookIds(customerId, now, ebookIds),
    prisma.eBook.findMany({ where: { id: { in: ebookIds }, active: true }, select: { id: true, name: true, author: true, image: true, thumbnail: true, bookUrl: true, language: true } }),
  ]);
  const byId = new Map(ebooks.map((e) => [e.id, e]));
  return rows
    .filter((r) => activeIds.has(String(r.ebookId)) && byId.has(r.ebookId))
    .map((r) => {
      const e = byId.get(r.ebookId)!;
      // Rows are already filtered to active subscriptions ⇒ entitled. No raw PDF
      // URL: a book media token is exchanged at /media/resolve for a presigned URL.
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
    prisma.eBook.findMany({ where: { id: { in: ebookIds }, active: true }, select: { id: true } }),
  ]);
  const liveIds = new Set(live.map((e) => String(e.id)));
  return rows.reduce((n, r) => (activeIds.has(String(r.ebookId)) && liveIds.has(String(r.ebookId)) ? n + 1 : n), 0);
};

export const removeDownload = async (customerId: number, ebookId: number): Promise<boolean> => {
  const r = await prisma.ebookDownload.deleteMany({ where: { customerId, ebookId } });
  return r.count > 0;
};
