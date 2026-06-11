import mongoose from "mongoose";
import { Material } from "../../models/course/Material.model";
import { MaterialCategory } from "../../models/course/MaterialCategory.model";
import { Course } from "../../models/course/Course.model";
import { Package } from "../../models/course/Package.model";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { LiveCourseSubscription } from "../../models/customer/LiveCourseSubscription.model";
import { buildRegexCondition } from "../../utils/searchFilter";

type Id = mongoose.Types.ObjectId | string;

// Materials never carry their owning container directly — a Material → its
// MaterialCategory, and Course / Package / LiveCourse each embed a
// `materialCategories[].category` array pointing back. So "does this user own
// this material" resolves as:
//
//   material.materialCategoryId (+ its ancestors)
//     → containers whose materialCategories.category ∈ that set
//       → an active, verified subscription to ANY such container
//
// Both recorded (Course/Package via PackageCourseSubscription) and live
// (LiveCourse via LiveCourseSubscription) containers count — buying the
// material under any of them unlocks it. Ancestor folders count too: owning a
// container attached to a parent category unlocks materials in its sub-folders.
// Mirrors the access model used by the live-course endpoints
// (hasAccessToAnyLiveCourse).

// Expand a set of category ids to include every ancestor, so a purchase at a
// parent folder unlocks deeper materials. One query over MaterialCategory.
async function expandWithAncestors(categoryIds: Id[]): Promise<Set<string>> {
  const out = new Set<string>(categoryIds.map(String));
  if (categoryIds.length === 0) return out;
  const cats = await MaterialCategory.find({ _id: { $in: categoryIds } })
    .select("ancestors")
    .lean();
  for (const c of cats as any[]) {
    for (const a of c.ancestors ?? []) out.add(String(a));
  }
  return out;
}

/**
 * Resolve, for a batch of materials, which the given customer has access to via
 * a purchased container. Returns a Set of material ids (string) the user owns.
 *
 * Free materials (isPaid:false) are NOT included here — callers treat those as
 * always accessible regardless of this set. Guests (no customerId) own nothing.
 */
export async function getPurchasedMaterialIds(
  customerId: string | undefined,
  materials: Array<{ _id: Id; materialCategoryId: Id; isPaid?: boolean }>
): Promise<Set<string>> {
  const owned = new Set<string>();
  if (!customerId || materials.length === 0) return owned;

  // Only paid materials can be "purchased"; free ones are handled by the caller.
  const paid = materials.filter((m) => m.isPaid);
  if (paid.length === 0) return owned;

  const leafCategoryIds = Array.from(
    new Set(paid.map((m) => String(m.materialCategoryId)))
  ).map((s) => new mongoose.Types.ObjectId(s));

  // The full category universe (leaves + ancestors) that could grant access.
  const categoryUniverse = await expandWithAncestors(leafCategoryIds);
  const universeIds = Array.from(categoryUniverse).map(
    (s) => new mongoose.Types.ObjectId(s)
  );

  // Find every container that attaches one of those categories.
  const [courses, packages, liveCourses] = await Promise.all([
    Course.find({ "materialCategories.category": { $in: universeIds } })
      .select("_id materialCategories.category")
      .lean(),
    Package.find({ "materialCategories.category": { $in: universeIds } })
      .select("_id materialCategories.category")
      .lean(),
    LiveCourse.find({ "materialCategories.category": { $in: universeIds } })
      .select("_id materialCategories.category")
      .lean(),
  ]);

  // Which of those containers does the customer actually hold an active,
  // verified subscription to? Same predicate the live-course entitlement uses.
  const now = new Date();
  const courseIds = courses.map((c: any) => c._id);
  const packageIds = packages.map((p: any) => p._id);
  const liveCourseIds = liveCourses.map((l: any) => l._id);

  const [ownedCourseRows, ownedPackageRows, ownedLiveRows] = await Promise.all([
    courseIds.length
      ? PackageCourseSubscription.find({
          customerId,
          courseId: { $in: courseIds },
          status: true,
          paymentStatus: "verified",
          $or: [{ endAt: null }, { endAt: { $gte: now } }],
        })
          .select("courseId")
          .lean()
      : Promise.resolve([]),
    packageIds.length
      ? PackageCourseSubscription.find({
          customerId,
          targetPackageId: { $in: packageIds },
          status: true,
          paymentStatus: "verified",
          $or: [{ endAt: null }, { endAt: { $gte: now } }],
        })
          .select("targetPackageId")
          .lean()
      : Promise.resolve([]),
    liveCourseIds.length
      ? LiveCourseSubscription.find({
          customerId,
          liveCourseId: { $in: liveCourseIds },
          status: true,
          paymentStatus: "verified",
          $or: [{ endAt: null }, { endAt: { $gte: now } }],
        })
          .select("liveCourseId")
          .lean()
      : Promise.resolve([]),
  ]);

  // The set of categories the customer has unlocked, via any owned container.
  const ownedContainerIds = new Set<string>([
    ...ownedCourseRows.map((r: any) => String(r.courseId)),
    ...ownedPackageRows.map((r: any) => String(r.targetPackageId)),
    ...ownedLiveRows.map((r: any) => String(r.liveCourseId)),
  ]);

  const unlockedCategories = new Set<string>();
  const collect = (rows: any[], idField: string) => {
    for (const c of rows) {
      if (!ownedContainerIds.has(String(c[idField] ?? c._id))) continue;
      for (const ref of c.materialCategories ?? []) {
        if (ref?.category) unlockedCategories.add(String(ref.category));
      }
    }
  };
  collect(courses, "_id");
  collect(packages, "_id");
  collect(liveCourses, "_id");

  // A material is owned if its category OR any of its ancestors is unlocked.
  // Re-fetch each paid material's ancestor chain to test membership.
  const ancestorsByCategory = new Map<string, Set<string>>();
  const catDocs = await MaterialCategory.find({ _id: { $in: leafCategoryIds } })
    .select("_id ancestors")
    .lean();
  for (const c of catDocs as any[]) {
    const chain = new Set<string>([String(c._id), ...(c.ancestors ?? []).map(String)]);
    ancestorsByCategory.set(String(c._id), chain);
  }

  for (const m of paid) {
    const chain = ancestorsByCategory.get(String(m.materialCategoryId));
    if (!chain) continue;
    for (const cat of chain) {
      if (unlockedCategories.has(cat)) {
        owned.add(String(m._id));
        break;
      }
    }
  }

  return owned;
}

