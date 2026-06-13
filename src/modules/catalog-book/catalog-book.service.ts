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
import { isMysqlModule } from "../../config/migration";
import { isNewItem } from "../../utils/isNew";
import { catalogBookRepository as repo } from "./catalog-book.repository";
import { toBookDto } from "./catalog-book.transformer";
import type {
  BookDto,
  BookListItemDto,
  ListBooksOptions,
} from "./catalog-book.types";

export const BOOK_MODULE = "catalog-book";
export const isBookMysql = (): boolean => isMysqlModule(BOOK_MODULE);

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
  now: Date = new Date()
): Promise<BookListItemDto | null> => {
  const row = await repo.findActiveById(id);
  return row ? decorate(toBookDto(row), buildShareLink, now) : null;
};

/**
 * Active books (name/author search + language filter) with the data-only
 * computed fields. The caller layers on cart `qty` + `isPurchased` from the
 * (still-Mongo) order/cart tables until those migrate.
 */
export const listBooksData = async (
  opts: ListBooksOptions = {},
  buildShareLink: (bookId: string) => string = (bid) => bid,
  now: Date = new Date()
): Promise<BookListItemDto[]> => {
  const rows = await repo.listActive({
    search: opts.search?.trim() || undefined,
    language: opts.language,
  });
  return rows.map((r) => decorate(toBookDto(r), buildShareLink, now));
};

/** Books by ids (bulk hydration — purchase-history/cart book thumbnails). */
export const findBooksByIds = async (ids: number[]): Promise<BookDto[]> => {
  const rows = await repo.findByIds(ids);
  return rows.map(toBookDto);
};
