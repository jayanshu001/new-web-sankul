/**
 * List ordering — two rules, one for each side of the product.
 *
 * ── 1. ADMIN LIST SCREENS: RECENCY IS THE CONTRACT ──────────────────────────
 *
 * (Adopted 2026-07-29, replacing the 2026-07-27 top-slot model.) `/admin/videos`
 * had always sorted admin rows by recency and was chosen as the pattern for every
 * admin list. So every top-level admin list sorts `created_at DESC, id DESC` when
 * the request asks for the order column or sends no sort at all — `sort_dir` is
 * ignored in that case, because "newest on top" is the requirement and honouring
 * the `asc` the UI sends would invert exactly what was asked for. Any other
 * `sort_by` (name, updatedAt, …) still sorts by its own column as requested.
 *
 * Consequence, ON PURPOSE: manual reordering is INVISIBLE on admin screens. To
 * restore curated ordering on one, sort it by the order column again.
 *
 * True sequences are the exception and keep sorting by order ASC: exam questions
 * (paper order), and the association tabs inside a detail page (package contents,
 * course videos/books/materials, live-course folder contents). Those are ordered
 * contents, not browsable lists.
 *
 * ── 2. CLIENT / CATALOG: the order column still rules ────────────────────────
 *
 * Every client-facing query keeps sorting `order ASC`, so curated ordering is
 * intact everywhere the customer looks. That is the ONLY consumer the order
 * column now has, and what `nextOrder` below is for.
 *
 * ── nextOrder: previous row + 1 ──────────────────────────────────────────────
 *
 * A row created without an explicit Order takes `(order of the PREVIOUS row) + 1`
 * — "previous" meaning the most recently created row in the list it joins, found
 * with `findFirst({ orderBy: [{ created_at: desc }, { id: desc }] })` and scoped
 * the same way the list is (same parent / category / series / banner key). An
 * empty list yields 1.
 *
 * Chosen deliberately (2026-07-29) over `MAX(order) + 1`. KNOWN CONSEQUENCE: the
 * value is NOT guaranteed unique and NOT guaranteed to be last. If the previous
 * row was itself given a low or negative order — e.g. by the superseded
 * `MIN - 1` model, whose leftovers still sit in several tables — the new row can
 * collide with an existing one, and rows that tie have no defined relative order
 * in the client's `order ASC` list. An admin can always type an explicit Order,
 * or drag-reorder, to resolve a collision.
 *
 * Callers pass the previous row's order (`null` when the list is empty).
 */
export const nextOrder = (currentMax: number | null | undefined): number =>
  (currentMax ?? 0) + 1;