/**
 * Display + access shaping for a client-facing material row, shared by every
 * client endpoint that returns materials. `isPaid` is always surfaced;
 * `isPurchased` reflects per-user entitlement (free → always true). For paid
 * materials the user hasn't purchased, the actual file/directLink are withheld
 * here — this is the server-side enforcement point, NOT the FE flag.
 */
export function shapeMaterialForClient(m: any, ownedIds: Set<string>) {
  const obj = typeof m.toObject === "function" ? m.toObject() : m;
  const isPaid = !!obj.isPaid;
  const isPurchased = !isPaid || ownedIds.has(String(obj._id));
  const gated = isPaid && !isPurchased;
  return {
    ...obj,
    isPaid,
    isPurchased,
    file: gated ? "" : obj.file ?? "",
    directLink: gated ? "" : obj.directLink ?? "",
  };
}

/**
 * Fetch the materials attached DIRECTLY to a single category (not its subtree)
 * and shape them for the client (isPaid/isPurchased + gated file/directLink).
 * Shared by the category-listing endpoints that inline a category's own
 * materials alongside its child folders. Returns [] when the category has none.
 *
 * `search` (optional) filters by title, mirroring the standalone materials
 * listing. Sort matches `listMaterialsByCategory` (order asc, then newest).
 */
export async function listDirectMaterialsForCategory(
  categoryId: Id,
  customerId: string | undefined,
  search?: string
): Promise<ReturnType<typeof shapeMaterialForClient>[]> {
  const filter: any = { materialCategoryId: categoryId, status: true };
  { const c = buildRegexCondition(search); if (c) filter.title = c; }
  const rawList = await Material.find(filter).sort({ order: 1, createdAt: -1 }).lean();
  if (rawList.length === 0) return [];
  const ownedIds = await getPurchasedMaterialIds(customerId, rawList as any);
  return rawList.map((m) => shapeMaterialForClient(m, ownedIds));
}

/**
 * Single-material convenience wrapper. `true` for any free material, otherwise
 * whether the customer has access via a purchased container.
 */
export async function isMaterialPurchased(
  customerId: string | undefined,
  material: { _id: Id; materialCategoryId: Id; isPaid?: boolean }
): Promise<boolean> {
  if (!material.isPaid) return true;
  const owned = await getPurchasedMaterialIds(customerId, [material]);
  return owned.has(String(material._id));
}
