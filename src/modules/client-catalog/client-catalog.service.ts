// Client catalog: per-product video, material and test directory listings.
import { prisma } from "../../config/prisma";
import { defaultListingQualities } from "../../utils/videoQualities";
import { signMediaToken } from "../../utils/mediaToken";
import { hasActiveCourseSub } from "../client-lecture/client-lecture.service";
import { hasActivePackageSubscription } from "../commerce-subscription/commerce-subscription.service";
import { getPurchasedMaterialIds, materialMediaToken } from "../client-material/client-material.service";
import { examInCategoriesWhere, subjectStartedWhere } from "../catalog-exam/exam-category-pivot.where";
import { buildPrismaSearch, matchesAllTokens } from "../../utils/searchFilter";
import { selfFkDescendantsByRoot } from "../catalog-category-tree/category-tree.service";
import { parsePositiveInt } from "../../utils/parseId";

export const parseCatId = parsePositiveInt;

// An inactive package is hidden, but an active subscriber keeps access.
export const loadParent = async (type: "course" | "package" | "live-course", id: number, customerId: number | null = null): Promise<{ name: string } | null> => {
  if (type === "course") {
    const c = await prisma.course.findFirst({ where: { id }, select: { name: true } });
    return c ? { name: c.name ?? "" } : null;
  }
  if (type === "live-course") {
    const lc = await prisma.liveCourse.findFirst({ where: { id, status: true }, select: { name: true } });
    return lc ? { name: lc.name } : null;
  }
  const p = await prisma.package.findFirst({ where: { id }, select: { name: true, active: true } });
  if (!p) return null;
  if (!p.active && !(customerId && (await hasActivePackageSubscription(customerId, id)))) return null;
  return { name: p.name };
};

// Live courses store material/exam category refs as a JSON array on the row, not in
// link tables. Entries are { category, order } or a bare id; order is preserved.
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

