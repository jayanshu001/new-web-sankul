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
  subjList: () => prisma.courseSubjectCategory.findMany({ orderBy: { order: "asc" } }),
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
};
