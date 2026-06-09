import { Request, Response } from "express";
import mongoose from "mongoose";
import { Package } from "../../models/course/Package.model";
import { Course } from "../../models/course/Course.model";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { MaterialCategory } from "../../models/course/MaterialCategory.model";
import { ExamCategory } from "../../models/exam/ExamCategory.model";
import { Video } from "../../models/course/Video.model";
import { Material } from "../../models/course/Material.model";
import { Exam } from "../../models/exam/Exam.model";
import { LectureProgress } from "../../models/customer/LectureProgress.model";
import { LiveSession } from "../../models/course/LiveSession.model";
import { defaultListingQualities, qualitiesFromSessionRecordings } from "../../utils/videoQualities";
import logger from "../../utils/logger";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import { collectCategoryTreeIds } from "../../utils/categoryTree";
import { ExamStatus } from "../../models/enums";

// ─────────────────────────────────────────────────────────────────────────────
// Unified catalog tabs for the three product types (course / package /
// live-course). One contract for the FE; the per-type differences in HOW the
// root categories are sourced are resolved here and hidden behind a single
// response shape. See docs/client/catalog-tabs.md.
//
//   Material/Exam roots: all three products store `materialCategories[]` /
//   `examCategories[]` ref arrays → identical resolution.
//   Video roots differ:
//     package      → `specificSubjects[].category`
//     course       → single `videoCategoryId` (one group)
//     live-course  → flat folders VideoCategory.find({ liveCourseId })
// ─────────────────────────────────────────────────────────────────────────────

type ParentType = "course" | "package" | "live-course";

const VALID_TYPES: ParentType[] = ["course", "package", "live-course"];

// Streamos sometimes appends stray quote chars to recording paths — strip them
// so the client never sees an unplayable URL. Mirrors the helpers in
// live-course.controller / categories.controller.
function sanitizeRecordingPath<T extends string | null | undefined>(p: T): T {
  if (typeof p !== "string") return p;
  return p.replace(/(?:"|%22|%2522)+$/i, "") as T;
}

function parseType(raw: string): ParentType | null {
  return (VALID_TYPES as string[]).includes(raw) ? (raw as ParentType) : null;
}

function getSearch(req: Request): string {
  return typeof req.query.search === "string" ? req.query.search.trim() : "";
}

// Sort a populated category ref array by its `order` and drop disabled refs.
function activeSortedCategories(refs: any[]): any[] {
  return [...(refs ?? [])]
    .filter((r: any) => r && r.status !== false)
    .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))
    .map((r: any) => r.category)
    .filter((c: any) => c && c.status !== false);
}

function matchesSearch(value: string | undefined | null, search: string): boolean {
  if (!search) return true;
  return typeof value === "string" && value.toLowerCase().includes(search.toLowerCase());
}

// Resolve the parent product, returning a small descriptor used in the response
// `parent` block, or null if not found / not active.
async function loadParent(
  type: ParentType,
  id: string
): Promise<{ doc: any; name: string } | null> {
  if (type === "package") {
    const doc = await Package.findOne({ _id: id, active: true })
      .populate({ path: "specificSubjects.category", model: "VideoCategory" })
      .populate({ path: "materialCategories.category", model: "MaterialCategory" })
      .populate({ path: "examCategories.category", model: "ExamCategory" })
      .lean();
    return doc ? { doc, name: doc.name } : null;
  }
  if (type === "course") {
    const doc = await Course.findOne({ _id: id })
      .populate({ path: "materialCategories.category", model: "MaterialCategory" })
      .populate({ path: "examCategories.category", model: "ExamCategory" })
      .lean();
    return doc ? { doc, name: (doc as any).name ?? (doc as any).title ?? "" } : null;
  }
  // live-course
  const doc = await LiveCourse.findOne({ _id: id, status: true })
    .populate({ path: "materialCategories.category", model: "MaterialCategory" })
    .populate({ path: "examCategories.category", model: "ExamCategory" })
    .lean();
  return doc ? { doc, name: doc.name } : null;
}

