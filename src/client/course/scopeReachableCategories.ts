import { Types } from "mongoose";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { VideoCategoryRelation } from "../../models/course/VideoCategoryRelation.model";
import { PackageVideoCategoryRelation } from "../../models/course/PackageVideoCategoryRelation.model";
import { Package } from "../../models/course/Package.model";
import { Course } from "../../models/course/Course.model";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { LectureProgress } from "../../models/customer/LectureProgress.model";
import { collectCategoryTreeIds } from "../../utils/categoryTree";

/**
 * Resolve the FULL set of video-category ids reachable from ONE specific
 * product (course / package / live course).
 *
 * Why this exists: the catalog endpoints (free.controller, catalog.controller)
 * decide "is this video listed under this product?" by walking the category
 * tree DOWNWARD off each linked root via `VideoCategory.childCategoryIds`
 * (collectCategoryTreeIds). The progress controller historically answered the
 * SAME question a different way — walking UPWARD from the video's leaf via
 * `VideoCategoryRelation` (child→parent) rows. The two representations are not
 * always kept in sync, so a video linked to MORE THAN ONE product (its second
 * linkage typically expressed only through nested `childCategoryIds`) would be
 * LISTED by the catalog yet REJECTED by the heartbeat with
 * "Video is not part of the scoped <product>." — a false 400.
 *
 * This resolver makes the heartbeat ask the exact question the catalog answers,
 * using the catalog's own tree model, so the invariant holds:
 *   if a video is listed under a product, its progress is accepted there.
 *
 * Returns a Set of stringified category ids (the linked roots PLUS every
 * descendant). Membership test: does the video's leaf category id appear here?
 */
export async function resolveScopedReachableVideoCategoryIds(
  kind: "course" | "package" | "liveCourse",
  scopeId: Types.ObjectId
): Promise<Set<string>> {
  // The linked "roots" — the category ids this product attaches directly,
  // before downward subtree expansion. Collected per product kind, mirroring
  // exactly how the catalog gathers them.
  const rootIds = new Set<string>();

  if (kind === "course") {
    // (a) the course's downward root pointer, and
    // (b) any category that carries this courseId.
    const [course, taggedCats] = await Promise.all([
      Course.findOne({ _id: scopeId, status: true })
        .select("videoCategoryId")
        .lean<any>(),
      VideoCategory.find({ courseId: scopeId }).select("_id").lean(),
    ]);
    if (course?.videoCategoryId) rootIds.add(String(course.videoCategoryId));
    for (const c of taggedCats as any[]) rootIds.add(String(c._id));
  } else if (kind === "liveCourse") {
    const [liveCourse, taggedCats] = await Promise.all([
      LiveCourse.findOne({ _id: scopeId, status: true })
        .select("videoCategoryId")
        .lean<any>(),
      VideoCategory.find({ liveCourseId: scopeId }).select("_id").lean(),
    ]);
    if (liveCourse?.videoCategoryId) rootIds.add(String(liveCourse.videoCategoryId));
    for (const c of taggedCats as any[]) rootIds.add(String(c._id));
  } else {
    // package — two linkage forms, matching free.controller / catalog:
    //   (a) embedded specificSubjects[].category (the linked subject roots), and
    //   (b) PackageVideoCategoryRelation → VideoCategoryRelation, BOTH endpoints
    //       (parent and child) of each stored relation count as a root.
    const [pkg, pkgRels] = await Promise.all([
      Package.findOne({ _id: scopeId, active: true })
        .select("specificSubjects")
        .lean<any>(),
      PackageVideoCategoryRelation.find({ packageId: scopeId, active: true })
        .select("videoCategoryRelationId")
        .lean(),
    ]);
    for (const s of pkg?.specificSubjects ?? []) {
      if (s?.category) rootIds.add(String(s.category));
    }
    if (pkgRels.length) {
      const relIds = (pkgRels as any[]).map((r) => r.videoCategoryRelationId);
      const vcRelations = await VideoCategoryRelation.find({ _id: { $in: relIds } })
        .select("parent child")
        .lean();
      for (const r of vcRelations as any[]) {
        if (r.parent) rootIds.add(String(r.parent));
        if (r.child) rootIds.add(String(r.child));
      }
    }
  }

  if (rootIds.size === 0) return new Set<string>();

  // Expand each linked root to its full subtree (videos attach to leaves, while
  // products link the root/an-ancestor folder). Identical to the catalog's
  // collectCategoryTreeIds expansion, so the reachable set matches by
  // construction.
  const reachable = new Set<string>();
  const roots = await VideoCategory.find({
    _id: { $in: [...rootIds].map((id) => new Types.ObjectId(id)) },
  })
    .select("_id childCategoryIds")
    .lean();
  for (const root of roots as any[]) {
    const ids = await collectCategoryTreeIds(VideoCategory as any, root);
    for (const id of ids) reachable.add(String(id));
  }
  return reachable;
}

