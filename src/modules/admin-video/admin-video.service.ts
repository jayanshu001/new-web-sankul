import { isMysqlModule } from "../../config/migration";
import { adminVideoRepository as repo } from "./admin-video.repository";

export const ADMIN_VIDEO_MODULE = "admin-video";
export const isAdminVideoMysql = (): boolean => isMysqlModule(ADMIN_VIDEO_MODULE);

export const parseVideoId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// Mirrors the controller's toItem() response shape exactly.
const toItem = (v: any) => ({
  id: String(v.id),
  name: v.title,
  slug: v.slug,
  order: v.order,
  topic: v.topic,
  type: v.priceType,
  status: v.status,
  // Always a uniform object shape (id always present; name/slug null when the
  // category row doesn't resolve) — never a bare string. A mixed object/string
  // shape breaks the admin table for unresolved (orphaned) category refs.
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

// ── list / prereqs / get ──────────────────────────────────────────────────────
export const listVideos = async (q: { search?: string; status?: string; type?: string; platform?: string; videoCategoryId?: string; page: number; per_page: number; sort_by: string; sort_dir: string }) => {
  const opts = {
    search: q.search,
    status: q.status === "true" ? true : q.status === "false" ? false : undefined,
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

export const getPreRequisites = async () => {
  const [cats, parentIds] = await Promise.all([repo.listActiveCategories(), repo.childParentIds()]);
  return {
    categories: cats.map((c) => ({ id: String(c.id), name: c.title, slug: c.slug, has_children: parentIds.has(c.id) })),
    types: [{ value: "free", label: "Free" }, { value: "paid", label: "Paid" }],
    platforms: ["youtube", "vimeo", "aws"],
  };
};

export const getVideo = async (id: number) => {
  const v = await repo.findById(id);
  return v ? toItem(v) : null;
};

// ── create / update ─────────────────────────────────────────────────────────
export interface VideoCreateInput { videoCategoryId: string; name: string; slug: string; topic: string; order: number; type: "free" | "paid"; youtube?: boolean; vimeo?: boolean; aws?: boolean; youtubeId?: string | null; vimeoId?: string | null; awsId?: string | null; status: boolean }

export const createVideo = async (d: VideoCreateInput): Promise<{ ok: false; reason: "category" } | { ok: true; data: any }> => {
  const catId = parseVideoId(d.videoCategoryId);
  if (!catId || !(await repo.categoryExists(catId))) return { ok: false, reason: "category" };
  const slug = await uniqueSlug(d.slug);
  const platform = pickPlatform(d)!;
  const created = await repo.create({
    videoCategoryId: catId, title: d.name, slug, topic: d.topic, order: d.order, priceType: d.type, platform,
    youtube_id: platform === "youtube" ? d.youtubeId ?? null : null,
    vimeo_id: platform === "vimeo" ? d.vimeoId ?? null : null,
    aws_id: platform === "aws" ? d.awsId ?? null : null,
    status: d.status, created_at: new Date(), updated_at: new Date(),
  });
  return { ok: true, data: toItem(created) };
};

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
