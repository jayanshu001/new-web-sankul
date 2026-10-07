// Catalog ordering: display-order then created_at comparator for in-memory sorts.
/**
 * Client catalog lists sort by the admin display-order column ASC, then
 * `created_at` ASC (unordered rows fall back to oldest-first, stable across
 * pages). Tables without `created_at` (e.g. `ws_video_category_relation`,
 * `ws_department`) tie-break on `id ASC`. Prisma call sites spell this inline;
 * the comparator here is for rows sorted in memory.
 *
 * User-owned/activity data (notifications, orders, cart, wishlist, progress,
 * subscriptions) is deliberately excluded and stays newest-first.
 */

/** The legacy `ws_*` tables spell the order column five different ways. */
type OrderedRow = {
  order?: number | null;
  order_by?: number | null;
  ordered?: number | null;
  orderby?: number | null;
  orderBy?: number | null;
  created_at?: Date | string | null;
  createdAt?: Date | string | null;
};

const orderValue = (r: OrderedRow): number =>
  r.order ?? r.order_by ?? r.ordered ?? r.orderby ?? r.orderBy ?? 0;

const createdValue = (r: OrderedRow): number => {
  const raw = r.created_at ?? r.createdAt;
  if (!raw) return 0;
  const t = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  return Number.isNaN(t) ? 0 : t;
};

/** `order ASC, created_at ASC` for rows fetched without an ORDER BY or re-sorted after a join. */
export const byOrderThenCreatedAt = (a: OrderedRow, b: OrderedRow): number =>
  orderValue(a) - orderValue(b) || createdValue(a) - createdValue(b);
