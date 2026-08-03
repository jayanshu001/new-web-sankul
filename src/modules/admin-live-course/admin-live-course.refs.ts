/**
 * Category-ref normalization for live courses. Kept in its own file (like
 * customer-profile.name) so the backfill script can import it without dragging
 * in the service's heavy deps (exceljs / redis / streamos).
 */

/**
 * Normalize the `materialCategories` payload/JSON into pivot rows for
 * ws_material_category_live_course.
 *
 * The SQL create/update schema passes this field through as `z.any()[]` (it
 * mirrors the Mongo shape `[{ category, order }]`), and multipart submissions
 * may deliver it JSON-stringified. Tolerate every id-carrying shape the admin
 * dashboard has ever sent — the same leniency admin/course's `parseRefs` has —
 * so a valid attachment can't silently fail to reach the entitlement pivot.
 * Duplicates collapse (the pivot is unique per course+category).
 */
export const parseMaterialCategoryRefs = (raw: any): Array<{ categoryId: number; order: number }> => {
  let items = raw;
  if (typeof items === "string") { try { items = JSON.parse(items); } catch { return []; } }
  if (!Array.isArray(items)) return [];
  const seen = new Set<number>();
  const out: Array<{ categoryId: number; order: number }> = [];
  items.forEach((i: any, idx: number) => {
    const rawId = i != null && typeof i === "object" ? (i.category ?? i.categoryId ?? i._id ?? i.id) : i;
    const categoryId = Number(rawId);
    if (!Number.isInteger(categoryId) || categoryId <= 0 || seen.has(categoryId)) return;
    seen.add(categoryId);
    out.push({ categoryId, order: Number(i?.order) || idx });
  });
  return out;
};
