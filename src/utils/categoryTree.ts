// Shared traversal for nested content-category folders.
//
// Video / Material / Exam categories can nest other folders via
// `childCategoryIds`. Content (videos/materials/exams) is attached to leaf
// categories, so any per-folder count must include everything reachable beneath
// it, not just its own direct items. This walks the tree breadth-first off an
// already-loaded root, batching each level and guarding against cycles, and
// returns the root id plus every descendant id — ready to drop into a
// `{ $in: ids }` count query.
//
// Used by the package detail and catalog tab endpoints so the rolled-up count
// rule stays identical everywhere.

interface CategoryNode {
  _id: any;
  childCategoryIds?: any[];
}

type CategoryModel = {
  find: (filter: any) => {
    select: (fields: string) => { lean: () => Promise<CategoryNode[]> };
  };
};

export async function collectCategoryTreeIds(
  model: CategoryModel,
  root: CategoryNode
): Promise<any[]> {
  const all: any[] = [root._id];
  const visited = new Set<string>([String(root._id)]);
  let frontier: any[] = (root.childCategoryIds ?? []).filter(
    (id: any) => !visited.has(String(id))
  );

  while (frontier.length) {
    frontier.forEach((id) => visited.add(String(id)));
    const docs = await model.find({ _id: { $in: frontier } }).select("_id childCategoryIds").lean();
    all.push(...frontier);

    const next: any[] = [];
    for (const d of docs) {
      for (const childId of d.childCategoryIds ?? []) {
        if (!visited.has(String(childId))) next.push(childId);
      }
    }
    frontier = next;
  }
  return all;
}
