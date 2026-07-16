import { prisma } from "../../config/prisma";
import { childIdsOf, loadAllEdges, primaryParentsOf } from "../../utils/videoCategoryRelation";
import { buildPrismaSearch } from "../../utils/searchFilter";

/**
 * Prisma persistence for the admin "master" sub-catalog CRUD (small lookup
 * tables). Each is a thin CRUD on one table:
 *   - PackageCourseMaterial → ws_package_course_material (id, title only)
 *   - CourseSubjectCategory → ws_course_subject_category (title, slug, image, parent, order_by, status)
 *   - VideoCategory         → ws_video_category (title, slug, image, pdf, educator_id, parent, order_by, status)
 *
 * ⚠ ws_package_category does NOT exist in SQL → master/packageCategory stays Mongo.
 */
export const adminMasterRepository = {
  // ── PackageCourseMaterial (pc-material + master/material share this table) ──
  pcmList: () => prisma.packageCourseMaterial.findMany({ orderBy: { id: "desc" } }),
  pcmFind: (id: number) => prisma.packageCourseMaterial.findUnique({ where: { id } }),
  pcmCreate: (title: string) =>
    prisma.packageCourseMaterial.create({ data: { title, created_at: new Date(), updated_at: new Date() } }),
  pcmUpdate: (id: number, title: string) =>
    prisma.packageCourseMaterial.update({ where: { id }, data: { title, updated_at: new Date() } }),
  pcmDelete: (id: number) => prisma.packageCourseMaterial.delete({ where: { id } }),

  // ── CourseSubjectCategory ───────────────────────────────────────────────────
  // Optional search (title) + sort + pagination. skip/take omitted → full list.
  subjList: (opts?: { search?: string; status?: boolean; sortBy?: string; sortDir?: "asc" | "desc"; skip?: number; take?: number }) =>
    prisma.courseSubjectCategory.findMany({
      where: subjWhere(opts),
      orderBy: subjOrderBy(opts?.sortBy, opts?.sortDir ?? "asc"),
      ...(opts?.skip !== undefined ? { skip: opts.skip } : {}),
      ...(opts?.take !== undefined ? { take: opts.take } : {}),
    }),
  subjCount: (opts?: { search?: string; status?: boolean }) => prisma.courseSubjectCategory.count({ where: subjWhere(opts) }),
  subjFind: (id: number) => prisma.courseSubjectCategory.findUnique({ where: { id } }),
  subjCreate: (data: { title: string; slug: string; image: string; parent: number; order: number; status: boolean }) =>
    prisma.courseSubjectCategory.create({ data: { ...data, createdAt: new Date(), updatedAt: new Date() } }),
  subjUpdate: (id: number, data: Record<string, unknown>) =>
    prisma.courseSubjectCategory.update({ where: { id }, data: { ...data, updatedAt: new Date() } }),
  subjDelete: (id: number) => prisma.courseSubjectCategory.delete({ where: { id } }),

  // ── VideoCategory ────────────────────────────────────────────────────────────
  vcList: () => prisma.videoCategory.findMany({ orderBy: { order_by: "asc" } }),
  vcFind: (id: number) => prisma.videoCategory.findUnique({ where: { id } }),
  vcCreate: (data: { title: string; slug: string; image: string; parent: number; order_by: number; status: boolean; educatorId?: number | null; pdf?: string | null }) =>
    prisma.videoCategory.create({ data: { ...data, created_at: new Date(), updated_at: new Date() } }),
  vcUpdate: (id: number, data: Record<string, unknown>) =>
    prisma.videoCategory.update({ where: { id }, data: { ...data, updated_at: new Date() } }),
  vcDelete: (id: number) => prisma.videoCategory.delete({ where: { id } }),
  // Remove every ws_video_category_relation edge that references this category on
  // either side (parent → child DAG). Deleting a category without this leaves
  // dangling edges that later inflate havingChildDirectory / child counts.
  vcDeleteRelations: (id: number) =>
    prisma.videoCategoryRelation.deleteMany({ where: { OR: [{ parent: id }, { child: id }] } }),

  // ── full videoCategory controller support (admin/videoCategory) ─────────────
  vcListFiltered: (opts: { search?: string; status?: boolean; educatorId?: number; sortBy: string; sortDir: "asc" | "desc"; skip: number; take: number }) => {
    const where: any = {};
    const search = buildPrismaSearch(opts.search, ["title", "slug"]);
    if (search) Object.assign(where, search);
    if (opts.status !== undefined) where.status = opts.status;
    if (opts.educatorId !== undefined) where.educatorId = opts.educatorId;
    const col = opts.sortBy === "name" || opts.sortBy === "title" ? "title" : opts.sortBy === "order" ? "order_by" : opts.sortBy === "updatedAt" ? "updated_at" : "created_at";
    return prisma.videoCategory.findMany({ where, orderBy: { [col]: opts.sortDir }, skip: opts.skip, take: opts.take });
  },
  vcCountFiltered: (opts: { search?: string; status?: boolean; educatorId?: number }) => {
    const where: any = {};
    const search = buildPrismaSearch(opts.search, ["title", "slug"]);
    if (search) Object.assign(where, search);
    if (opts.status !== undefined) where.status = opts.status;
    if (opts.educatorId !== undefined) where.educatorId = opts.educatorId;
    return prisma.videoCategory.count({ where });
  },
  // Direct children of a category, sourced from ws_video_category_relation (the DAG
  // edge table), re-ordered by the child category's own order_by for a stable list.
  vcChildren: async (parentId: number) => {
    const childIds = await childIdsOf(parentId);
    if (!childIds.length) return [];
    return prisma.videoCategory.findMany({
      where: { id: { in: childIds } },
      select: { id: true, title: true, slug: true, status: true, order_by: true },
      orderBy: { order_by: "asc" },
    });
  },
  // Every parent→child edge (whole DAG) for in-memory tree builds (vcList).
  vcAllEdges: () => loadAllEdges(),
  // Batched `child → primary parent` map from the relation DAG (deterministic single parent).
  vcPrimaryParents: (ids: number[]) => primaryParentsOf(ids),
  // Batched {id, name, parent} loader for ancestor-chain resolution (title→name; one
  // query per tree level). Parent is resolved from ws_video_category_relation.
  vcCategoriesByIds: async (ids: number[]) => {
    if (!ids.length) return [];
    const [cats, parents] = await Promise.all([
      prisma.videoCategory.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } }),
      primaryParentsOf(ids),
    ]);
    return cats.map((r) => ({ id: r.id, name: r.title, parent: parents.get(r.id) ?? null }));
  },
  // Existing ids among the given set — used to validate childCategoryIds before binding.
  vcExistingIds: (ids: number[]) =>
    prisma.videoCategory.findMany({ where: { id: { in: ids } }, select: { id: true } }),
  // Re-parent the given categories (parent = 0 detaches to root). Writes BOTH the
  // self-FK (ws_video_category.parent) AND the ws_video_category_relation pivot the
  // client catalog reads — kept in sync so havingChildDirectory / drill-in / counts
  // are correct. Edge ids are PRESERVED across a move (update-in-place) because
  // package composition (ws_video_category_package_relation) references them; a
  // delete+recreate would silently drop subjects from packages.
  vcSetParent: (childIds: number[], parent: number) =>
    prisma.$transaction(async (tx) => {
      // Snapshot each child's CURRENT parent + order BEFORE the self-FK flips, so we
      // know which existing edge to move/remove.
      const kids = await tx.videoCategory.findMany({
        where: { id: { in: childIds } },
        select: { id: true, parent: true, order_by: true },
      });
      await tx.videoCategory.updateMany({ where: { id: { in: childIds } }, data: { parent, updated_at: new Date() } });
      for (const k of kids) {
        const oldParent = k.parent ?? 0;
        if (parent > 0) {
          // Already linked to the new parent? nothing to do (idempotent).
          const existingNew = await tx.videoCategoryRelation.findFirst({ where: { parent, child: k.id }, select: { id: true } });
          if (existingNew) continue;
          // Move the child's existing single-parent edge in place (keep its id), else
          // create a fresh edge (brand-new link → nothing references it yet).
          const oldEdge = oldParent > 0
            ? await tx.videoCategoryRelation.findFirst({ where: { parent: oldParent, child: k.id }, select: { id: true } })
            : null;
          if (oldEdge) {
            await tx.videoCategoryRelation.update({ where: { id: oldEdge.id }, data: { parent } });
          } else {
            await tx.videoCategoryRelation.create({ data: { parent, child: k.id, order: k.order_by ?? 0 } });
          }
        } else if (oldParent > 0) {
          // Detach to root: remove only THIS child's edge under its former parent.
          await tx.videoCategoryRelation.deleteMany({ where: { parent: oldParent, child: k.id } });
        }
      }
    }),
  // Ensure a (parent → child) pivot edge exists (insert if absent). Used when a
  // category is CREATED with a parent — the row is brand-new so a plain insert is
  // safe. No-op for root (parent = 0).
  vcEnsureEdge: async (parent: number, child: number, order: number): Promise<void> => {
    if (!parent || parent <= 0) return;
    const existing = await prisma.videoCategoryRelation.findFirst({ where: { parent, child }, select: { id: true } });
    if (!existing) await prisma.videoCategoryRelation.create({ data: { parent, child, order: order ?? 0 } });
  },
  vcSlugTaken: (slug: string, exceptId?: number) =>
    prisma.videoCategory.findFirst({ where: { slug, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } }),
  educator: (id: number) => prisma.courseEducator.findUnique({ where: { id }, select: { id: true, name: true } }),
  listActiveEducators: () => prisma.courseEducator.findMany({ where: { status: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  listAllCategoriesBrief: () => prisma.videoCategory.findMany({ select: { id: true, title: true }, orderBy: { title: "asc" } }),

  // relation lists
  coursesForCategory: (categoryId: number, opts: { search?: string; status?: boolean; skip: number; take: number }) => {
    const where: any = { videoCategoryId: categoryId };
    const search = buildPrismaSearch(opts.search, ["name"]);
    if (search) Object.assign(where, search);
    if (opts.status !== undefined) where.status = opts.status;
    return prisma.course.findMany({ where, select: { id: true, name: true, status: true, ordered: true }, orderBy: { ordered: "asc" }, skip: opts.skip, take: opts.take });
  },
  countCoursesForCategory: (categoryId: number, opts: { search?: string; status?: boolean }) => {
    const where: any = { videoCategoryId: categoryId };
    const search = buildPrismaSearch(opts.search, ["name"]);
    if (search) Object.assign(where, search);
    if (opts.status !== undefined) where.status = opts.status;
    return prisma.course.count({ where });
  },
  videosForCategory: (categoryId: number, opts: { search?: string; status?: boolean; platform?: string; skip: number; take: number }) => {
    const where: any = { videoCategoryId: categoryId };
    const search = buildPrismaSearch(opts.search, ["title", "slug", "topic"]);
    if (search) Object.assign(where, search);
    if (opts.status !== undefined) where.status = opts.status;
    if (opts.platform) where.platform = opts.platform;
    return prisma.video.findMany({ where, select: { id: true, title: true, slug: true, status: true, order: true, platform: true }, orderBy: { order: "asc" }, skip: opts.skip, take: opts.take });
  },
  countVideosForCategory: (categoryId: number, opts: { search?: string; status?: boolean; platform?: string }) => {
    const where: any = { videoCategoryId: categoryId };
    const search = buildPrismaSearch(opts.search, ["title", "slug", "topic"]);
    if (search) Object.assign(where, search);
    if (opts.status !== undefined) where.status = opts.status;
    if (opts.platform) where.platform = opts.platform;
    return prisma.video.count({ where });
  },
  videoInCategory: (categoryId: number) => prisma.video.findFirst({ where: { videoCategoryId: categoryId }, select: { id: true } }),
  // A category "has children" when it is the parent of ≥1 ws_video_category_relation edge.
  hasChildren: (categoryId: number) => prisma.videoCategoryRelation.findFirst({ where: { parent: categoryId }, select: { id: true } }),

  // ── duplicate (clone a category + its sub-tree + videos) ────────────────────
  // The Mongo source modelled a childCategoryIds[] DAG; SQL models a single-parent
  // tree via the `parent` self-FK, so we clone along that tree. Runs in one
  // transaction: collect source + descendants, create clones (create() one-by-one
  // so new ids are returned — createMany does NOT), remap `parent`, then clone the
  // videos whose category is in the cloned set (remapping vcategory_id). Returns
  // null when the source id doesn't exist.
  vcDuplicate: (sourceId: number) =>
    prisma.$transaction(async (tx) => {
      const source = await tx.videoCategory.findUnique({ where: { id: sourceId } });
      if (!source) return null;

      // BFS the parent-tree, collecting every node once (guards against cycles).
      // Traversal reads the `parent` column (still written in sync by vcSetParent /
      // vcCreate) rather than the relation edges: this is a WRITE path cloning a
      // single-parent tree, and the in-sync column is equivalent while keeping the
      // transactional clone logic (parent remap + edge creation below) unchanged.
      const nodesById = new Map<number, any>();
      nodesById.set(source.id, source);
      const queue: number[] = [source.id];
      while (queue.length) {
        const cur = queue.shift()!;
        const children = await tx.videoCategory.findMany({ where: { parent: cur } });
        for (const ch of children) {
          if (nodesById.has(ch.id)) continue;
          nodesById.set(ch.id, ch);
          queue.push(ch.id);
        }
      }

      const rootTitle = await nextUnassignedTitle(tx, source.title);
      const idMap = new Map<number, number>();

      // Pass 1: create clones (parent temporarily 0 so all ids exist for rewiring).
      for (const [oldId, node] of nodesById) {
        const isRoot = oldId === source.id;
        const title = isRoot ? rootTitle : node.title;
        const slug = await uniqueSlugTx(tx, slugify(title));
        const created = await tx.videoCategory.create({
          data: {
            title,
            slug,
            image: node.image,
            pdf: node.pdf ?? null,
            parent: 0,
            educatorId: 0,
            liveCourseId: null,
            order_by: node.order_by ?? 0,
            status: node.status ?? true,
            created_at: new Date(),
            updated_at: new Date(),
          },
        });
        idMap.set(oldId, created.id);
      }
      const rootId = idMap.get(source.id)!;

      // Pass 2: rewire each descendant clone's parent to the new id (root stays 0).
      let subCategories = 0;
      for (const [oldId, node] of nodesById) {
        if (oldId === source.id) continue;
        subCategories += 1;
        const newId = idMap.get(oldId)!;
        const newParent = node.parent != null ? idMap.get(node.parent) ?? 0 : 0;
        await tx.videoCategory.update({ where: { id: newId }, data: { parent: newParent, updated_at: new Date() } });
        // Mirror the clone's parent link into the pivot the client reads (both are
        // brand-new rows, so a plain insert can't affect any existing package link).
        if (newParent > 0) {
          await tx.videoCategoryRelation.create({ data: { parent: newParent, child: newId, order: node.order_by ?? 0 } });
        }
      }

      // Clone videos across all mapped categories, remapping vcategory_id.
      const oldIds = Array.from(nodesById.keys());
      const videos = await tx.video.findMany({ where: { videoCategoryId: { in: oldIds } } });
      for (const v of videos) {
        await tx.video.create({
          data: {
            videoCategoryId: idMap.get(v.videoCategoryId!)!,
            liveSessionId: null,
            title: v.title,
            topic: v.topic,
            slug: v.slug,
            platform: v.platform,
            priceType: v.priceType,
            youtube_id: v.youtube_id,
            aws_id: v.aws_id,
            vimeo_id: v.vimeo_id,
            order: v.order ?? 0,
            status: v.status ?? true,
            created_at: new Date(),
            updated_at: new Date(),
          },
        });
      }

      return { rootId, rootTitle, subCategories, videos: videos.length };
    }),
};

// ── duplicate helpers (ported from the Mongo controller) ──────────────────────
const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Next unclaimed "<title> (Copy)" / "<title> (Copy N)" title among unassigned
// (no live course) categories — mirrors the Mongo `courseId:null,liveCourseId:null`
// filter as closely as the SQL schema allows (no courseId column on the category).
async function nextUnassignedTitle(tx: any, baseTitle: string): Promise<string> {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const base = `${baseTitle} (Copy`;
  const regex = new RegExp(`^${escape(base)}(?:\\s(\\d+))?\\)$`);
  const existing = await tx.videoCategory.findMany({
    where: { liveCourseId: null, title: { startsWith: base } },
    select: { title: true },
  });
  const taken = new Set<number>();
  for (const e of existing) {
    const m = (e.title || "").match(regex);
    if (!m) continue;
    taken.add(m[1] ? parseInt(m[1], 10) : 1);
  }
  if (!taken.has(1)) return `${baseTitle} (Copy)`;
  let n = 2;
  while (taken.has(n)) n++;
  return `${baseTitle} (Copy ${n})`;
}

async function uniqueSlugTx(tx: any, base: string): Promise<string> {
  let candidate = base || "category";
  let n = 1;
  while (await tx.videoCategory.findFirst({ where: { slug: candidate }, select: { id: true } })) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  return candidate;
}

function subjWhere(opts?: { search?: string; status?: boolean }) {
  const where: any = {};
  const search = buildPrismaSearch(opts?.search, ["title"]);
  if (search) Object.assign(where, search);
  if (opts?.status !== undefined) where.status = opts.status;
  return where;
}

function subjOrderBy(sortBy: string | undefined, dir: "asc" | "desc"): any[] {
  const col = sortBy === "title" ? "title" : sortBy === "createdAt" ? "createdAt" : "order";
  return [{ [col]: dir }, { id: "asc" }];
}