/**
 * Find the package a customer can "resume from" for a given recorded video that
 * belongs to no single Course but lives inside one or more packages.
 *
 * A `resumeNext` card means "resume what you were watching", so we pick the
 * package using the strongest available signal, in order:
 *   1. PROGRESS — a LectureProgress row this customer already has scoped to a
 *      package (packageId set). That row IS the thing to resume, so it wins even
 *      if the sub has since lapsed (the card then just shows daysLeft via the
 *      sub lookup in the caller). Most recent watch wins.
 *   2. SUBSCRIPTION — failing any progress, an ACTIVE verified package sub whose
 *      package actually reaches the video (longest-running entitlement first).
 *   3. otherwise null — nothing watched and nothing entitled ⇒ no honest card.
 *
 * Reachability uses the same downward childCategoryIds model as the catalog, so
 * "is this video in that package?" matches what the catalog listed.
 *
 * Returns { packageId, endAt } (endAt null when chosen via progress with no
 * active sub) or null.
 */
export async function resolveSubscribedPackageForVideo(
  customerId: Types.ObjectId,
  videoCategoryId: Types.ObjectId | null | undefined,
  videoId: Types.ObjectId,
  now: Date
): Promise<{ packageId: Types.ObjectId; endAt: Date | null } | null> {
  if (!videoCategoryId) return null;
  const leaf = String(videoCategoryId);

  // 1. Progress-first: the package(s) the customer has actually watched THIS
  //    video from. Strongest "resume" signal — no reachability check needed, the
  //    row already proves the linkage. Most recently watched wins.
  const progressRow = await LectureProgress.findOne({
    customerId,
    videoId,
    packageId: { $ne: null },
  })
    .sort({ lastWatchedAt: -1 })
    .select("packageId")
    .lean<any>();
  if (progressRow?.packageId) {
    // Surface the active sub's endAt if one exists (so daysLeft is accurate),
    // but don't require it — a lapsed package still has resumable progress.
    const sub = await PackageCourseSubscription.findOne({
      customerId,
      targetPackageId: progressRow.packageId,
      status: true,
      paymentStatus: "verified",
      endAt: { $gt: now },
    })
      .select("endAt")
      .lean<any>();
    return { packageId: progressRow.packageId as Types.ObjectId, endAt: sub?.endAt ?? null };
  }

  // 2. Subscription-based disambiguation: no progress yet, so fall back to an
  //    active entitlement whose package reaches the video. Longest-running first.
  const subs = await PackageCourseSubscription.find({
    customerId,
    targetPackageId: { $ne: null },
    status: true,
    paymentStatus: "verified",
    endAt: { $gt: now },
  })
    .select("targetPackageId endAt")
    .lean<any>();
  if (!subs.length) return null;

  subs.sort(
    (a: any, b: any) =>
      new Date(b.endAt ?? 0).getTime() - new Date(a.endAt ?? 0).getTime()
  );

  for (const sub of subs) {
    const pkgId = sub.targetPackageId as Types.ObjectId;
    const reachable = await resolveScopedReachableVideoCategoryIds("package", pkgId);
    if (reachable.has(leaf)) {
      return { packageId: pkgId, endAt: sub.endAt ?? null };
    }
  }
  return null;
}
