/**
 * Catalog · Video — MySQL (Prisma) branch types.
 *
 * Tables: `ws_video` (156) + `ws_video_category` (157). The M:N relation tables
 * `ws_video_category_relation` (2456) + `ws_video_category_package_relation`
 * (6907) are DEFERRED (D2 = defer): the migrated client surface builds its
 * video-category groups from the Mongo `Package.specificSubjects[]` array +
 * `VideoCategory.childCategoryIds`, NOT from these SQL join tables (which are a
 * legacy/admin representation). They migrate with the commerce/browse wave if
 * the SQL category-tree is ever rebuilt. Their Prisma models already exist.
 *
 * THE VIDEO-URL ENCRYPTION CONTRACT (standing memory rule):
 *  - Any endpoint returning a video URL MUST route through `encryptVideoSource`
 *    in `src/client/course/lecture.controller.ts`, which uses
 *    `utils/videoEncryption`. Encryption is deterministic given (token, sourceId)
 *    where sourceId is picked by `platform` from {youtube_id, aws_id, vimeo_id}.
 *  - The Prisma `Video` model exposes those EXACT fields with the SAME names as
 *    the Mongo model, so a MySQL-sourced video object fed into the SAME util
 *    yields an identical videoURL for any fixed token — parity by construction.
 *    Verified via a fixed-token Mongo-vs-MySQL parity test.
 *  - `VideoEncryptInput` below is the precise shape `encryptVideoSource` needs;
 *    `toVideoEncryptInput` produces it from a migrated row. NEVER reimplement
 *    the encryption — only feed the util.
 *
 * SCHEMA-DRIFT NOTES (verified vs live DDL on 2026-06-11):
 *  - `Video` model is CLEAN — every column matches the DDL.
 *  - `ws_video_category` DDL has `parent`, `educator_id`, `pdf` columns that the
 *    Prisma `VideoCategory` model omits — read-safe (just not selected). The
 *    Mongo-only `courseId`/`liveCourseId`/`childCategoryIds`/`liveSessionId`
 *    fields used by lecture course-membership + catalog browse do NOT exist in
 *    `ws_video_category` → one reason video stays flag OFF this wave.
 *
 * Ids are returned as strings to stay Mongo `_id`-shape compatible.
 */

export type VideoPlatform = "youtube" | "aws" | "vimeo";
export type VideoPriceType = "free" | "paid";

/** Exact input shape consumed by `encryptVideoSource` (the URL contract). */
export interface VideoEncryptInput {
  platform: VideoPlatform;
  youtube_id?: string;
  aws_id?: string;
  vimeo_id?: string;
}

/** `ws_video` row → DTO. Carries the encryption-source fields verbatim. */
export interface VideoDto {
  _id: string;
  title: string;
  topic: string;
  slug: string;
  platform: VideoPlatform;
  priceType: VideoPriceType;
  youtube_id: string | null;
  aws_id: string | null;
  vimeo_id: string | null;
  videoCategoryId: string | null;
  order: number;
  status: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** `ws_video_category` row → DTO (the columns Prisma maps). */
export interface VideoCategoryDto {
  _id: string;
  title: string;
  slug: string;
  image: string;
  order: number;
  status: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}
