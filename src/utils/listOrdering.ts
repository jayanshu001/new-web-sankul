/**
 * Manual list ordering — "newest lands on top" without breaking drag-and-drop.
 *
 * The agreed model (2026-07-27): lists keep sorting by their manual order column
 * ASC, and a newly created row is assigned the TOP slot. That gives newest-first
 * by default while a manual reorder stays meaningful and permanent. Sorting the
 * list by created_at DESC instead would make reordering invisible — so the list
 * sorts must NOT be changed.
 *
 * The top slot is `MIN(existing order) - 1`, scoped to the list the row joins:
 * one cheap aggregate read, no mass update of sibling rows. Negative values sort
 * fine — the column is a plain signed INT and every consumer sorts, never
 * assumes a range or a 0-based sequence.
 *
 * Callers pass the current minimum (a repository `_min` aggregate, `null` when
 * the list is empty). An empty list yields -1, which is harmless: the next row
 * gets -2, and a later drag-and-drop rewrites the whole visible range anyway.
 */
export const topSlotOrder = (currentMin: number | null | undefined): number =>
  (currentMin ?? 0) - 1;
