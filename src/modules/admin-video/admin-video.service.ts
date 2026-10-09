// Admin videos: list, CRUD, ordering and the pre-requisites category picker.
import { adminVideoRepository as repo } from "./admin-video.repository";
import { resolveAncestors } from "../../utils/categoryAncestors";
import { nextOrder } from "../../utils/listOrdering";
import { parsePositiveInt } from "../../utils/parseId";


export const parseVideoId = parsePositiveInt;

// Response shape is frozen (admin table parses it).
const toItem = (v: any) => ({
  id: String(v.id),
  name: v.title,
  slug: v.slug,
  order: v.order,
  topic: v.topic,
  type: v.priceType,
  status: v.status,
  // Always an object (name/slug null when the category doesn't resolve), never a bare
  // string: a mixed shape breaks the admin table for orphaned category refs.
  video_category: v.videoCategoryId != null
    ? { id: String(v.videoCategoryId), name: v.VideoCategory?.title ?? null, slug: v.VideoCategory?.slug ?? null }
    : null,
  platform: v.platform,
  youtube: v.platform === "youtube",
  youtubeId: v.youtube_id,
  vimeo: v.platform === "vimeo",
  vimeoId: v.vimeo_id,
  aws: v.platform === "aws",
  awsId: v.aws_id,
  created_at: v.created_at ?? null,
  updated_at: v.updated_at ?? null,
});

const pickPlatform = (d: { youtube?: boolean; vimeo?: boolean; aws?: boolean }): "youtube" | "vimeo" | "aws" | null =>
  d.youtube ? "youtube" : d.vimeo ? "vimeo" : d.aws ? "aws" : null;

/** Append -2/-3/… until the slug is free (never throws). */
const uniqueSlug = async (base: string, exceptId?: number): Promise<string> => {
  const root = base || "video";
  let candidate = root, n = 1;
  while (await repo.slugTaken(candidate, exceptId)) { n += 1; candidate = `${root}-${n}`; }
  return candidate;
};

export const listVideos = async (q: { search?: string; status?: string; type?: string; platform?: string; videoCategoryId?: string; page: number; per_page: number; sort_by: string; sort_dir: string }) => {
  const opts = {
    search: q.search,
    status: q.status === "active" ? true : q.status === "inactive" ? false : undefined,
    type: (q.type === "free" || q.type === "paid" ? q.type : undefined) as "free" | "paid" | undefined,
    platform: q.platform,
    videoCategoryId: q.videoCategoryId ? parseVideoId(q.videoCategoryId) ?? undefined : undefined,
    sortBy: q.sort_by, sortDir: (q.sort_dir === "asc" ? "asc" : "desc") as "asc" | "desc",
  };
  const [rows, total] = await Promise.all([
    repo.list({ ...opts, skip: (q.page - 1) * q.per_page, take: q.per_page }),
    repo.count(opts),
  ]);
  return { items: rows.map(toItem), total };
};

// Category picker rows (parentId/ancestors/has_children) plus type and platform options.
export const getPreRequisites = async (opts: { search?: string; limit?: number } = {}) => {
  // `search` (title contains) + `limit` power the picker's server-side search. Note
  // `childParentIds()` scans ALL categories, so `has_children` stays correct even when
  // the returned rows are a search/limit slice (a parent may be off-page).
  const [cats, parentIds] = await Promise.all([repo.listActiveCategories(opts), repo.childParentIds()]);
  // parentId + ancestors[{id,name}] (root→immediate parent) so the picker can render
  // greyed parent rows for a match. Parent comes from the ws_video_category_relation
  // DAG collapsed to one deterministic parent, not the legacy `parent` column.
  const primaryParent = await repo.primaryParents(cats.map((c) => c.id));
  const parentOf = (id: number) => primaryParent.get(id) ?? 0;
  const ancestorsFor = await resolveAncestors(cats.map((c) => parentOf(c.id)), repo.categoriesByIds);
  return {
    categories: cats.map((c) => ({
      id: String(c.id),
      name: c.title,
      slug: c.slug,
      parentId: parentOf(c.id) > 0 ? String(parentOf(c.id)) : null,
      ancestors: ancestorsFor(parentOf(c.id)),
      has_children: parentIds.has(c.id),
    })),
    types: [{ value: "free", label: "Free" }, { value: "paid", label: "Paid" }],
    platforms: ["youtube", "vimeo", "aws"],
  };
};