// Top-level video folders of a course, package or live course (catalog directory contract).
export const catalogVideos = async (opts: {
  type: "course" | "package" | "live-course"; id: number; customerId: number | null; search: string | null; categoryIds: number[] | null;
}) => {
  let roots: { id: number; title: string | null; image: string | null }[] = [];
  if (opts.type === "course") {
    const c = await prisma.course.findFirst({ where: { id: opts.id }, select: { videoCategoryId: true } });
    if (c?.videoCategoryId) {
      const vc = await prisma.videoCategory.findFirst({ where: { id: c.videoCategoryId, status: true }, select: { id: true, title: true, image: true } });
      if (vc) roots = [vc];
    }
  } else if (opts.type === "live-course") {
    // Live courses own their folders directly via liveCourseId.
    const owned = await prisma.videoCategory.findMany({
      where: { liveCourseId: opts.id, status: true },
      orderBy: [{ order_by: "asc" }, { created_at: "asc" }],
      select: { id: true, title: true, image: true },
    });
    // Roots only: nested folders (ws_video_category_relation edges) are reached by
    // drilling in, never listed next to their parent. Edges are scoped to this
    // course's own folders, so a folder shared into another tree stays a root here.
    const ownedIds = owned.map((c) => c.id);
    const nestedEdges = ownedIds.length
      ? await prisma.videoCategoryRelation.findMany({ where: { parent: { in: ownedIds }, child: { in: ownedIds } }, select: { child: true } })
      : [];
    const nested = new Set(nestedEdges.map((e) => e.child));
    roots = owned.filter((c) => !nested.has(c.id));
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

  // Only `course` inlines the per-category video `list`; package and live-course use
  // the stripped shape (category + context-dependent `count`).
  const inlineList = opts.type === "course";
  // Course entitlement is one subscription check for the whole response.
  const courseEntitled = inlineList && opts.customerId ? await hasActiveCourseSub(opts.customerId, opts.id) : false;
  const { descendantsOf } = await import("../catalog-category-tree/category-tree.service");

  // `course` returns a flat list searched at the DB across the whole root subtree;
  // the controller paginates it. package/live-course keep the grouped shape below.
  if (opts.type === "course") {
    const root = roots[0];
    if (!root) return { list: [] };
    const subtree = await descendantsOf([root.id]);
    const videoWhere: any = { videoCategoryId: { in: subtree }, status: true };
    const flatSearch = buildPrismaSearch(opts.search, ["title"]);
    if (flatSearch) videoWhere.AND = flatSearch.AND;
    // Explicit `select`: ws_video is a wide legacy table and this path can return a
    // whole course subtree.
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
      // Paid videos get a token only when the course is purchased; free videos always do.
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

  // Batched: 3 queries total regardless of category count (one CTE for every
  // subtree, one groupBy for video counts, one for child-edge counts). Doing this
  // per category saturated the Prisma pool on packages with many subjects.
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
    // Only edges to an existing, active child count; dangling edges must not inflate
    // havingChildDirectory / count.
    selectedIds.length
      ? prisma.videoCategoryRelation.groupBy({
          by: ["parent"],
          where: { parent: { in: selectedIds }, childVideoCategory: { is: { status: true } } },
          _count: { _all: true },
        })
      : Promise.resolve([] as any[]),
  ]);

  // Summing per-category tallies over a subtree is exact because a video belongs to one category.
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
      // Directory node → child-folder count; leaf → subtree video count.
      const count = havingChildDirectory ? childCount : videoCount;
      return { category: { _id: String(cat.id), title: cat.title, image: cat.image, havingChildDirectory, count }, _subtree: subtree };
    }

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
      // Paid videos get a media token only when the course is purchased; free videos
      // always get one. The client exchanges it at /media/resolve.
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

  // Summed from `videosPerCat`, which was built over exactly this union.
  const union = [...new Set(list.flatMap((g) => g._subtree))];
  const totalItems = union.reduce((sum, id) => sum + (videosPerCat.get(id) ?? 0), 0);
  const responseList = list.map(({ _subtree, ...rest }) => rest);
  return { list: responseList, availableCategories, totals: { categories: responseList.length, items: totalItems } };
};

// The catalog controller spreads the whole category, so every legacy field is emitted.
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

