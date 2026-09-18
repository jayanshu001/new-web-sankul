import { mediaRepository } from "./media.repository";
import { toMediaDto } from "./media.transformer";
import { deleteFromS3FileUrl, isOwnBucketUrl } from "../../middlewares/upload";
import logger from "../../utils/logger";
import type { MediaCreateInput, MediaDto } from "./media.types";

/** Creates a Media row from an uploaded file and returns its id for attaching
 * to a featuredImageId / logoMediaId / imageMediaId / ogImageId / previewMediaId
 * column. `altText` defaults to the file name when not supplied. */
export const createMediaFromUpload = async (input: MediaCreateInput): Promise<MediaDto> => {
  const row = await mediaRepository.create(input);
  return toMediaDto(row);
};

/** Best-effort cleanup for the Media row a re-upload just replaced: deletes its
 * S3 object (if it's in our own bucket) and its `wsj_media` row. Never throws —
 * called after the new upload/save already succeeded, so a cleanup failure must
 * not fail the request; it just leaves an orphaned file for manual cleanup. */
export const deleteMediaById = async (id: bigint | null | undefined): Promise<void> => {
  if (!id) return;
  try {
    const media = await mediaRepository.findById(id);
    if (!media) return;
    if (isOwnBucketUrl(media.url)) await deleteFromS3FileUrl(media.url);
    await mediaRepository.delete(id);
  } catch (error) {
    logger.error("jobs-media: failed to clean up replaced media", { mediaId: id.toString(), error });
  }
};

export const parseMediaId = (id: unknown): bigint | null => {
  if (id === null || id === undefined || id === "") return null;
  const str = String(id).trim();
  if (!/^\d+$/.test(str)) return null;
  return BigInt(str);
};
