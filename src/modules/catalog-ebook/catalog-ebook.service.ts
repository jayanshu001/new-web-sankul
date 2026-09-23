/**
 * Catalog · eBook service — dual-path (MySQL/Prisma ↔ Mongo/Mongoose).
 *
 * Module key: `catalog-ebook` (flag OFF until the ebook cluster flips). Reads
 * `ws_ebook` and COMPOSES the listing with two already-migrated modules:
 *   - commerce-price       → ebook plans (shared `ws_package_course_ebook_price`)
 *   - commerce-ebook-sub   → per-customer active entitlement (access window)
 * There is NO separate ebook-price module (no `ws_ebook_price` table).
 *
 * `listEbooksWithPlans` mirrors the Mongo `listEbooks` output. The per-request
 * deep link is NOT computed here (it needs the HTTP request) — the caller passes
 * a `buildShareLink(ebookId)` callback and the controller supplies it. Verify
 * via live-DB tsx, not HTTP, while OFF.
 */
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


/** Parse a string id to a positive int, else null. */
export const parseEbookId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const daysBetween = (from: Date, to: Date): number => computeDaysLeft(to, from) ?? 0;

/** Single active ebook by id (no composition). */
export const findActiveEbookById = async (id: number): Promise<EbookDto | null> => {
  const row = await repo.findActiveById(id);
  return row ? toEbookDto(row) : null;
};

// ── Shared/live split ────────────────────────────────────────────────────────
// Everything about an ebook row EXCEPT the per-customer overlay is identical
// for every caller — but unlike course/package, that overlay isn't just
// isPurchased/daysLeft: toEbookDto also mints `demoMediaToken`/`bookMediaToken`,
// short-lived customer-bound tokens (see catalog-ebook.transformer.ts). Those
// must NEVER be cached — mirrors the video mediaToken reasoning in
// client/categories/categories.controller.ts. So the cached "shared row" omits
// both tokens (and isPurchased/isPaid/isNew/daysLeft/shareableLink, which are
// also request- or customer-dependent), and `mergeEbookLive` mints/computes all
// of that fresh on every request.
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
 * Single active ebook with its plans + per-customer purchase state — the
 * `getEbookDetail` composition. Returns null if the ebook is missing/inactive.
 * Shared row + plans cached (CacheEntity.CatalogEbook, already flushed by admin
 * ebook/plan/price writes); tokens + isPurchased/daysLeft always computed live.
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
 * The MySQL equivalent of the Mongo `listEbooks`: active ebooks (name/author
 * search + language filter) each enriched with its active plans (commerce-price)
 * and per-customer purchase state (commerce-ebook-sub). `isPaid` is derived from
 * the plans (paid when ≥1 active plan price > 0) — exactly the controller's
 * fallback when the Mongo `isPaid` field is absent, which it always is for SQL.
 *
 * `buildShareLink(ebookId)` supplies the per-request deep link (HTTP concern).
 * Shared rows + plans cached; tokens + isPurchased/daysLeft always live.
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
      // Plain object, not a Map — Maps don't survive a JSON.stringify round-trip.
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
