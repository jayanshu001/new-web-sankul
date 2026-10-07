// Ebook catalog: ebook list and detail with plans and purchase state.
import type { EBook } from "@prisma/client";
import { computeDaysLeft } from "../../utils/planDuration";
import { isNewItem } from "../../utils/isNew";
import { catalogEbookRepository as repo } from "./catalog-ebook.repository";
import { toEbookDto, toEbookPlanDto } from "./catalog-ebook.transformer";
import { listActivePricesByEbooks } from "../commerce-price/commerce-price.service";
import { listActiveByCustomerForEbooks } from "../commerce-ebook-sub/commerce-ebook-sub.service";
import { signMediaToken } from "../../utils/mediaToken";
import cache, { CacheDomain } from "../../libs/cache";
import { CacheEntity } from "../../middlewares/flushGroups";
import type {
  EbookDto,
  EbookListItemDto,
  EbookPlanDto,
  ListEbooksOptions,
} from "./catalog-ebook.types";

export const parseEbookId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const daysBetween = (from: Date, to: Date): number => computeDaysLeft(to, from) ?? 0;

export const findActiveEbookById = async (id: number): Promise<EbookDto | null> => {
  const row = await repo.findActiveById(id);
  return row ? toEbookDto(row) : null;
};

// The cached shared row must exclude everything request- or customer-dependent:
// the customer-bound `demoMediaToken`/`bookMediaToken` (never cache these) plus
// isPurchased/isPaid/isNew/daysLeft/shareableLink. `mergeEbookLive` computes them
// fresh on every request.
type EbookSharedRow = Pick<
  EbookDto,
  "_id" | "name" | "thumbnail" | "image" | "description" | "termsAndConditions" |
  "author" | "publisher" | "language" | "order" | "hasBookFile" | "link" | "status" |
  "isTrending" | "createdAt" | "updatedAt"
> & { _rowId: number; _hasDemoFile: boolean };

const toEbookSharedRow = (row: EBook): EbookSharedRow => ({
  _id: String(row.id),
  name: row.name,
  thumbnail: row.thumbnail,
  image: row.image,
  description: row.description ?? null,
  termsAndConditions: row.termsAndConditions,
  author: row.author ?? null,
  publisher: row.publisher ?? null,
  language: row.language,
  order: row.orderby,
  hasBookFile: !!row.bookUrl,
  link: row.shareableLink,
  status: row.active,
  isTrending: false,
  createdAt: row.createdAt ?? null,
  updatedAt: row.updatedAt ?? null,
  _rowId: row.id,
  _hasDemoFile: !!row.bookDemoUrl,
});

const mergeEbookLive = (
  shared: EbookSharedRow,
  opts: {
    customerId: number | null;
    entitled: boolean;
    endAt: Date | null;
    plans: EbookPlanDto[];
    now: Date;
    buildShareLink: (ebookId: string) => string;
  }
): EbookListItemDto => {
  const { _rowId, _hasDemoFile, ...dto } = shared;
  const cust = opts.customerId;
  const demoMediaToken = cust != null && _hasDemoFile ? signMediaToken({ k: "ebookDemo", id: _rowId, free: true, cust }) : null;
  const bookMediaToken =
    cust != null && opts.entitled && shared.hasBookFile
      ? signMediaToken({ k: "ebook", id: _rowId, scope: { kind: "ebook", id: _rowId }, cust })
      : null;
  const isPaid = opts.plans.some((p) => (p.price ?? 0) > 0);
  return {
    ...dto,
    demoMediaToken,
    bookMediaToken,
    plans: opts.plans,
    details: [
      { id: 1, mainText: "Language", subText: dto.language },
      { id: 2, mainText: "Author", subText: dto.author },
      { id: 3, mainText: "Publisher", subText: dto.publisher },
    ],
    isPaid,
    isPurchased: !!opts.endAt,
    isNew: isNewItem(dto.createdAt, opts.now),
    subscriptionEndAt: opts.endAt,
    daysLeft: opts.endAt ? daysBetween(opts.now, opts.endAt) : null,
    shareableLink: opts.buildShareLink(dto._id),
  };
};

