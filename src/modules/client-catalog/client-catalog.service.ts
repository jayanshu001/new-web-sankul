/**
 * Client catalog tabs (videos / materials / tests) — SQL branch for
 *   GET /client/catalog/:type/:id/{videos,materials,tests}
 * Gated behind `isMysqlModule("client-catalog")`.
 *
 * Supports type = course | package (both have SQL category linkage). type =
 * live-course STAYS Mongo — ws_video_category has no live_course_id column and
 * LiveCourse has no material/exam category pivots in SQL (Wave-6 documented
 * drift), so the controller only takes the SQL branch for course/package.
 *
 * Root resolution:
 *  - videos: course → videoCategoryId (one group); package → specificSubjects[]
 *    (ws_package_specific_subject.subjectId)
 *  - materials/tests: course → ws_material_category_course / ws_exam_category_course;
 *    package → ws_material_category_package / ws_exam_category_package
 * Subtree counts via recursive CTE (parent col: ws_material_category=`parent`,
 * ws_exam_category=`parent_id`, ws_video via the catalog-category-tree DAG).
 * Exam.status is Boolean → Mongo status:PUBLISHED collapses to status=true.
 */
import { isMysqlModule } from "../../config/migration";
import { prisma } from "../../config/prisma";
import { defaultListingQualities } from "../../utils/videoQualities";

export const CLIENT_CATALOG_MODULE = "client-catalog";
export const isClientCatalogMysql = (): boolean => isMysqlModule(CLIENT_CATALOG_MODULE);

export const parseCatId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const descendantIds = async (table: string, parentCol: string, rootId: number): Promise<number[]> => {
  const rows = await prisma.$queryRawUnsafe<{ id: number }[]>(
    `WITH RECURSIVE tree (id) AS (SELECT ${rootId} UNION SELECT c.id FROM ${table} c JOIN tree t ON c.${parentCol} = t.id) SELECT id FROM tree`
  );
  return rows.map((r) => Number(r.id));
};

// ── parent existence ──────────────────────────────────────────────────────────
export const loadParent = async (type: "course" | "package", id: number): Promise<{ name: string } | null> => {
  if (type === "course") {
    const c = await prisma.course.findFirst({ where: { id }, select: { name: true } });
    return c ? { name: c.name ?? "" } : null;
  }
  const p = await prisma.package.findFirst({ where: { id, active: true }, select: { name: true } });
  return p ? { name: p.name } : null;
};

// ── VIDEOS ──────────────────────────────────────────────────────────────────
export const catalogVideos = async (opts: {
  type: "course" | "package"; id: number; customerId: number | null; search: string | null; categoryIds: number[] | null;
}) => {
  // Resolve the root video categories for the product.
  let roots: { id: number; title: string | null; image: string | null }[] = [];
  if (opts.type === "course") {
    const c = await prisma.course.findFirst({ where: { id: opts.id }, select: { videoCategoryId: true } });
    if (c?.videoCategoryId) {
      const vc = await prisma.videoCategory.findFirst({ where: { id: c.videoCategoryId, status: true }, select: { id: true, title: true, image: true } });
      if (vc) roots = [vc];
    }
  } else {
    const subs = await prisma.packageSpecificSubject.findMany({ where: { packageId: opts.id, status: true }, select: { subjectId: true, order_by: true }, orderBy: { order_by: "asc" } });
    const subIds = subs.map((s) => s.subjectId).filter((n): n is number => n != null);
    if (subIds.length) {
      const cats = await prisma.videoCategory.findMany({ where: { id: { in: subIds }, status: true }, select: { id: true, title: true, image: true } });
      const byId = new Map(cats.map((c) => [c.id, c]));
      roots = subIds.map((sid) => byId.get(sid)).filter(Boolean) as any[];
    }
  }

  const availableCategories = roots.map((c) => ({ _id: String(c.id), title: c.title }));
  let selected = roots;
  if (opts.categoryIds) { const allow = new Set(opts.categoryIds); selected = roots.filter((c) => allow.has(c.id)); }

  const { descendantsOf } = await import("../catalog-category-tree/category-tree.service");
  const list = await Promise.all(selected.map(async (cat) => {
    const subtree = await descendantsOf([cat.id]);
    const videoWhere: any = { videoCategoryId: cat.id, status: true };
    if (opts.search) videoWhere.title = { contains: opts.search };
    const [count, videos, childCount] = await Promise.all([
      prisma.video.count({ where: { videoCategoryId: { in: subtree }, status: true } }),
      prisma.video.findMany({ where: videoWhere, orderBy: { order: "asc" } }),
      prisma.videoCategoryRelation.count({ where: { parent: cat.id } }),
    ]);
    let progByVideo = new Map<number, any>();
    if (opts.customerId && videos.length) {
      const rows = await prisma.lectureProgress.findMany({ where: { customerId: opts.customerId, videoId: { in: videos.map((v) => v.id) } }, select: { videoId: true, positionSec: true, durationSec: true, completed: true, completedAt: true, lastWatchedAt: true } });
      progByVideo = new Map(rows.map((r) => [r.videoId!, r]));
    }
    const videoList = videos.map((v) => {
      const p = progByVideo.get(v.id);
      return {
        _id: String(v.id), title: v.title ?? "", topic: v.topic ?? "", platform: v.platform, priceType: v.priceType, order: v.order,
        youtube_id: v.youtube_id ?? null, aws_id: v.aws_id ?? null, vimeo_id: v.vimeo_id ?? null,
        recordings: [], qualities: defaultListingQualities(),
        progress: p ? { positionSec: p.positionSec ?? 0, durationSec: p.durationSec ?? 0, completed: !!p.completed, completedAt: p.completedAt ?? null, lastWatchedAt: p.lastWatchedAt ?? null } : null,
      };
    });
    return { category: { _id: String(cat.id), title: cat.title, image: cat.image, havingChildDirectory: childCount > 0, count }, list: videoList, _subtree: subtree };
  }));

  const union = [...new Set(list.flatMap((g) => g._subtree))];
  const totalItems = union.length ? await prisma.video.count({ where: { videoCategoryId: { in: union }, status: true } }) : 0;
  const responseList = list.map(({ _subtree, ...rest }) => rest);
  return { list: responseList, availableCategories, totals: { categories: responseList.length, items: totalItems } };
};

