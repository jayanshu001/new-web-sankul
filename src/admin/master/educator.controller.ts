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

export const getEducators = async (req: Request, res: Response) => {
  try {
    const educators = await CourseEducator.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: educators });
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
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Educator ID" });
    }
    const file = req.file as any;
    if (file?.location) req.body.image = file.location;
    if (typeof req.body.status === "string") req.body.status = req.body.status === "true";
    const validatedData = updateEducatorSchema.parse(req.body);
    const educator = await CourseEducator.findByIdAndUpdate(id, validatedData, { new: true });
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
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Educator ID" });
    }

    const educator = await CourseEducator.findById(id).select("-password");
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
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Educator ID" });
    }
    const educator = await CourseEducator.findByIdAndDelete(id);
    if (!educator) return res.status(404).json({ success: false, message: "Educator not found" });
    res.status(200).json({ success: true, message: "Educator deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
