// List ordering: admin vs client sort rules and the next-order helper.
/**
 * List ordering rules.
 *
 * Admin list screens: every top-level admin list sorts `created_at DESC, id DESC`
 * when the request asks for the order column or sends no sort; `sort_dir` is
 * ignored there because "newest on top" is the requirement and the UI sends `asc`.
 * Other `sort_by` values sort by their own column. Manual reordering is therefore
 * invisible on admin screens by design. True sequences keep `order ASC`: exam
 * questions and the association tabs inside a detail page (package contents,
 * course videos/books/materials, live-course folder contents).
 *
 * Client/catalog: every client query sorts `order ASC`; that is the only consumer
 * of the order column.
 *
 * nextOrder: a row created without an explicit Order takes the order of the most
 * recently created row in the list it joins (`findFirst` by `created_at desc, id
 * desc`, scoped like the list) + 1; an empty list yields 1. This is deliberately
 * not `MAX(order) + 1`, so the value is neither unique nor guaranteed last (legacy
 * low/negative orders can cause collisions; admins resolve by explicit Order or
 * drag-reorder). Exceptions passing the table-wide MAX(order) instead, so new rows
 * are always last: exams, videos, materials and their categories.
 *
 * Callers pass the previous row's order (`null` when the list is empty).
 */
export const nextOrder = (currentMax: number | null | undefined): number =>
  (currentMax ?? 0) + 1;
