// Admin live courses: material-category ref parsing for the entitlement pivot.
// Kept in its own file so the backfill script can import it without the service's
// heavy deps (exceljs / redis / streamos).

/**
 * Normalize the `materialCategories` payload/JSON into ws_material_category_live_course
 * pivot rows. Accepts every id-carrying shape the admin dashboard has sent (including
 * JSON-stringified multipart values), like admin/course's `parseRefs`, so a valid
 * attachment never silently misses the entitlement pivot. Duplicates collapse.
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
