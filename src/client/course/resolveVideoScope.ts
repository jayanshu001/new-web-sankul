import { Types } from "mongoose";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { VideoCategoryRelation } from "../../models/course/VideoCategoryRelation.model";
import { Course } from "../../models/course/Course.model";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { Package } from "../../models/course/Package.model";
import { PackageVideoCategoryRelation } from "../../models/course/PackageVideoCategoryRelation.model";

// The progress heartbeat (POST /courses/lectures/:videoId/progress) stores a
// row per (customer, video, CONTAINER), so every call must say which product
// the user is watching from via `scope: { kind, id }`. A video listing returns
// only the category — not the owning container — so the FE was left to guess
// the scope and could send the wrong one (e.g. "package" for a video that
// actually lives in a course), which the heartbeat then correctly rejects with
// "Video is not part of the scoped <kind>".
//
// This resolver hands the FE the authoritative scope to echo straight back, so
// the guess is eliminated. It mirrors the SAME linkage forms the heartbeat's
// reachability checks accept, walking leaf + ancestors and trying each
// container type in priority order: course → liveCourse → package. Returns null
// only when the category genuinely belongs to no container (an orphan).

export type VideoScopeKind = "course" | "liveCourse" | "package";
export interface VideoScope {
  kind: VideoScopeKind;
  id: string;
}

// Builds the bounded ancestor chain (leaf + parents) for a video category.
async function ancestorChain(
  videoCategoryId: Types.ObjectId
): Promise<Types.ObjectId[]> {
  const ancestorIds: Types.ObjectId[] = [videoCategoryId];
  let cursorIds: Types.ObjectId[] = [videoCategoryId];
  for (let depth = 0; depth < 5 && cursorIds.length; depth++) {
    const parents = await VideoCategoryRelation.find({ child: { $in: cursorIds } })
      .select("parent")
      .lean();
    cursorIds = parents.map((p) => p.parent as Types.ObjectId);
    for (const pid of cursorIds) ancestorIds.push(pid);
  }
  return ancestorIds;
}

export async function resolveVideoScope(
  videoCategoryId: Types.ObjectId | string | null | undefined
): Promise<VideoScope | null> {
  if (!videoCategoryId) return null;
  const catOid =
    typeof videoCategoryId === "string"
      ? new Types.ObjectId(videoCategoryId)
      : videoCategoryId;

  const ancestorIds = await ancestorChain(catOid);

  // ── Course ──────────────────────────────────────────────────────────────
  // (a) leaf/ancestor carries courseId, or (b) a Course points down at one of
  // them via Course.videoCategoryId.
  const [catWithCourse, owningCourse] = await Promise.all([
    VideoCategory.findOne({ _id: { $in: ancestorIds }, courseId: { $ne: null } })
      .select("courseId")
      .lean<any>(),
    Course.findOne({ videoCategoryId: { $in: ancestorIds }, status: true })
      .select("_id")
      .lean<any>(),
  ]);
  if (catWithCourse?.courseId) return { kind: "course", id: String(catWithCourse.courseId) };
  if (owningCourse?._id) return { kind: "course", id: String(owningCourse._id) };

  // ── Live course ─────────────────────────────────────────────────────────
  // (a) leaf/ancestor carries liveCourseId, or (b) a LiveCourse points down at
  // one of them via LiveCourse.videoCategoryId.
  const [catWithLive, owningLive] = await Promise.all([
    VideoCategory.findOne({ _id: { $in: ancestorIds }, liveCourseId: { $ne: null } })
      .select("liveCourseId")
      .lean<any>(),
    LiveCourse.findOne({ videoCategoryId: { $in: ancestorIds }, status: true })
      .select("_id")
      .lean<any>(),
  ]);
  if (catWithLive?.liveCourseId) return { kind: "liveCourse", id: String(catWithLive.liveCourseId) };
  if (owningLive?._id) return { kind: "liveCourse", id: String(owningLive._id) };

  // ── Package ───────────────────────────────────────────────────────────────
  // (a) direct Package.specificSubjects[].category link, or (b) the expanded
  // PackageVideoCategoryRelation tree (either endpoint of a stored relation).
  const directPkg = await Package.findOne({
    "specificSubjects.category": { $in: ancestorIds },
    active: true,
  })
    .select("_id")
    .lean<any>();
  if (directPkg?._id) return { kind: "package", id: String(directPkg._id) };

  const relRows = await VideoCategoryRelation.find({
    $or: [{ child: { $in: ancestorIds } }, { parent: { $in: ancestorIds } }],
  })
    .select("_id")
    .lean();
  if (relRows.length) {
    const pkgRel = await PackageVideoCategoryRelation.findOne({
      videoCategoryRelationId: { $in: relRows.map((r) => r._id) },
      active: true,
    })
      .select("packageId")
      .lean<any>();
    if (pkgRel?.packageId) return { kind: "package", id: String(pkgRel.packageId) };
  }

  return null;
}