// ─── VIDEOS ──────────────────────────────────────────────────────────────────
// GET /api/v1/client/catalog/:type/:id/videos
// Query: ?search=  ?categoryIds=a,b  (categoryIds is video-only)
export const getCatalogVideos = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const type = parseType(String(req.params.type ?? ""));
  const id = String(req.params.id ?? "");
  logger.info("getCatalogVideos invoked", { traceId, path: req.originalUrl, type, id, userId: req.user?.id });

  try {
    if (!type) return failure(res, "Invalid type. Use course | package | live-course.", 422);
    if (!mongoose.Types.ObjectId.isValid(id)) return failure(res, "Invalid id.", 422);

    const parent = await loadParent(type, id);
    if (!parent) return failure(res, `${type} not found.`, 404);

    const search = getSearch(req);
    const categoryIdsParam =
      typeof req.query.categoryIds === "string" && req.query.categoryIds.trim()
        ? req.query.categoryIds.split(",").map((s) => s.trim()).filter(Boolean)
        : null;

    // Resolve the full set of video categories for this product.
    let videoCats: any[] = [];
    if (type === "package") {
      videoCats = activeSortedCategories((parent.doc as any).specificSubjects);
    } else if (type === "course") {
      if ((parent.doc as any).videoCategoryId) {
        const vc = await VideoCategory.findOne({ _id: (parent.doc as any).videoCategoryId, status: true }).lean();
        if (vc) videoCats = [vc];
      }
    } else {
      // live-course → flat folders scoped by liveCourseId
      videoCats = await VideoCategory.find({ liveCourseId: id, status: true })
        .sort({ order_by: 1, createdAt: 1 })
        .lean();
    }

    // availableCategories = the full chooser set (id + title), BEFORE any
    // categoryIds filter, so the FE can render the filter chips regardless of
    // the current selection.
    const availableCategories = videoCats.map((c: any) => ({ _id: String(c._id), title: c.title }));

    // Apply the optional categoryIds filter (ignore ids that don't belong here).
    let selected = videoCats;
    if (categoryIdsParam) {
      const allow = new Set(categoryIdsParam);
      selected = videoCats.filter((c: any) => allow.has(String(c._id)));
    }

    // Build each group: category meta + inlined videos (metadata only). Search
    // filters the inlined video titles within each group.
    const userId = req.user?.id;
    const list = await Promise.all(
      selected.map(async (cat: any) => {
        const videoFilter: any = { videoCategoryId: cat._id, status: true };
        if (search) videoFilter.title = { $regex: search, $options: "i" };

        // count rolls up the whole subtree (this folder + any nested child
        // folders) so the badge matches what the user finds after drilling in;
        // the inlined `videos` stay this folder's direct items only.
        const countCategoryIds = await collectCategoryTreeIds(VideoCategory, cat);
        const [count, videos] = await Promise.all([
          Video.countDocuments({ videoCategoryId: { $in: countCategoryIds }, status: true }),
          Video.find(videoFilter).sort({ order: 1, createdAt: -1 }).lean(),
        ]);

        // Resume state for the row progress sliver.
        let progressByVideo = new Map<string, any>();
        if (userId && videos.length) {
          const progressRows = await LectureProgress.find({
            customerId: new mongoose.Types.ObjectId(userId),
            videoId: { $in: videos.map((v: any) => v._id) },
          })
            .select("videoId positionSec durationSec completed completedAt lastWatchedAt")
            .lean();
          progressByVideo = new Map(progressRows.map((r: any) => [String(r.videoId), r]));
        }

        // Per-quality recordings from the source LiveSession (when promoted).
        const liveSessionIds = videos
          .map((v: any) => v.liveSessionId)
          .filter((sid: any): sid is mongoose.Types.ObjectId => !!sid);
        let recordingsBySession = new Map<string, Array<{ quality: string | null; file_size: number | null; path: string }>>();
        if (liveSessionIds.length) {
          const sessions = await LiveSession.find({ _id: { $in: liveSessionIds } })
            .select("_id recordings")
            .lean();
          for (const s of sessions as any[]) {
            const shaped = (s.recordings ?? [])
              .filter((r: any) => typeof r?.path === "string" && r.path.length > 0)
              .map((r: any) => ({
                quality: typeof r.quality === "string" ? r.quality : null,
                file_size: typeof r.file_size === "number" ? r.file_size : null,
                path: sanitizeRecordingPath(r.path),
              }));
            recordingsBySession.set(String(s._id), shaped);
          }
        }

        const videoList = videos.map((v: any) => {
          const p = progressByVideo.get(String(v._id));
          const recordings = v.liveSessionId ? recordingsBySession.get(String(v.liveSessionId)) ?? [] : [];
          const qualities = recordings.length
            ? qualitiesFromSessionRecordings(recordings)
            : defaultListingQualities();
          return {
            _id: String(v._id),
            title: v.title ?? "",
            topic: v.topic ?? "",
            platform: v.platform,
            priceType: v.priceType,
            order: v.order,
            youtube_id: v.youtube_id ?? null,
            aws_id: sanitizeRecordingPath(v.aws_id ?? null),
            vimeo_id: v.vimeo_id ?? null,
            recordings,
            qualities,
            progress: p
              ? {
                  positionSec: p.positionSec ?? 0,
                  durationSec: p.durationSec ?? 0,
                  completed: !!p.completed,
                  completedAt: p.completedAt ?? null,
                  lastWatchedAt: p.lastWatchedAt ?? null,
                }
              : null,
          };
        });

        return {
          category: {
            ...cat,
            title: cat.title,
            havingChildDirectory: (cat.childCategoryIds?.length ?? 0) > 0,
            count,
          },
          list: videoList,
          // Internal only (stripped before responding): the subtree category ids
          // this group counted, used to compute a de-duplicated grand total.
          _countCategoryIds: countCategoryIds,
        };
      })
    );

    // totals.items must NOT be a naive sum of per-group counts: when a package
    // assigns both a parent folder AND one of its descendants as separate
    // subjects, their subtrees overlap and the same video would be counted in
    // both groups. Count DISTINCT videos across the union of all groups'
    // subtree category ids instead. (Per-group `count` badges keep their own
    // subtree total — overlap there is expected and correct for the badge.)
    const unionCategoryIds = Array.from(
      new Set(list.flatMap((g) => g._countCategoryIds.map((c: any) => String(c))))
    );
    const totalItems = unionCategoryIds.length
      ? await Video.countDocuments({ videoCategoryId: { $in: unionCategoryIds }, status: true })
      : 0;

    // Drop the internal field before responding.
    const responseList = list.map(({ _countCategoryIds, ...rest }) => rest);

    logger.info("getCatalogVideos success", { traceId, type, id, groups: responseList.length });
    return success(
      res,
      {
        parent: { _id: id, type, name: parent.name },
        list: responseList,
        availableCategories,
        totals: { categories: responseList.length, items: totalItems },
      },
      "Video categories fetched."
    );
  } catch (err) {
    logger.error("getCatalogVideos failed", { traceId, type, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch video categories.", 500);
  }
};

// ─── MATERIALS ─────────────────────────────────────────────────────────────
// GET /api/v1/client/catalog/:type/:id/materials   ?search=
export const getCatalogMaterials = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const type = parseType(String(req.params.type ?? ""));
  const id = String(req.params.id ?? "");
  logger.info("getCatalogMaterials invoked", { traceId, path: req.originalUrl, type, id, userId: req.user?.id });

  try {
    if (!type) return failure(res, "Invalid type. Use course | package | live-course.", 422);
    if (!mongoose.Types.ObjectId.isValid(id)) return failure(res, "Invalid id.", 422);

    const parent = await loadParent(type, id);
    if (!parent) return failure(res, `${type} not found.`, 404);

    const search = getSearch(req);
    const cats = activeSortedCategories((parent.doc as any).materialCategories).filter((c: any) =>
      matchesSearch(c.title, search)
    );

    // Roll each folder's count up through its nested child folders so the badge
    // reflects everything reachable beneath it, not just direct materials.
    const counts = await Promise.all(
      cats.map(async (c: any) => {
        const ids = await collectCategoryTreeIds(MaterialCategory, c);
        return Material.countDocuments({ materialCategoryId: { $in: ids }, status: true });
      })
    );

    const list = cats.map((cat: any, i: number) => ({
      category: {
        ...cat,
        title: cat.title,
        havingChildDirectory: (cat.childCategoryIds?.length ?? 0) > 0,
        count: counts[i],
      },
    }));
    const totalItems = counts.reduce((n, c) => n + c, 0);

    logger.info("getCatalogMaterials success", { traceId, type, id, groups: list.length });
    return success(
      res,
      {
        parent: { _id: id, type, name: parent.name },
        list,
        totals: { categories: list.length, items: totalItems },
      },
      "Material categories fetched."
    );
  } catch (err) {
    logger.error("getCatalogMaterials failed", { traceId, type, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch material categories.", 500);
  }
};

// ─── TESTS ───────────────────────────────────────────────────────────────────
// GET /api/v1/client/catalog/:type/:id/tests   ?search=
export const getCatalogTests = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const type = parseType(String(req.params.type ?? ""));
  const id = String(req.params.id ?? "");
  logger.info("getCatalogTests invoked", { traceId, path: req.originalUrl, type, id, userId: req.user?.id });

  try {
    if (!type) return failure(res, "Invalid type. Use course | package | live-course.", 422);
    if (!mongoose.Types.ObjectId.isValid(id)) return failure(res, "Invalid id.", 422);

    const parent = await loadParent(type, id);
    if (!parent) return failure(res, `${type} not found.`, 404);

    const search = getSearch(req);
    // ExamCategory's display field is `name`; search & alias accordingly.
    const cats = activeSortedCategories((parent.doc as any).examCategories).filter((c: any) =>
      matchesSearch(c.name, search)
    );

    // Roll each folder's count up through its nested child folders so the badge
    // reflects every reachable exam, not just those on the folder directly.
    // Count only PUBLISHED exams — drafts are never shown to clients (see the
    // listing in categories.controller / exam.controller), so counting them
    // would overstate the badge.
    const counts = await Promise.all(
      cats.map(async (c: any) => {
        const ids = await collectCategoryTreeIds(ExamCategory, c);
        return Exam.countDocuments({ categoryId: { $in: ids }, status: ExamStatus.PUBLISHED });
      })
    );

    const list = cats.map((cat: any, i: number) => ({
      category: {
        ...cat,
        title: cat.name,
        havingChildDirectory: (cat.childCategoryIds?.length ?? 0) > 0,
        count: counts[i],
      },
    }));
    const totalItems = counts.reduce((n, c) => n + c, 0);

    logger.info("getCatalogTests success", { traceId, type, id, groups: list.length });
    return success(
      res,
      {
        parent: { _id: id, type, name: parent.name },
        list,
        totals: { categories: list.length, items: totalItems },
      },
      "Test categories fetched."
    );
  } catch (err) {
    logger.error("getCatalogTests failed", { traceId, type, id, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch test categories.", 500);
  }
};
