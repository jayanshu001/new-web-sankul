import { prisma } from "../../config/prisma";

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
  subjList: (opts?: { search?: string; sortBy?: string; sortDir?: "asc" | "desc"; skip?: number; take?: number }) =>
    prisma.courseSubjectCategory.findMany({
      where: subjWhere(opts),
      orderBy: subjOrderBy(opts?.sortBy, opts?.sortDir ?? "asc"),
      ...(opts?.skip !== undefined ? { skip: opts.skip } : {}),
      ...(opts?.take !== undefined ? { take: opts.take } : {}),
    }),
  subjCount: (opts?: { search?: string }) => prisma.courseSubjectCategory.count({ where: subjWhere(opts) }),
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
    if (opts.search) where.OR = [{ title: { contains: opts.search.trim() } }, { slug: { contains: opts.search.trim() } }];
    if (opts.status !== undefined) where.status = opts.status;
    if (opts.educatorId !== undefined) where.educatorId = opts.educatorId;
    const col = opts.sortBy === "name" || opts.sortBy === "title" ? "title" : opts.sortBy === "order" ? "order_by" : opts.sortBy === "updatedAt" ? "updated_at" : "created_at";
    return prisma.videoCategory.findMany({ where, orderBy: { [col]: opts.sortDir }, skip: opts.skip, take: opts.take });
  },
  vcCountFiltered: (opts: { search?: string; status?: boolean; educatorId?: number }) => {
    const where: any = {};
    if (opts.search) where.OR = [{ title: { contains: opts.search.trim() } }, { slug: { contains: opts.search.trim() } }];
    if (opts.status !== undefined) where.status = opts.status;
    if (opts.educatorId !== undefined) where.educatorId = opts.educatorId;
    return prisma.videoCategory.count({ where });
  },
  vcChildren: (parentId: number) =>
    prisma.videoCategory.findMany({ where: { parent: parentId }, select: { id: true, title: true, slug: true, status: true, order_by: true }, orderBy: { order_by: "asc" } }),
  // Existing ids among the given set — used to validate childCategoryIds before binding.
  vcExistingIds: (ids: number[]) =>
    prisma.videoCategory.findMany({ where: { id: { in: ids } }, select: { id: true } }),
  // Re-parent the given categories (parent = 0 detaches to root). Children of a
  // category are derived from this self-FK, so this is how childCategoryIds binds.
  vcSetParent: (childIds: number[], parent: number) =>
    prisma.videoCategory.updateMany({ where: { id: { in: childIds } }, data: { parent, updated_at: new Date() } }),
  vcSlugTaken: (slug: string, exceptId?: number) =>
    prisma.videoCategory.findFirst({ where: { slug, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } }),
  educator: (id: number) => prisma.courseEducator.findUnique({ where: { id }, select: { id: true, name: true } }),
  listActiveEducators: () => prisma.courseEducator.findMany({ where: { status: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  listAllCategoriesBrief: () => prisma.videoCategory.findMany({ select: { id: true, title: true }, orderBy: { title: "asc" } }),

  // relation lists
  coursesForCategory: (categoryId: number, opts: { search?: string; status?: boolean; skip: number; take: number }) => {
    const where: any = { videoCategoryId: categoryId };
    if (opts.search) where.name = { contains: opts.search.trim() };
    if (opts.status !== undefined) where.status = opts.status;
    return prisma.course.findMany({ where, select: { id: true, name: true, status: true, ordered: true }, orderBy: { ordered: "asc" }, skip: opts.skip, take: opts.take });
  },
  countCoursesForCategory: (categoryId: number, opts: { search?: string; status?: boolean }) => {
    const where: any = { videoCategoryId: categoryId };
    if (opts.search) where.name = { contains: opts.search.trim() };
    if (opts.status !== undefined) where.status = opts.status;
    return prisma.course.count({ where });
  },
  videosForCategory: (categoryId: number, opts: { search?: string; status?: boolean; platform?: string; skip: number; take: number }) => {
    const where: any = { videoCategoryId: categoryId };
    if (opts.search) where.OR = [{ title: { contains: opts.search.trim() } }, { slug: { contains: opts.search.trim() } }, { topic: { contains: opts.search.trim() } }];
    if (opts.status !== undefined) where.status = opts.status;
    if (opts.platform) where.platform = opts.platform;
    return prisma.video.findMany({ where, select: { id: true, title: true, slug: true, status: true, order: true, platform: true }, orderBy: { order: "asc" }, skip: opts.skip, take: opts.take });
  },
  countVideosForCategory: (categoryId: number, opts: { search?: string; status?: boolean; platform?: string }) => {
    const where: any = { videoCategoryId: categoryId };
    if (opts.search) where.OR = [{ title: { contains: opts.search.trim() } }, { slug: { contains: opts.search.trim() } }, { topic: { contains: opts.search.trim() } }];
    if (opts.status !== undefined) where.status = opts.status;
    if (opts.platform) where.platform = opts.platform;
    return prisma.video.count({ where });
  },
  videoInCategory: (categoryId: number) => prisma.video.findFirst({ where: { videoCategoryId: categoryId }, select: { id: true } }),
  hasChildren: (categoryId: number) => prisma.videoCategory.findFirst({ where: { parent: categoryId }, select: { id: true } }),

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

function subjWhere(opts?: { search?: string }) {
  const where: any = {};
  if (opts?.search) where.title = { contains: opts.search.trim() };
  return where;
}

function subjOrderBy(sortBy: string | undefined, dir: "asc" | "desc"): any[] {
  const col = sortBy === "title" ? "title" : sortBy === "createdAt" ? "createdAt" : "order";
  return [{ [col]: dir }, { id: "asc" }];
}
