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
import { prisma } from "../../config/prisma";
import { defaultListingQualities } from "../../utils/videoQualities";
import { signMediaToken } from "../../utils/mediaToken";
import { hasActiveCourseSub } from "../client-lecture/client-lecture.service";
import { getPurchasedMaterialIds, materialMediaToken } from "../client-material/client-material.service";
import { examInCategoriesWhere, subjectStartedWhere } from "../catalog-exam/exam-category-pivot.where";
import { buildPrismaSearch, matchesAllTokens } from "../../utils/searchFilter";

export const CLIENT_CATALOG_MODULE = "client-catalog";
export const isClientCatalogMysql = (): boolean => true;

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
export const loadParent = async (type: "course" | "package" | "live-course", id: number): Promise<{ name: string } | null> => {
  if (type === "course") {
    const c = await prisma.course.findFirst({ where: { id }, select: { name: true } });
    return c ? { name: c.name ?? "" } : null;
  }
  if (type === "live-course") {
    const lc = await prisma.liveCourse.findFirst({ where: { id, status: true }, select: { name: true } });
    return lc ? { name: lc.name } : null;
  }
  const p = await prisma.package.findFirst({ where: { id, active: true }, select: { name: true } });
  return p ? { name: p.name } : null;
};

// Live courses store their material/exam category refs as a JSON array on the
// live-course row (ws_live_course.material_categories / exam_categories), NOT in
// the course/package link tables. Each entry is either { category, order } or a
// bare id — extract the category ids tolerantly, preserving order.
const liveCourseCategoryIds = async (
  id: number,
  col: "materialCategories" | "examCategories"
): Promise<number[]> => {
  const lc = await prisma.liveCourse.findFirst({ where: { id, status: true }, select: { [col]: true } as any });
  const arr = Array.isArray((lc as any)?.[col]) ? ((lc as any)[col] as any[]) : [];
  const ids: number[] = [];
  for (const e of arr) {
    const raw = e && typeof e === "object" ? (e.category ?? e.materialCategoryId ?? e.examCategoryId ?? e.id ?? e._id) : e;
    const n = Number(raw);
    if (Number.isInteger(n) && n > 0) ids.push(n);
  }
  return [...new Set(ids)];
};

