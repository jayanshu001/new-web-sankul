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
import { isMysqlModule } from "../../config/migration";
import { isNewItem } from "../../utils/isNew";
import { catalogEbookRepository as repo } from "./catalog-ebook.repository";
import { toEbookDto, toEbookPlanDto } from "./catalog-ebook.transformer";
import { listActivePricesByEbooks } from "../commerce-price/commerce-price.service";
import { listActiveByCustomerForEbooks } from "../commerce-ebook-sub/commerce-ebook-sub.service";
import type {
  EbookDto,
  EbookListItemDto,
  EbookPlanDto,
  ListEbooksOptions,
} from "./catalog-ebook.types";

export const EBOOK_MODULE = "catalog-ebook";
export const isEbookMysql = (): boolean => isMysqlModule(EBOOK_MODULE);

/** Parse a string id to a positive int, else null. */
export const parseEbookId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Whole-day difference (ceil), matching the controller's `daysBetween`. */
const daysBetween = (from: Date, to: Date): number =>
  Math.max(0, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));

/** Single active ebook by id (no composition). */
export const findActiveEbookById = async (id: number): Promise<EbookDto | null> => {
  const row = await repo.findActiveById(id);
  return row ? toEbookDto(row) : null;
};

/**
 * Single active ebook with its plans + per-customer purchase state — the
 * `getEbookDetail` composition. Returns null if the ebook is missing/inactive.
 * Same `isPaid` (price-derived) + computed-field rules as the listing.
 */
export const getEbookDetailWithPlans = async (
  id: number,
  opts: { customerId?: number } = {},
  buildShareLink: (ebookId: string) => string = (eid) => eid
): Promise<EbookListItemDto | null> => {
  const row = await repo.findActiveById(id);
  if (!row) return null;
  const dto = toEbookDto(row);

  const prices = await listActivePricesByEbooks([row.id]);
  const plans = prices.filter((p) => p.ebookId === dto._id).map(toEbookPlanDto);

  const now = new Date();
  let endAt: Date | null = null;
  if (opts.customerId) {
    const subs = await listActiveByCustomerForEbooks(opts.customerId, [row.id], now);
    for (const s of subs) {
      if (s.endAt == null) continue;
      if (!endAt || s.endAt.getTime() > endAt.getTime()) endAt = s.endAt;
    }
  }

  const isPaid = plans.some((p) => (p.price ?? 0) > 0);
  return {
    ...dto,
    plans,
    details: [
      { id: 1, mainText: "Language", subText: dto.language },
      { id: 2, mainText: "Author", subText: dto.author },
      { id: 3, mainText: "Publisher", subText: dto.publisher },
    ],
    isPaid,
    isPurchased: !!endAt,
    isNew: isNewItem(dto.createdAt, now),
    subscriptionEndAt: endAt,
    daysLeft: endAt ? daysBetween(now, endAt) : null,
    shareableLink: buildShareLink(dto._id),
  };
};

/**
 * The MySQL equivalent of the Mongo `listEbooks`: active ebooks (name/author
 * search + language filter) each enriched with its active plans (commerce-price)
 * and per-customer purchase state (commerce-ebook-sub). `isPaid` is derived from
 * the plans (paid when ≥1 active plan price > 0) — exactly the controller's
 * fallback when the Mongo `isPaid` field is absent, which it always is for SQL.
 *
 * `buildShareLink(ebookId)` supplies the per-request deep link (HTTP concern).
 */
export const listEbooksWithPlans = async (
  opts: ListEbooksOptions = {},
  buildShareLink: (ebookId: string) => string = (id) => id
): Promise<EbookListItemDto[]> => {
  const rows = await repo.listActive({
    search: opts.search?.trim() || undefined,
    language: opts.language,
  });
  if (!rows.length) return [];

  const ebookIds = rows.map((r) => r.id);

  // Active plans for all listed ebooks, bucketed by ebook (duration-asc already).
  const prices = await listActivePricesByEbooks(ebookIds);
  const plansByEbook = new Map<string, EbookPlanDto[]>();
  for (const p of prices) {
    if (!p.ebookId) continue;
    let bucket = plansByEbook.get(p.ebookId);
    if (!bucket) {
      bucket = [];
      plansByEbook.set(p.ebookId, bucket);
    }
    bucket.push(toEbookPlanDto(p));
  }

  // Per-ebook active access window (latest endAt wins) for the customer.
  const now = new Date();
  const endAtByEbook = new Map<string, Date>();
  if (opts.customerId) {
    const subs = await listActiveByCustomerForEbooks(opts.customerId, ebookIds, now);
    for (const s of subs) {
      if (s.ebookId == null || s.endAt == null) continue;
      const key = String(s.ebookId);
      const prev = endAtByEbook.get(key);
      if (!prev || s.endAt.getTime() > prev.getTime()) endAtByEbook.set(key, s.endAt);
    }
  }

  return rows.map((row) => {
    const dto = toEbookDto(row);
    const plans = plansByEbook.get(dto._id) ?? [];
    const endAt = endAtByEbook.get(dto._id) ?? null;
    const isPaid = plans.some((p) => (p.price ?? 0) > 0);
    return {
      ...dto,
      plans,
      details: [
        { id: 1, mainText: "Language", subText: dto.language },
        { id: 2, mainText: "Author", subText: dto.author },
        { id: 3, mainText: "Publisher", subText: dto.publisher },
      ],
      isPaid,
      isPurchased: !!endAt,
      isNew: isNewItem(dto.createdAt, now),
      subscriptionEndAt: endAt,
      daysLeft: endAt ? daysBetween(now, endAt) : null,
      shareableLink: buildShareLink(dto._id),
    };
  });
};
