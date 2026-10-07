// Book catalog: cached book list and detail with live demo-media tokens.
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
 * Books with an empty `terms_and_conditions` fall back to the module-level
 * `ws_termsandcondition` row (module='book'). Resolved once per service call, not
 * per row; the per-book value always wins when set.
 */
const bookTermsFallback = (): Promise<string> => getModuleTermsText("book");

export const parseBookId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

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

// `demoMediaToken` is customer-bound when a demo PDF exists, so it must never be
// cached: the shared row carries `_hasDemoUrl` instead and the token is minted
// fresh on every request.
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

/** Shared data is cached under CacheEntity.CatalogBook; the customer-bound `demoMediaToken` is minted live. */
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

/** Shared rows are cached; `demoMediaToken` is always minted live. */
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

export const findBooksByIds = async (ids: number[]): Promise<BookDto[]> => {
  if (!ids.length) return [];
  const [rows, fallbackTerms] = await Promise.all([repo.findByIds(ids), bookTermsFallback()]);
  return rows.map((r) => toBookDto(r, { fallbackTerms }));
};