// ── VIDEOS ──────────────────────────────────────────────────────────────────
export const catalogVideos = async (opts: {
  type: "course" | "package" | "live-course"; id: number; customerId: number | null; search: string | null; categoryIds: number[] | null;
}) => {
  // Resolve the root video categories for the product.
  let roots: { id: number; title: string | null; image: string | null }[] = [];
  if (opts.type === "course") {
    const c = await prisma.course.findFirst({ where: { id: opts.id }, select: { videoCategoryId: true } });
    if (c?.videoCategoryId) {
      const vc = await prisma.videoCategory.findFirst({ where: { id: c.videoCategoryId, status: true }, select: { id: true, title: true, image: true } });
      if (vc) roots = [vc];
    }
  } else if (opts.type === "live-course") {
    // Live courses own their video-category folders directly via liveCourseId
    // (the recordings folders), unlike course/package single-root or subjects.
    roots = await prisma.videoCategory.findMany({
      where: { liveCourseId: opts.id, status: true },
      orderBy: [{ order_by: "asc" }, { created_at: "asc" }],
      select: { id: true, title: true, image: true },
    });
  } else {
    const subs = await prisma.packageSpecificSubject.findMany({ where: { packageId: opts.id, status: true }, select: { subjectId: true, order_by: true }, orderBy: [{ order_by: "asc" }, { created_at: "asc" }] });
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

  // Only `course` keeps the legacy inlined per-category video `list`. `package`
  // and `live-course` use the newer stripped shape (category + context-dependent
  // `count`, no inlined list) — they were never reverted.
  const inlineList = opts.type === "course";
  // Inline video list exists only for `course` — entitlement is a single
  // course-subscription check, computed once for the whole response.
  const courseEntitled = inlineList && opts.customerId ? await hasActiveCourseSub(opts.customerId, opts.id) : false;
  const { descendantsOf } = await import("../catalog-category-tree/category-tree.service");

  // `course` returns a FLAT, server-side-searchable video list (no category
  // grouping) — the FE renders a single scrolling list. Search filters titles at
  // the DB across the ENTIRE root subtree; the controller applies pagination on
  // this flat list. `package`/`live-course` keep the category-grouped shape below.
  if (opts.type === "course") {
    const root = roots[0];
    if (!root) return { list: [] };
    const subtree = await descendantsOf([root.id]);
    const videoWhere: any = { videoCategoryId: { in: subtree }, status: true };
    const flatSearch = buildPrismaSearch(opts.search, ["title"]);
    if (flatSearch) videoWhere.AND = flatSearch.AND;
    // Explicit `select`: ws_video is a wide legacy table (urls, descriptions,
    // per-quality columns) and this path can return every video in a course
    // subtree. Fetch only the seven fields the DTO below actually reads —
    // same rows, same order, a fraction of the bytes off the wire.
    const videos = await prisma.video.findMany({
      where: videoWhere,
      orderBy: [{ order: "asc" }, { created_at: "asc" }],
      select: { id: true, title: true, topic: true, platform: true, priceType: true, videoCategoryId: true, order: true },
    });
    let progByVideo = new Map<number, any>();
    if (opts.customerId && videos.length) {
      const rows = await prisma.lectureProgress.findMany({ where: { customerId: opts.customerId, videoId: { in: videos.map((v) => v.id) } }, select: { videoId: true, positionSec: true, durationSec: true, completed: true, completedAt: true, lastWatchedAt: true } });
      progByVideo = new Map(rows.map((r) => [r.videoId!, r]));
    }
    const flat = videos.map((v) => {
      const p = progByVideo.get(v.id);
      // Same media-token gating as the grouped course path: paid videos get a
      // token only when the course is purchased; free videos always get one.
      const isPaid = v.priceType === "paid";
      const canPlay = !isPaid || courseEntitled;
      const mediaToken =
        opts.customerId && canPlay
          ? isPaid
            ? signMediaToken({ k: "video", id: v.id, scope: { kind: "course", id: opts.id }, cust: opts.customerId })
            : signMediaToken({ k: "video", id: v.id, free: true, cust: opts.customerId })
          : null;
      return {
        _id: String(v.id), title: v.title ?? "", topic: v.topic ?? "", platform: v.platform, priceType: v.priceType, isPaid, isPurchased: canPlay, videoCategoryId: v.videoCategoryId != null ? String(v.videoCategoryId) : null, order: v.order,
        recordings: [], qualities: defaultListingQualities(),
        mediaToken,
        progress: p ? { positionSec: p.positionSec ?? 0, durationSec: p.durationSec ?? 0, completed: !!p.completed, completedAt: p.completedAt ?? null, lastWatchedAt: p.lastWatchedAt ?? null } : null,
      };
    });
    return { list: flat };
  }

  // Batched pre-pass. This block used to run INSIDE the per-category map below,
  // costing 3 queries per selected category (one recursive-CTE subtree walk + two
  // counts). A package with 30 subject categories issued 90 queries for a single
  // request, which is what saturated the Prisma pool under concurrency. It is now
  // 3 queries total, regardless of category count:
  //   1. every subtree in one recursive CTE (descendantsByRoot)
  //   2. one groupBy for active video counts across the union of all subtrees
  //   3. one groupBy for active child-edge counts across all selected categories
  const { descendantsByRoot } = await import("../catalog-category-tree/category-tree.service");
  const selectedIds = selected.map((c) => c.id);
  const subtreeByCat = await descendantsByRoot(selectedIds);
  const unionSubtree = [...new Set([...subtreeByCat.values()].flat())];

  const [videoCountRows, childCountRows] = await Promise.all([
    unionSubtree.length
      ? prisma.video.groupBy({
          by: ["videoCategoryId"],
          where: { videoCategoryId: { in: unionSubtree }, status: true },
          _count: { _all: true },
        })
      : Promise.resolve([] as any[]),
    // Only count edges whose child category still exists AND is active — dangling
    // edges (child row deleted) must not inflate havingChildDirectory / count.
    selectedIds.length
      ? prisma.videoCategoryRelation.groupBy({
          by: ["parent"],
          where: { parent: { in: selectedIds }, childVideoCategory: { is: { status: true } } },
          _count: { _all: true },
        })
      : Promise.resolve([] as any[]),
  ]);

  // videos-per-category, then summed over each category's subtree. Summing the
  // per-category tallies reproduces the old `count({ videoCategoryId: { in: subtree } })`
  // exactly, because a video belongs to exactly one category.
  const videosPerCat = new Map<number, number>();
  for (const r of videoCountRows as any[]) {
    if (r.videoCategoryId != null) videosPerCat.set(r.videoCategoryId, r._count._all);
  }
  const childCountByCat = new Map<number, number>();
  for (const r of childCountRows as any[]) {
    if (r.parent != null) childCountByCat.set(r.parent, r._count._all);
  }

  const list = await Promise.all(selected.map(async (cat) => {
    const subtree = subtreeByCat.get(cat.id) ?? [cat.id];
    const videoCount = subtree.reduce((sum, id) => sum + (videosPerCat.get(id) ?? 0), 0);
    const childCount = childCountByCat.get(cat.id) ?? 0;
    const havingChildDirectory = childCount > 0;

    if (!inlineList) {
      // stripped shape: directory node → child-folder count; leaf → subtree video count.
      const count = havingChildDirectory ? childCount : videoCount;
      return { category: { _id: String(cat.id), title: cat.title, image: cat.image, havingChildDirectory, count }, _subtree: subtree };
    }

    // course: legacy inlined video list (title search applies to the list; count = subtree count).
    const videoWhere: any = { videoCategoryId: cat.id, status: true };
    const catSearch = buildPrismaSearch(opts.search, ["title"]);
    if (catSearch) videoWhere.AND = catSearch.AND;
    const videos = await prisma.video.findMany({ where: videoWhere, orderBy: [{ order: "asc" }, { created_at: "asc" }] });
    let progByVideo = new Map<number, any>();
    if (opts.customerId && videos.length) {
      const rows = await prisma.lectureProgress.findMany({ where: { customerId: opts.customerId, videoId: { in: videos.map((v) => v.id) } }, select: { videoId: true, positionSec: true, durationSec: true, completed: true, completedAt: true, lastWatchedAt: true } });
      progByVideo = new Map(rows.map((r) => [r.videoId!, r]));
    }
    const videoList = videos.map((v) => {
      const p = progByVideo.get(v.id);
      // No raw id/url. Paid videos get a media token ONLY when the course is
      // purchased (else null); free videos always get a free token. The client
      // exchanges it at /media/resolve.
      const isPaid = v.priceType === "paid";
      const canPlay = !isPaid || courseEntitled;
      const mediaToken =
        opts.customerId && canPlay
          ? isPaid
            ? signMediaToken({ k: "video", id: v.id, scope: { kind: "course", id: opts.id }, cust: opts.customerId })
            : signMediaToken({ k: "video", id: v.id, free: true, cust: opts.customerId })
          : null;
      return {
        _id: String(v.id), title: v.title ?? "", topic: v.topic ?? "", platform: v.platform, priceType: v.priceType, isPaid, isPurchased: canPlay, videoCategoryId: v.videoCategoryId != null ? String(v.videoCategoryId) : null, order: v.order,
        recordings: [], qualities: defaultListingQualities(),
        mediaToken,
        progress: p ? { positionSec: p.positionSec ?? 0, durationSec: p.durationSec ?? 0, completed: !!p.completed, completedAt: p.completedAt ?? null, lastWatchedAt: p.lastWatchedAt ?? null } : null,
      };
    });
    return { category: { _id: String(cat.id), title: cat.title, image: cat.image, havingChildDirectory, count: videoCount }, list: videoList, _subtree: subtree };
  }));

  // Summed from the batched groupBy above rather than a fourth round-trip — the
  // union of the selected subtrees is exactly what `videosPerCat` was built over.
  const union = [...new Set(list.flatMap((g) => g._subtree))];
  const totalItems = union.reduce((sum, id) => sum + (videosPerCat.get(id) ?? 0), 0);
  const responseList = list.map(({ _subtree, ...rest }) => rest);
  return { list: responseList, availableCategories, totals: { categories: responseList.length, items: totalItems } };
};

// ── MATERIALS ──────────────────────────────────────────────────────────────
// ws_material_category row → the FULL Mongo MaterialCategory doc shape (the
// catalog controller spreads the whole embedded category, so parity needs every
// field: slug/parent/ancestors/childCategoryIds/status/timestamps/__v).
const shapeMaterialCategoryDoc = (
  cat: any,
  ancestors: string[],
  childCategoryIds: string[],
  count: number
) => ({
  _id: String(cat.id),
  title: cat.name,
  slug: cat.slug,
  image: cat.image ?? null,
  parent: cat.parent && cat.parent > 0 ? String(cat.parent) : null,
  ancestors,
  childCategoryIds,
  order: cat.order_by,
  status: !!cat.status,
  createdAt: cat.created_at ?? null,
  updatedAt: cat.updated_at ?? null,
  __v: 0,
  havingChildDirectory: childCategoryIds.length > 0,
  count,
});

// ws_material row → the FULL Mongo Material doc shape + isPurchased, with
// file/directLink gated for unpurchased paid items (mirrors shapeMaterialForClient).
// description/thumbnail are emitted only when set (Mongoose omits unset optionals).
const shapeMaterialDoc = (m: any, owned: Set<number>, customerId: number | null = null) => {
  const isPaid = true; // hard rule: study materials are always paid (ignores stored isPaid)
  const isPurchased = owned.has(m.id);
  const isDirectLink = !m.file && !!m.direct_link;
  const out: any = {
    _id: String(m.id),
    title: m.name,
    materialCategoryId: m.materialCategoryId != null ? String(m.materialCategoryId) : null,
    // Encrypted media contract — raw URLs withheld; resolve via mediaToken.
    file: "",
    directLink: "",
    isDirectLink,
    mediaToken: materialMediaToken(m.id, isPurchased, isPaid, customerId),
    fileSize: m.fileSize != null ? Number(m.fileSize) : null,
    fileMime: m.fileMime ?? null,
    language: m.language ?? null,
    isPreview: !!m.isPreview,
    isPaid,
    downloadCount: m.downloadCount ?? 0,
    order: m.order_by,
    status: !!m.status,
    createdAt: m.created_at ?? null,
    updatedAt: m.updated_at ?? null,
    __v: 0,
    isPurchased,
  };
  if (m.description != null) out.description = m.description;
  if (m.thumbnail != null) out.thumbnail = m.thumbnail;
  return out;
};

/** Ancestor id chain (root → parent, excludes self) for a category. [] for roots. */
const materialCategoryAncestors = async (parentId: number): Promise<string[]> => {
  const chain: string[] = [];
  const seen = new Set<number>();
  let pid = parentId;
  while (pid && pid > 0 && !seen.has(pid)) {
    seen.add(pid);
    const row = await prisma.materialCategory.findUnique({ where: { id: pid }, select: { id: true, parent: true } });
    if (!row) break;
    chain.push(String(row.id));
    pid = row.parent;
  }
  return chain.reverse();
};

export const catalogMaterials = async (opts: { type: "course" | "package" | "live-course"; id: number; search: string | null; customerId?: number | null }) => {
  // Ordered material-category ids: course/package via link tables, live-course
  // via the row's material_categories JSON.
  let catIds: number[];
  if (opts.type === "course") {
    const refs = await prisma.materialCategoryCourse.findMany({ where: { courseId: opts.id }, orderBy: [{ order: "asc" }, { created_at: "asc" }] });
    catIds = refs.map((r) => r.materialCategoryId).filter((n): n is number => n != null);
  } else if (opts.type === "package") {
    const refs = await prisma.materialCategoryPackage.findMany({ where: { packageId: opts.id }, orderBy: [{ order: "asc" }, { created_at: "asc" }] });
    catIds = refs.map((r) => r.materialCategoryId).filter((n): n is number => n != null);
  } else {
    catIds = await liveCourseCategoryIds(opts.id, "materialCategories");
  }
  let cats = catIds.length ? await prisma.materialCategory.findMany({ where: { id: { in: catIds }, status: true } }) : [];
  const byId = new Map(cats.map((c) => [c.id, c]));
  let ordered = catIds.map((cid) => byId.get(cid)).filter(Boolean) as any[];
  if (opts.search) ordered = ordered.filter((c) => matchesAllTokens(opts.search, [c.name]));

  // Only `course` keeps the legacy inlined per-category `materials` array.
  // `package` and `live-course` use the newer stripped shape (category + context-
  // dependent `count`, no inlined materials) — they were never reverted.
  const inlineMaterials = opts.type === "course";

  // course only: fetch each folder's OWN direct materials across all categories,
  // resolve ownership once, then group.
  const directByCat = new Map<number, any[]>();
  let ownedIds = new Set<number>();
  if (inlineMaterials) {
    const allDirect: any[] = [];
    await Promise.all(ordered.map(async (cat) => {
      const mats = await prisma.material.findMany({
        where: { materialCategoryId: cat.id, status: true },
        orderBy: [{ order_by: "asc" }, { created_at: "asc" }],
      });
      directByCat.set(cat.id, mats);
      allDirect.push(...mats);
    }));
    ownedIds = await getPurchasedMaterialIds(
      opts.customerId ?? null,
      allDirect.map((m) => ({ _id: m.id, materialCategoryId: m.materialCategoryId, isPaid: !!m.isPaid }))
    );
  }

  const list = await Promise.all(ordered.map(async (cat) => {
    const subtreeIds = await descendantIds("ws_material_category", "parent", cat.id);
    const [itemCount, children, ancestors] = await Promise.all([
      prisma.material.count({ where: { materialCategoryId: { in: subtreeIds }, status: true } }),
      prisma.materialCategory.findMany({ where: { parent: cat.id, status: true }, select: { id: true } }),
      materialCategoryAncestors(cat.parent),
    ]);
    const childCategoryIds = children.map((c) => String(c.id));

    if (!inlineMaterials) {
      // stripped shape: directory node → child-folder count; leaf → subtree material count.
      const havingChildDirectory = childCategoryIds.length > 0;
      const count = havingChildDirectory ? childCategoryIds.length : itemCount;
      return { category: shapeMaterialCategoryDoc(cat, ancestors, childCategoryIds, count), _itemCount: itemCount };
    }

    // course: legacy inlined materials (count = subtree material count).
    const materials = (directByCat.get(cat.id) ?? []).map((m) => shapeMaterialDoc(m, ownedIds, opts.customerId ?? null));
    return { category: shapeMaterialCategoryDoc(cat, ancestors, childCategoryIds, itemCount), materials, _itemCount: itemCount };
  }));
  return {
    list: list.map(({ _itemCount, ...rest }) => rest),
    totals: { categories: list.length, items: list.reduce((n, g) => n + g._itemCount, 0) },
  };
};

// ── TESTS ──────────────────────────────────────────────────────────────────
export const catalogTests = async (opts: { type: "course" | "package" | "live-course"; id: number; search: string | null }) => {
  let catIds: number[];
  if (opts.type === "course") {
    const refs = await prisma.examCategoryCourse.findMany({ where: { courseId: opts.id }, orderBy: [{ order: "asc" }, { created_at: "asc" }] });
    catIds = refs.map((r) => r.examCategoryId).filter((n): n is number => n != null);
  } else if (opts.type === "package") {
    const refs = await prisma.examCategoryPackage.findMany({ where: { packageId: opts.id }, orderBy: [{ order: "asc" }, { created_at: "asc" }] });
    catIds = refs.map((r) => r.examCategoryId).filter((n): n is number => n != null);
  } else {
    catIds = await liveCourseCategoryIds(opts.id, "examCategories");
  }
  let cats = catIds.length ? await prisma.examCategory.findMany({ where: { id: { in: catIds }, status: true } }) : [];
  const byId = new Map(cats.map((c) => [c.id, c]));
  let ordered = catIds.map((cid) => byId.get(cid)).filter(Boolean) as any[];
  if (opts.search) ordered = ordered.filter((c) => matchesAllTokens(opts.search, [c.name]));

  // `count` is context-dependent: a directory node reports its direct child-folder
  // count; a leaf reports the exam count across its subtree. `totals.items` keeps
  // tracking the true exam count (via `_itemCount`).
  const list = await Promise.all(ordered.map(async (cat) => {
    const ids = await descendantIds("ws_exam_category", "parent_id", cat.id);
    const [itemCount, childCount] = await Promise.all([
      // Mongo filtered status:PUBLISHED + non-ended window; SQL Exam.status is Boolean → status=true.
      // Only active, subject-type quizzes that have already STARTED count — drafts
      // (status=false), daily-type, and scheduled-for-later subject quizzes are excluded.
      prisma.exam.count({
        where: { AND: [examInCategoriesWhere(ids), { status: true, type: "subject" }, subjectStartedWhere(new Date())] },
      }),
      prisma.examCategory.count({ where: { parent: cat.id, status: true } }),
    ]);
    const havingChildDirectory = childCount > 0;
    const count = havingChildDirectory ? childCount : itemCount;
    return { category: { _id: String(cat.id), title: cat.name, name: cat.name, image: cat.image, havingChildDirectory, count }, _itemCount: itemCount };
  }));
  return {
    list: list.map(({ _itemCount, ...rest }) => rest),
    totals: { categories: list.length, items: list.reduce((n, g) => n + g._itemCount, 0) },
  };
};
