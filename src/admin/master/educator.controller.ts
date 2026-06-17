import { Request, Response } from "express";
import mongoose from "mongoose";
import { CourseEducator } from "../../models/course/CourseEducator.model";
import { Course } from "../../models/course/Course.model";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { LiveSession } from "../../models/course/LiveSession.model";
import { Package } from "../../models/course/Package.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { LiveCourseSubscription } from "../../models/customer/LiveCourseSubscription.model";
import { createEducatorSchema, updateEducatorSchema } from "./master.validation";
import { buildSearchFilter } from "../../utils/searchFilter";
import bcrypt from "bcryptjs";
import { isMysqlModule } from "../../config/migration";
import { educatorAuthRepository as eduRepo } from "../../modules/educator-auth/educator-auth.repository";
import { toEducatorListDto } from "../../modules/educator-auth/educator-auth.transformer";

const EDUCATOR_SORT_FIELDS = new Set(["createdAt", "updatedAt", "name", "email"]);
// Admin educator master shares the educator-auth migration flag.
const MODULE = "educator-auth";

const parseEducatorIntId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const parseEducatorStatus = (status?: string): boolean | undefined => {
  if (status === "true" || status === "active") return true;
  if (status === "false" || status === "inactive") return false;
  return undefined;
};

export const getEducators = async (req: Request, res: Response) => {
  try {
    const {
      search,
      status,
      sortBy,
      sortOrder,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const sortField = sortBy && EDUCATOR_SORT_FIELDS.has(sortBy) ? sortBy : "createdAt";

    // ─── MySQL branch (ws_course_educator) ────────────────────────────────
    if (isMysqlModule(MODULE)) {
      const statusFilter = parseEducatorStatus(status);
      const sortDirSql = sortOrder === "asc" ? "asc" : "desc";
      const [rows, total] = await Promise.all([
        eduRepo.listAdmin({
          search,
          status: statusFilter,
          sortBy: sortField,
          sortDir: sortDirSql,
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        eduRepo.countAdmin({ search, status: statusFilter }),
      ]);
      return res.status(200).json({
        success: true,
        data: rows.map(toEducatorListDto),
        pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
      });
    }

    // Soft-deleted educators are never listed.
    const filters: any = { deleted: false };

    Object.assign(filters, buildSearchFilter(search, ["name", "email"]));
    // status maps to the boolean `status` field; accept both label and boolean forms.
    if (status === "true" || status === "active") filters.status = true;
    else if (status === "false" || status === "inactive") filters.status = false;

    const skip = (pageNum - 1) * limitNum;

    const sortDir = sortOrder === "asc" ? 1 : -1;

    const [data, total] = await Promise.all([
      CourseEducator.find(filters)
        .sort({ [sortField]: sortDir })
        .skip(skip)
        .limit(limitNum),
      CourseEducator.countDocuments(filters),
    ]);

    res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createEducator = async (req: Request, res: Response) => {
  try {
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
    const validatedData = createEducatorSchema.parse(req.body);

    // ─── MySQL branch (ws_course_educator) ────────────────────────────────
    if (isMysqlModule(MODULE)) {
      if (await eduRepo.emailInUse(validatedData.email)) {
        return res.status(409).json({ success: false, message: "Educator with this email already exists." });
      }
      // password column is NOT NULL; hash when provided, else store "" (no login).
      const password = validatedData.password
        ? await bcrypt.hash(validatedData.password, 10)
        : "";
      const created = await eduRepo.createAdmin({
        name: validatedData.name,
        email: validatedData.email,
        password,
        image: validatedData.image,
        about: validatedData.about,
        status: validatedData.status,
      });
      return res.status(201).json({ success: true, data: toEducatorListDto(created) });
    }

    const educator = new CourseEducator(validatedData);
    await educator.save();
    res.status(201).json({ success: true, data: educator });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateEducator = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
    const validatedData = updateEducatorSchema.parse(req.body);

    // ─── MySQL branch (ws_course_educator) ────────────────────────────────
    if (isMysqlModule(MODULE)) {
      const numId = parseEducatorIntId(id);
      if (!numId) return res.status(400).json({ success: false, message: "Invalid Educator ID" });
      const existing = await eduRepo.findById(numId);
      if (!existing) return res.status(404).json({ success: false, message: "Educator not found" });

      if (validatedData.email && (await eduRepo.emailInUse(validatedData.email, numId))) {
        return res.status(409).json({ success: false, message: "Email already in use." });
      }
      const password = validatedData.password
        ? await bcrypt.hash(validatedData.password, 10)
        : undefined;
      const updated = await eduRepo.updateAdmin(numId, {
        name: validatedData.name,
        email: validatedData.email,
        password,
        image: validatedData.image,
        about: validatedData.about,
        status: validatedData.status,
      });
      return res.status(200).json({ success: true, data: toEducatorListDto(updated) });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Educator ID" });
    }
    // Mongo `image` is required:true → represent "cleared" as "" (null would
    // fail validation). SQL branch keeps true null since that column is nullable.
    const mongoUpdate =
      validatedData.image === null ? { ...validatedData, image: "" } : validatedData;
    const educator = await CourseEducator.findByIdAndUpdate(id, mongoUpdate, { new: true });
    if (!educator) return res.status(404).json({ success: false, message: "Educator not found" });
    res.status(200).json({ success: true, data: educator });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Educator Details (aggregate for admin detail page) ──────────────────────

export const getEducatorDetails = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    // ─── MySQL branch (ws_course_educator) ────────────────────────────────
    // Profile from SQL; course/live-course/package/session associations depend
    // on models not yet migrated, so they return empty until those land.
    if (isMysqlModule(MODULE)) {
      const numId = parseEducatorIntId(id);
      if (!numId) return res.status(400).json({ success: false, message: "Invalid Educator ID" });
      const row = await eduRepo.findById(numId);
      if (!row) return res.status(404).json({ success: false, message: "Educator not found" });
      return res.status(200).json({
        success: true,
        data: {
          profile: toEducatorListDto(row),
          associations: {
            courses: [], liveCourses: [], liveCourseFolders: [],
            liveSessions: [], videoCategories: [], packages: [],
          },
          summary: {
            totals: { courses: 0, liveCourses: 0, liveCourseFolders: 0, liveSessions: 0, videoCategories: 0, packages: 0 },
            active: { courses: 0, liveCourses: 0, packages: 0 },
            totalSubscribers: 0,
            totalSessionsConducted: 0,
          },
        },
      });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Educator ID" });
    }

    const educator = await CourseEducator.findOne({ _id: id, deleted: false }).select("-password");
    if (!educator) return res.status(404).json({ success: false, message: "Educator not found" });

    const educatorObjectId = new mongoose.Types.ObjectId(id);

    const [
      courses,
      liveCourses,
      videoCategoryDocs,
      liveSessions,
      packages,
    ] = await Promise.all([
      Course.find({ courseEducatorId: educatorObjectId })
        .select("_id name image level isPaid isPopular status ordered createdAt")
        .sort({ createdAt: -1 }),
      LiveCourse.find({ courseEducatorId: educatorObjectId })
        .select("_id name image level classType isPaid isPopular status ordered createdAt")
        .sort({ createdAt: -1 }),
      VideoCategory.find({ educatorId: educatorObjectId })
        .select("_id title slug image status order_by courseId liveCourseId createdAt")
        .populate("liveCourseId", "_id name")
        .sort({ createdAt: -1 }),
      LiveSession.find({ educatorId: educatorObjectId })
        .select("_id title subject status scheduledAt endAt liveCourseIds createdAt")
        .populate("liveCourseIds", "_id name")
        .sort({ createdAt: -1 }),
      Package.find({ educatorId: educatorObjectId })
        .select("_id name image isPaid status active order createdAt")
        .sort({ createdAt: -1 }),
    ]);

    // Split VideoCategory docs into "live course folders" vs root "video categories"
    const liveCourseFolders = videoCategoryDocs
      .filter((v: any) => v.liveCourseId)
      .map((v: any) => v.toObject());
    const videoCategories = videoCategoryDocs
      .filter((v: any) => !v.liveCourseId)
      .map((v: any) => v.toObject());

    // Subscriber counts (verified + active) — parallel
    const [courseSubCounts, liveCourseSubCounts, packageSubCounts] = await Promise.all([
      Promise.all(
        courses.map((c: any) =>
          PackageCourseSubscription.countDocuments({
            courseId: c._id,
            paymentStatus: "verified",
            status: true,
          })
        )
      ),
      Promise.all(
        liveCourses.map((lc: any) =>
          LiveCourseSubscription.countDocuments({
            liveCourseId: lc._id,
            paymentStatus: "verified",
            status: true,
          })
        )
      ),
      Promise.all(
        packages.map((p: any) =>
          PackageCourseSubscription.countDocuments({
            targetPackageId: p._id,
            paymentStatus: "verified",
            status: true,
          })
        )
      ),
    ]);

    const coursesOut = courses.map((c: any, i: number) => ({
      ...c.toObject(),
      subscribersCount: courseSubCounts[i],
    }));
    const liveCoursesOut = liveCourses.map((lc: any, i: number) => ({
      ...lc.toObject(),
      subscribersCount: liveCourseSubCounts[i],
    }));
    const packagesOut = packages.map((p: any, i: number) => ({
      ...p.toObject(),
      subscribersCount: packageSubCounts[i],
    }));

    const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

    const summary = {
      totals: {
        courses: coursesOut.length,
        liveCourses: liveCoursesOut.length,
        liveCourseFolders: liveCourseFolders.length,
        liveSessions: liveSessions.length,
        videoCategories: videoCategories.length,
        packages: packagesOut.length,
      },
      active: {
        courses: coursesOut.filter((c: any) => c.status).length,
        liveCourses: liveCoursesOut.filter((c: any) => c.status).length,
        packages: packagesOut.filter((p: any) => p.status).length,
      },
      totalSubscribers: sum(courseSubCounts) + sum(liveCourseSubCounts) + sum(packageSubCounts),
      totalSessionsConducted: liveSessions.filter((s: any) => s.status === "ENDED").length,
    };

    return res.status(200).json({
      success: true,
      data: {
        profile: educator.toObject(),
        associations: {
          courses: coursesOut,
          liveCourses: liveCoursesOut,
          liveCourseFolders,
          liveSessions: liveSessions.map((s: any) => s.toObject()),
          videoCategories,
          packages: packagesOut,
        },
        summary,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteEducator = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    // ─── MySQL branch (ws_course_educator) ────────────────────────────────
    if (isMysqlModule(MODULE)) {
      const numId = parseEducatorIntId(id);
      if (!numId) return res.status(400).json({ success: false, message: "Invalid Educator ID" });
      const existing = await eduRepo.findById(numId);
      if (!existing) return res.status(404).json({ success: false, message: "Educator not found" });
      // No `deleted` column in SQL → disable + revoke tokens, retain the row.
      await eduRepo.disableAdmin(numId);
      return res.status(200).json({ success: true, message: "Educator deleted successfully" });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Educator ID" });
    }
    // Soft delete: retain the row so existing course/live-course
    // `courseEducatorId` references still resolve to the educator's name, but
    // mark it deleted + disabled so it's hidden from the educator list/detail.
    // The partial unique index frees the email for reuse.
    const educator = await CourseEducator.findOneAndUpdate(
      { _id: id, deleted: false },
      { $set: { deleted: true, status: false } },
      { new: true }
    );
    if (!educator) return res.status(404).json({ success: false, message: "Educator not found" });
    res.status(200).json({ success: true, message: "Educator deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
