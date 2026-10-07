// Video catalog: video lookups, encryption input and category children.
import { catalogVideoRepository as repo } from "./catalog-video.repository";
import {
  toVideoCategoryDto,
  toVideoDto,
  toVideoEncryptInput,
} from "./catalog-video.transformer";
import type {
  VideoCategoryDto,
  VideoDto,
  VideoEncryptInput,
} from "./catalog-video.types";

export const parseVideoId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const parseVideoCategoryId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const findVideoById = async (id: number): Promise<VideoDto | null> => {
  const row = await repo.findVideoById(id);
  return row ? toVideoDto(row) : null;
};

export const listActiveVideosByCategory = async (
  videoCategoryId: number
): Promise<VideoDto[]> => {
  const rows = await repo.listActiveVideosByCategory(videoCategoryId);
  return rows.map(toVideoDto);
};

export const countActiveVideosByCategory = (videoCategoryId: number): Promise<number> =>
  repo.countActiveVideosByCategory(videoCategoryId);

/** Returns the `encryptVideoSource` input; the caller does the encryption. Null if missing/disabled. */
export const getVideoEncryptInput = async (
  id: number
): Promise<{ video: VideoDto; encrypt: VideoEncryptInput } | null> => {
  const row = await repo.findVideoById(id);
  if (!row) return null;
  return { video: toVideoDto(row), encrypt: toVideoEncryptInput(row) };
};

/**
 * Children are resolved from ws_video_category_relation. The parent is fetched
 * without a status gate, so an inactive parent still renders its children.
 */
export const getVideoCategoryChildren = async (
  parentId: number,
  search?: string,
  paging?: { skip?: number; take?: number }
): Promise<{ parent: VideoCategoryDto; list: { category: VideoCategoryDto & { count: number; havingChildDirectory: boolean } }[]; total: number } | null> => {
  const parentRow = await repo.findCategoryByIdAny(parentId);
  if (!parentRow) return null;

  const searchOpt = search?.trim() || undefined;
  const [children, total] = await Promise.all([
    repo.listActiveChildren(parentId, { search: searchOpt, skip: paging?.skip, take: paging?.take }),
    repo.countActiveChildren(parentId, { search: searchOpt }),
  ]);
  const childIds = children.map((c) => c.id);
  const [videoCounts, childCountRows] = await Promise.all([
    Promise.all(childIds.map((cid) => repo.countActiveVideosByCategory(cid))),
    repo.childCountsByParent(childIds),
  ]);
  const childFolderCount = new Map(childCountRows.map((r) => [r.parent, r._count._all]));

  const list = children.map((c, i) => {
    const folders = childFolderCount.get(c.id) ?? 0;
    const havingChildDirectory = folders > 0;
    // Catalog contract: a directory reports its child-folder count, a leaf its own video count.
    const count = havingChildDirectory ? folders : videoCounts[i];
    return { category: { ...toVideoCategoryDto(c), count, havingChildDirectory } };
  });
  return { parent: toVideoCategoryDto(parentRow), list, total };
};
