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
import { isNewItem } from "../../utils/isNew";
import { catalogBookRepository as repo } from "./catalog-book.repository";
import { toBookDto } from "./catalog-book.transformer";
import type {
  BookDto,
  BookListItemDto,
  ListBooksOptions,
} from "./catalog-book.types";

export const BOOK_MODULE = "catalog-book";
export const isBookMysql = (): boolean => true;

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

/** Single active book (data + computed fields), or null. */
export const getBookById = async (
  id: number,
  buildShareLink: (bookId: string) => string = (bid) => bid,
  now: Date = new Date(),
  customerId: number | null = null
): Promise<BookListItemDto | null> => {
  const row = await repo.findActiveById(id);
  return row ? decorate(toBookDto(row, { customerId }), buildShareLink, now) : null;
};

/**
 * One page of active books (name/author search + language + `type` bucket) with
 * the data-only computed fields, plus the total for pagination. The caller
 * layers on cart `qty` + `isPurchased` from the (still-Mongo) order/cart tables
 * until those migrate.
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
  const [rows, total] = await Promise.all([
    repo.listActive({ ...filter, skip: opts.skip, take: opts.take }),
    repo.countActive(filter),
  ]);
  return { items: rows.map((r) => decorate(toBookDto(r, { customerId }), buildShareLink, now)), total };
};

/** Books by ids (bulk hydration — purchase-history/cart book thumbnails). */
export const findBooksByIds = async (ids: number[]): Promise<BookDto[]> => {
  const rows = await repo.findByIds(ids);
  return rows.map(toBookDto);
};
