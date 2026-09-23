/**
 * Catalog · Book service — dual-path (MySQL/Prisma ↔ Mongo/Mongoose).
 *
 * Module key: `catalog-book` (flag OFF). Reads `ws_book` and produces book DATA
 * + the data-only computed fields (isPaid/key/isNew/daysLeft/shareableLink).
 *
 * WIRED 2026-06-13: `listBooks`/`getBookDetail` now branch on `isBookMysql()`.
 * The per-customer cart `qty`/`cartId` + `isPurchased` enrichment comes from the
 * book-order module's read helpers (`getActiveCartState`/`getPurchasedBookIdSet`)
 * — those order/cart tables migrated with `book-order` (Phase 3b), so the int
 * book id-space now matches. This module still supplies only the book DATA +
 * data-only computed fields; the controller composes the cart/purchase state.
 * The per-request deep link is supplied by a `buildShareLink` callback.
 */
import type { Book } from "@prisma/client";
import { isNewItem } from "../../utils/isNew";
import { getModuleTermsText } from "../terms/terms.service";
import { catalogBookRepository as repo } from "./catalog-book.repository";
import { toBookDto } from "./catalog-book.transformer";
import { signMediaToken } from "../../utils/mediaToken";
import cache, { CacheDomain } from "../../libs/cache";
import { CacheEntity } from "../../middlewares/flushGroups";
import type {
  BookDto,
  BookListItemDto,
  ListBooksOptions,
} from "./catalog-book.types";


/**
 * Books whose own `terms_and_conditions` is empty fall back to the module-level
 * `ws_termsandcondition` row for module='book' — the store-wide book T&C the
 * admin maintains under Terms & Conditions. Resolved ONCE per service call (one
 * single-row read on a two-row table) and handed to every row's transformer, so
 * a 20-book page still costs one extra query, not twenty.
 *
 * The per-book value always wins when set; this only fills the hole that made
 * the app render an empty T&C section.
 */
const bookTermsFallback = (): Promise<string> => getModuleTermsText("book");

/** Parse a string id to a positive int, else null. */
export const parseBookId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Add the data-only computed fields to a book DTO (no order/cart state). */
const decorate = (
  dto: BookDto,
  buildShareLink: (bookId: string) => string,
  now: Date
): BookListItemDto => ({
  ...dto,
  key: dto.isCombo ? "combo" : "individual",
  isPaid: dto.discountedPrice > 0,
  daysLeft: null,
  isNew: isNewItem(dto.createdAt, now),
  shareableLink: buildShareLink(dto._id),
});

// ── Shared/live split ────────────────────────────────────────────────────────
// Everything about a book row except `demoMediaToken` is customer-independent —
// but that token IS customer-bound whenever a demo PDF exists (minted with the
// caller's id, or a public `0` sentinel when anonymous — see toBookDto). It must
// never be cached, same reasoning as catalog-ebook.service.ts's demoMediaToken/
// bookMediaToken split. So the cached row omits it (and carries a `_hasDemoUrl`
// flag instead), and the token is (re)minted fresh on every request.
type BookSharedDto = Omit<BookDto, "demoMediaToken"> & { _rowId: number; _hasDemoUrl: boolean };

const toBookSharedDto = (row: Book, fallbackTerms: string): BookSharedDto => {
  const { demoMediaToken, ...rest } = toBookDto(row, { fallbackTerms });
  void demoMediaToken; // minted with a cust:0 sentinel here (no customerId) — discarded, never cached
  return { ...rest, _rowId: row.id, _hasDemoUrl: !!row.demo_url };
};

const mergeBookShared = (
  shared: BookSharedDto,
  buildShareLink: (bookId: string) => string,
  now: Date,
  customerId: number | null
): BookListItemDto => {
  const { _rowId, _hasDemoUrl, ...dto } = shared;
  const demoMediaToken = _hasDemoUrl ? signMediaToken({ k: "bookDemo", id: _rowId, free: true, cust: customerId ?? 0 }) : null;
  return decorate({ ...dto, demoMediaToken } as BookDto, buildShareLink, now);
};

/**
 * Single active book (data + computed fields), or null. Shared data cached
 * (CacheEntity.CatalogBook, already flushed by admin book writes); the
 * customer-bound demoMediaToken is always minted live.
 */
export const getBookById = async (
  id: number,
  buildShareLink: (bookId: string) => string = (bid) => bid,
  now: Date = new Date(),
  customerId: number | null = null
): Promise<BookListItemDto | null> => {
  const shared = await cache.aside({
    key: cache.key(CacheDomain.Client, CacheEntity.CatalogBook, `detail:${id}`),
    ttlSeconds: 60,
    load: async () => {
      const [row, fallbackTerms] = await Promise.all([repo.findActiveById(id), bookTermsFallback()]);
      return row ? toBookSharedDto(row, fallbackTerms) : null;
    },
  });
  return shared ? mergeBookShared(shared, buildShareLink, now, customerId) : null;
};

/**
 * One page of active books (name/author search + language + `type` bucket) with
 * the data-only computed fields, plus the total for pagination. The caller
 * layers on cart `qty` + `isPurchased` from book-order (fully SQL — Phase 3b).
 * Shared rows cached; demoMediaToken always minted live (see split above).
 */
export const listBooksData = async (
  opts: ListBooksOptions = {},
  buildShareLink: (bookId: string) => string = (bid) => bid,
  now: Date = new Date(),
  customerId: number | null = null
): Promise<{ items: BookListItemDto[]; total: number }> => {
  const filter: ListBooksOptions = {
    search: opts.search?.trim() || undefined,
    language: opts.language,
    type: opts.type,
  };
  const cached = await cache.aside({
    key: cache.key(
      CacheDomain.Client,
      CacheEntity.CatalogBook,
      `list:${cache.hashFilter({ ...filter, skip: opts.skip, take: opts.take })}`
    ),
    ttlSeconds: 60,
    load: async () => {
      const [rows, total, fallbackTerms] = await Promise.all([
        repo.listActive({ ...filter, skip: opts.skip, take: opts.take }),
        repo.countActive(filter),
        bookTermsFallback(),
      ]);
      return { sharedRows: rows.map((r) => toBookSharedDto(r, fallbackTerms)), total };
    },
  });
  return {
    items: cached.sharedRows.map((s) => mergeBookShared(s, buildShareLink, now, customerId)),
    total: cached.total,
  };
};

/** Books by ids (bulk hydration — purchase-history/cart book thumbnails). */
export const findBooksByIds = async (ids: number[]): Promise<BookDto[]> => {
  if (!ids.length) return [];
  const [rows, fallbackTerms] = await Promise.all([repo.findByIds(ids), bookTermsFallback()]);
  return rows.map((r) => toBookDto(r, { fallbackTerms }));
};
