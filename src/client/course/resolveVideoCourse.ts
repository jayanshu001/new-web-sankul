import { Types } from "mongoose";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { VideoCategoryRelation } from "../../models/course/VideoCategoryRelation.model";
import { Course } from "../../models/course/Course.model";

/**
 * Resolve the owning Course of a recorded video, robust to how the
 * category hierarchy happens to be represented.
 *
 * The Course ⇄ VideoCategory link can be expressed in several ways across the
 * data, and a video frequently lives under a *child* video category whose own
 * `courseId` is null while the actual course link sits on an ancestor — or only
 * on the Course document's downward `videoCategoryId` pointer. Reading just the
 * leaf category's `courseId` (the old behaviour) therefore wrongly reports
 * "not attached to a course" for videos that genuinely belong to one.
 *
 * Resolution order (first hit wins):
 *   1. leaf VideoCategory.courseId
 *   2. any ancestor VideoCategory.courseId (walk parents via relation rows)
 *   3. Course.videoCategoryId pointing down at the leaf or any ancestor
 *
 * Returns the courseId or null if the video truly belongs to no course.
 */
export async function resolveVideoCourseId(
  videoCategoryId: Types.ObjectId | null | undefined
): Promise<Types.ObjectId | null> {
  if (!videoCategoryId) return null;

  // 1. Leaf category.
  const leaf = await VideoCategory.findById(videoCategoryId)
    .select("courseId")
    .lean();
  if (leaf?.courseId) return leaf.courseId as Types.ObjectId;

  // Build the ancestor chain (leaf + parents) via relation rows. Bounded walk.
  const ancestorIds: Types.ObjectId[] = [videoCategoryId];
  let cursorIds: Types.ObjectId[] = [videoCategoryId];
  for (let depth = 0; depth < 5 && cursorIds.length; depth++) {
    const parents = await VideoCategoryRelation.find({ child: { $in: cursorIds } })
      .select("parent")
      .lean();
    cursorIds = parents.map((p) => p.parent as Types.ObjectId);
    for (const pid of cursorIds) ancestorIds.push(pid);
  }

  // 2. Any ancestor that carries a courseId.
  if (ancestorIds.length > 1) {
    const ancestorWithCourse = await VideoCategory.findOne({
      _id: { $in: ancestorIds },
      courseId: { $ne: null },
    })
      .select("courseId")
      .lean();
    if (ancestorWithCourse?.courseId)
      return ancestorWithCourse.courseId as Types.ObjectId;
  }

  // 3. Authoritative downward pointer: a Course points at its root video
  //    category via Course.videoCategoryId. This is the link the course-detail
  //    screen uses, and the only one present when the category tree itself
  //    carries no courseId and relation rows are absent.
  const owningCourse = await Course.findOne({
    videoCategoryId: { $in: ancestorIds },
    status: true,
  })
    .select("_id")
    .lean();
  if (owningCourse?._id) return owningCourse._id as Types.ObjectId;

  return null;
}