// ── MATERIALS ──────────────────────────────────────────────────────────────
export const catalogMaterials = async (opts: { type: "course" | "package"; id: number; search: string | null }) => {
  const refs = opts.type === "course"
    ? await prisma.materialCategoryCourse.findMany({ where: { courseId: opts.id }, orderBy: { order: "asc" } })
    : await prisma.materialCategoryPackage.findMany({ where: { packageId: opts.id }, orderBy: { order: "asc" } });
  const catIds = refs.map((r) => r.materialCategoryId).filter((n): n is number => n != null);
  let cats = catIds.length ? await prisma.materialCategory.findMany({ where: { id: { in: catIds }, status: true } }) : [];
  const byId = new Map(cats.map((c) => [c.id, c]));
  let ordered = refs.map((r) => byId.get(r.materialCategoryId!)).filter(Boolean) as any[];
  if (opts.search) ordered = ordered.filter((c) => (c.title ?? "").toLowerCase().includes(opts.search!.toLowerCase()));

  const list = await Promise.all(ordered.map(async (cat) => {
    const ids = await descendantIds("ws_material_category", "parent", cat.id);
    const [count, childCount] = await Promise.all([
      prisma.material.count({ where: { materialCategoryId: { in: ids }, status: true } }),
      prisma.materialCategory.count({ where: { parent: cat.id, status: true } }),
    ]);
    return { category: { _id: String(cat.id), title: cat.title, image: cat.image, havingChildDirectory: childCount > 0, count } };
  }));
  return { list, totals: { categories: list.length, items: list.reduce((n, g) => n + g.category.count, 0) } };
};

// ── TESTS ──────────────────────────────────────────────────────────────────
export const catalogTests = async (opts: { type: "course" | "package"; id: number; search: string | null }) => {
  const refs = opts.type === "course"
    ? await prisma.examCategoryCourse.findMany({ where: { courseId: opts.id }, orderBy: { order: "asc" } })
    : await prisma.examCategoryPackage.findMany({ where: { packageId: opts.id }, orderBy: { order: "asc" } });
  const catIds = refs.map((r) => r.examCategoryId).filter((n): n is number => n != null);
  let cats = catIds.length ? await prisma.examCategory.findMany({ where: { id: { in: catIds }, status: true } }) : [];
  const byId = new Map(cats.map((c) => [c.id, c]));
  let ordered = refs.map((r) => byId.get(r.examCategoryId!)).filter(Boolean) as any[];
  if (opts.search) ordered = ordered.filter((c) => (c.name ?? "").toLowerCase().includes(opts.search!.toLowerCase()));

  const list = await Promise.all(ordered.map(async (cat) => {
    const ids = await descendantIds("ws_exam_category", "parent_id", cat.id);
    const [count, childCount] = await Promise.all([
      // Mongo filtered status:PUBLISHED + non-ended window; SQL Exam.status is Boolean → status=true.
      prisma.exam.count({ where: { examCategoryId: { in: ids }, status: true } }),
      prisma.examCategory.count({ where: { parent: cat.id, status: true } }),
    ]);
    return { category: { _id: String(cat.id), title: cat.name, name: cat.name, image: cat.image, havingChildDirectory: childCount > 0, count } };
  }));
  return { list, totals: { categories: list.length, items: list.reduce((n, g) => n + g.category.count, 0) } };
};