export const getVideo = async (id: number) => {
  const v = await repo.findById(id);
  return v ? toItem(v) : null;
};

export interface VideoCreateInput { videoCategoryId: string; name: string; slug: string; topic: string; order?: number; type: "free" | "paid"; youtube?: boolean; vimeo?: boolean; aws?: boolean; youtubeId?: string | null; vimeoId?: string | null; awsId?: string | null; status: boolean }

export const createVideo = async (d: VideoCreateInput): Promise<{ ok: false; reason: "category" } | { ok: true; data: any }> => {
  const catId = parseVideoId(d.videoCategoryId);
  if (!catId || !(await repo.categoryExists(catId))) return { ok: false, reason: "category" };
  const slug = await uniqueSlug(d.slug);
  const platform = pickPlatform(d)!;
  // No explicit order → MAX(order) + 1 (same rule as exams). Only affects the client
  // catalog's `order ASC`; the admin list sorts by recency.
  const order = d.order ?? nextOrder(await repo.maxOrder());
  const created = await repo.create({
    videoCategoryId: catId, title: d.name, slug, topic: d.topic, order, priceType: d.type, platform,
    youtube_id: platform === "youtube" ? d.youtubeId ?? null : null,
    vimeo_id: platform === "vimeo" ? d.vimeoId ?? null : null,
    aws_id: platform === "aws" ? d.awsId ?? null : null,
    status: d.status, created_at: new Date(), updated_at: new Date(),
  });
  return { ok: true, data: toItem(created) };
};

// Partial update; switching platform clears the other providers' ids.
export const updateVideo = async (id: number, d: any): Promise<"not_found" | "category" | any> => {
  const video = await repo.findBare(id);
  if (!video) return "not_found";
  const data: any = { updated_at: new Date() };

  if (d.videoCategoryId && parseVideoId(d.videoCategoryId) !== video.videoCategoryId) {
    const catId = parseVideoId(d.videoCategoryId);
    if (!catId || !(await repo.categoryExists(catId))) return "category";
    data.videoCategoryId = catId;
  }
  if (d.slug && d.slug !== video.slug) data.slug = await uniqueSlug(d.slug, id);
  if (d.name !== undefined) data.title = d.name;
  if (d.topic !== undefined) data.topic = d.topic;
  if (d.order !== undefined) data.order = d.order;
  if (d.type !== undefined) data.priceType = d.type;
  if (d.status !== undefined) data.status = d.status;

  const platformTouched = d.youtube !== undefined || d.vimeo !== undefined || d.aws !== undefined;
  if (platformTouched) {
    const platform = pickPlatform(d);
    if (platform) {
      data.platform = platform;
      data.youtube_id = platform === "youtube" ? d.youtubeId ?? null : null;
      data.vimeo_id = platform === "vimeo" ? d.vimeoId ?? null : null;
      data.aws_id = platform === "aws" ? d.awsId ?? null : null;
    }
  } else {
    if (video.platform === "youtube" && d.youtubeId !== undefined) data.youtube_id = d.youtubeId ?? null;
    if (video.platform === "vimeo" && d.vimeoId !== undefined) data.vimeo_id = d.vimeoId ?? null;
    if (video.platform === "aws" && d.awsId !== undefined) data.aws_id = d.awsId ?? null;
  }

  const updated = await repo.update(id, data);
  return toItem(updated);
};

export const deleteVideo = async (id: number): Promise<boolean> => {
  if (!(await repo.findBare(id))) return false;
  await repo.delete(id);
  return true;
};

export const toggleStatus = async (id: number): Promise<boolean | null> => {
  const v = await repo.findBare(id);
  if (!v) return null;
  const updated = await repo.setStatus(id, !v.status);
  return updated.status;
};

export const reorderVideos = async (orders: Array<{ id: string; order: number }>) => {
  await Promise.all(orders.map(({ id, order }) => {
    const numId = parseVideoId(id);
    return numId ? repo.setOrder(numId, order) : Promise.resolve();
  }));
};