/**
 * Shared row and plans are cached under CacheEntity.CatalogEbook (flushed by admin
 * ebook/plan/price writes); tokens and isPurchased/daysLeft are always computed live.
 */
export const getEbookDetailWithPlans = async (
  id: number,
  opts: { customerId?: number } = {},
  buildShareLink: (ebookId: string) => string = (eid) => eid
): Promise<EbookListItemDto | null> => {
  const cached = await cache.aside({
    key: cache.key(CacheDomain.Client, CacheEntity.CatalogEbook, `detail:${id}`),
    ttlSeconds: 60,
    load: async () => {
      const row = await repo.findActiveById(id);
      if (!row) return null;
      const prices = await listActivePricesByEbooks([row.id]);
      const plans = prices.filter((p) => p.ebookId === String(row.id)).map(toEbookPlanDto);
      return { shared: toEbookSharedRow(row), plans };
    },
  });
  if (!cached) return null;

  const now = new Date();
  let endAt: Date | null = null;
  if (opts.customerId) {
    const subs = await listActiveByCustomerForEbooks(opts.customerId, [cached.shared._rowId], now);
    for (const s of subs) {
      if (s.endAt == null) continue;
      if (!endAt || s.endAt.getTime() > endAt.getTime()) endAt = s.endAt;
    }
  }

  return mergeEbookLive(cached.shared, {
    customerId: opts.customerId ?? null,
    entitled: !!endAt,
    endAt,
    plans: cached.plans,
    now,
    buildShareLink,
  });
};

/**
 * `isPaid` is derived from the plans (any active plan price > 0). Shared rows and
 * plans are cached; tokens and isPurchased/daysLeft are always computed live.
 */
export const listEbooksWithPlans = async (
  opts: ListEbooksOptions = {},
  buildShareLink: (ebookId: string) => string = (id) => id
): Promise<{ ebooks: EbookListItemDto[]; total: number }> => {
  const search = opts.search?.trim() || undefined;
  const filter = { search, language: opts.language };

  const cached = await cache.aside({
    key: cache.key(
      CacheDomain.Client,
      CacheEntity.CatalogEbook,
      `list:${cache.hashFilter({ ...filter, skip: opts.skip, take: opts.take })}`
    ),
    ttlSeconds: 60,
    load: async () => {
      const [rows, total] = await Promise.all([
        repo.listActive({ ...filter, skip: opts.skip, take: opts.take }),
        repo.countActive(filter),
      ]);
      if (!rows.length) return { sharedRows: [] as EbookSharedRow[], total, plansByEbook: {} as Record<string, EbookPlanDto[]> };
      const ebookIds = rows.map((r) => r.id);
      const prices = await listActivePricesByEbooks(ebookIds);
      // Plain object, not a Map: Maps don't survive the cache's JSON round-trip.
      const plansByEbook: Record<string, EbookPlanDto[]> = {};
      for (const p of prices) {
        if (!p.ebookId) continue;
        (plansByEbook[p.ebookId] ??= []).push(toEbookPlanDto(p));
      }
      return { sharedRows: rows.map(toEbookSharedRow), total, plansByEbook };
    },
  });

  if (!cached.sharedRows.length) return { ebooks: [], total: cached.total };

  const now = new Date();
  const endAtByEbook = new Map<string, Date>();
  if (opts.customerId) {
    const ebookIds = cached.sharedRows.map((r) => r._rowId);
    const subs = await listActiveByCustomerForEbooks(opts.customerId, ebookIds, now);
    for (const s of subs) {
      if (s.ebookId == null || s.endAt == null) continue;
      const key = String(s.ebookId);
      const prev = endAtByEbook.get(key);
      if (!prev || s.endAt.getTime() > prev.getTime()) endAtByEbook.set(key, s.endAt);
    }
  }

  const ebooks = cached.sharedRows.map((shared) => {
    const endAt = endAtByEbook.get(shared._id) ?? null;
    const plans = cached.plansByEbook[shared._id] ?? [];
    return mergeEbookLive(shared, {
      customerId: opts.customerId ?? null,
      entitled: !!endAt,
      endAt,
      plans,
      now,
      buildShareLink,
    });
  });

  return { ebooks, total: cached.total };
};
