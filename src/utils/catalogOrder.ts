/**
 * Shared ordering helpers for CLIENT catalog listings.
 *
 * Standing convention (applies to every client-side list whose table carries an
 * admin-managed display-order column): sort by that column ASCENDING first, then
 * `created_at` ASCENDING as the tiebreaker. Rows the admin has not explicitly
 * ordered (all sharing the default order value) therefore fall back to
 * oldest-created-first, which is stable across pages.
 *
 * Tables with a display-order column but NO `created_at` (e.g.
 * `ws_video_category_relation`, `ws_department`) use `id ASC` as the tiebreaker
 * instead — id is monotonic, so it approximates insertion order.
 *
 * Prisma call sites spell this inline as
 * `orderBy: [{ order_by: "asc" }, { created_at: "asc" }]` (the column names vary
 * per table — `order_by` / `orderby` / `order` / `ordered` / `orderBy`). The
 * comparator below is for the handful of places that sort already-fetched pivot
 * rows in memory rather than in SQL.
 *
 * NOTE: user-owned/activity data (notifications, purchase history, cart,
 * wishlist, progress, subscriptions) is deliberately NOT covered by this
 * convention — those stay newest-first.
 */

/**
 * A row carrying a display-order column plus an optional creation timestamp.
 * The legacy `ws_*` tables spell the same concept five different ways, so all of
 * them are accepted here.
 */
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

/**
 * Comparator implementing `order ASC, created_at ASC` for in-memory sorts of
 * pivot/relation rows that were fetched without an ORDER BY (or whose order must
 * be re-applied after a join in application code).
 */
export const byOrderThenCreatedAt = (a: OrderedRow, b: OrderedRow): number =>
  orderValue(a) - orderValue(b) || createdValue(a) - createdValue(b);