// Paid items not purchased get no file/directLink. description/thumbnail are
// emitted only when set (clients expect unset optionals to be absent).
const shapeMaterialDoc = (m: any, owned: Set<number>, customerId: number | null = null) => {
  const isPaid = !!m.isPaid;
  const isPurchased = !isPaid || owned.has(m.id);
  const isDirectLink = !m.file && !!m.direct_link;
  const out: any = {
    _id: String(m.id),
    title: m.name,
    materialCategoryId: m.materialCategoryId != null ? String(m.materialCategoryId) : null,
    // Raw URLs withheld; resolved via mediaToken.
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

  // Only `course` inlines per-category `materials`; package and live-course use the
  // stripped shape (category + context-dependent `count`).
  const inlineMaterials = opts.type === "course";

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
    // Entitlement is scoped to this container (the URL is the entry point).
    // Unscoped, owning another product with the same category would read as
    // `isPurchased: true` inside a product the customer never bought.
    ownedIds = await getPurchasedMaterialIds(
      opts.customerId ?? null,
      allDirect.map((m) => ({ _id: m.id, materialCategoryId: m.materialCategoryId, isPaid: !!m.isPaid })),
      opts.type === "course"
        ? { kind: "course", id: opts.id }
        : opts.type === "package"
          ? { kind: "package", id: opts.id }
          : { kind: "liveCourse", id: opts.id }
    );
  }

  // Batched like catalogVideos: one CTE for every subtree, one groupBy for material
  // counts, one query for children, instead of three queries per category. Summing
  // per-category tallies is exact because a material belongs to one category.
  const orderedIds = ordered.map((c) => c.id);
  const subtreeByCat = await selfFkDescendantsByRoot("ws_material_category", "parent", orderedIds);
  const unionSubtree = [...new Set([...subtreeByCat.values()].flat())];
  const [countRows, childRows] = await Promise.all([
    unionSubtree.length
      ? prisma.material.groupBy({ by: ["materialCategoryId"], where: { materialCategoryId: { in: unionSubtree }, status: true }, _count: { _all: true } })
      : Promise.resolve([] as any[]),
    orderedIds.length
      ? prisma.materialCategory.findMany({ where: { parent: { in: orderedIds }, status: true }, select: { id: true, parent: true } })
      : Promise.resolve([] as { id: number; parent: number }[]),
  ]);
  const perCat = new Map<number, number>();
  for (const r of countRows as any[]) if (r.materialCategoryId != null) perCat.set(r.materialCategoryId, r._count._all);

  const list = await Promise.all(ordered.map(async (cat) => {
    const itemCount = (subtreeByCat.get(cat.id) ?? [cat.id]).reduce((n, id) => n + (perCat.get(id) ?? 0), 0);
    const childCategoryIds = childRows.filter((c) => c.parent === cat.id).map((c) => String(c.id));
    const ancestors = await materialCategoryAncestors(cat.parent);

    if (!inlineMaterials) {
  // Directory node → child-folder count; leaf → subtree material count.
      const havingChildDirectory = childCategoryIds.length > 0;
      const count = havingChildDirectory ? childCategoryIds.length : itemCount;
      return { category: shapeMaterialCategoryDoc(cat, ancestors, childCategoryIds, count), _itemCount: itemCount };
    }

    const materials = (directByCat.get(cat.id) ?? []).map((m) => shapeMaterialDoc(m, ownedIds, opts.customerId ?? null));
    return { category: shapeMaterialCategoryDoc(cat, ancestors, childCategoryIds, itemCount), materials, _itemCount: itemCount };
  }));
  return {
    list: list.map(({ _itemCount, ...rest }) => rest),
    totals: { categories: list.length, items: list.reduce((n, g) => n + g._itemCount, 0) },
  };
};

// Exam categories linked to a product, in their configured order.
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

  // `count` is context-dependent (directory → child-folder count, leaf → subtree
  // exam count); `totals.items` tracks the true exam count via `_itemCount`.
  // Subtrees and child counts are batched. The exam count stays per category: an exam
  // can sit in several categories (pivot), so per-category tallies cannot be summed.
  const orderedIds = ordered.map((c) => c.id);
  const [subtreeByCat, childRows] = await Promise.all([
    selfFkDescendantsByRoot("ws_exam_category", "parent_id", orderedIds),
    orderedIds.length
      ? prisma.examCategory.groupBy({ by: ["parent"], where: { parent: { in: orderedIds }, status: true }, _count: { _all: true } })
      : Promise.resolve([] as any[]),
  ]);
  const childCountByCat = new Map<number, number>((childRows as any[]).map((r) => [r.parent, r._count._all]));
  const now = new Date();

  const list = await Promise.all(ordered.map(async (cat) => {
    const ids = subtreeByCat.get(cat.id) ?? [cat.id];
    const childCount = childCountByCat.get(cat.id) ?? 0;
    // Only active, started, subject-type quizzes count (no drafts, daily tests or scheduled-later quizzes).
    const itemCount = await prisma.exam.count({
      where: { AND: [examInCategoriesWhere(ids), { status: true, type: "subject" }, subjectStartedWhere(now)] },
    });
    const havingChildDirectory = childCount > 0;
    const count = havingChildDirectory ? childCount : itemCount;
    return { category: { _id: String(cat.id), title: cat.name, name: cat.name, image: cat.image, havingChildDirectory, count }, _itemCount: itemCount };
  }));
  return {
    list: list.map(({ _itemCount, ...rest }) => rest),
    totals: { categories: list.length, items: list.reduce((n, g) => n + g._itemCount, 0) },
  };
};
