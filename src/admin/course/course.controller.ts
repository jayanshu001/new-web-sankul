import { Request, Response } from "express";
import mongoose from "mongoose";
import { CourseEducator } from "../../models/course/CourseEducator.model";
import { CourseSubjectCategory } from "../../models/course/CourseSubjectCategory.model";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { PackageCourseMaterial } from "../../models/course/PackageCourseMaterial.model";
import { Course } from "../../models/course/Course.model";
import { PackageCourseEbookPrice } from "../../models/course/PackageCourseEbookPrice.model";
import { VideoCategoryRelation } from "../../models/course/VideoCategoryRelation.model";
import { createCourseSchema, createCoursePlanSchema, updateCoursePlanSchema } from "./course.validation";
import {
  createMaterialSchema,
  updateMaterialSchema,
  createVideoCategorySchema,
  updateVideoCategorySchema,
} from "../master/master.validation";

const mapPlanResponse = (plan: any) => ({
  id: plan._id,
  name: plan.name ?? null,
  duration: plan.duration,
  price: plan.price,
  withMaterial: plan.withMaterial,
  materialPrice: plan.materialPrice ?? 0,
  isDefault: plan.isDefault,
  status: plan.status,
  courseId: plan.courseId,
  createdAt: plan.createdAt,
  updatedAt: plan.updatedAt,
});

export const getPreRequisites = async (req: Request, res: Response) => {
  try {
    const [educators, subjectCategories, videoCategories, materials] = await Promise.all([
      // Some masters use `status`, while materials use `isActive`.
      CourseEducator.find({ status: true }).select("_id name"),
      CourseSubjectCategory.find({ status: true }).select("_id title"),
      VideoCategory.find({ status: true }).select("_id title"),
      PackageCourseMaterial.find({ isActive: true }).select("_id title"),
    ]);

    res.status(200).json({
      success: true,
      data: {
        educators: educators.map((e: any) => ({ _id: e._id, name: e.name })),
        subjectCategories: subjectCategories.map((s: any) => ({ _id: s._id, name: s.title })),
        videoCategories: videoCategories.map((v: any) => ({ _id: v._id, name: v.title })),
        materials: materials.map((m: any) => ({ _id: m._id, name: m.title })),
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getCourses = async (req: Request, res: Response) => {
  try {
    const {
      search = "",
      status,
      page = "1",
      limit = "10",
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query as Record<string, string>;

    const filters: any = {};
    if (search) {
      filters.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }
    if (status === "true" || status === "false") {
      filters.status = status === "true";
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 10, 1);
    const skip = (pageNum - 1) * limitNum;
    const sortDirection = sortOrder === "asc" ? 1 : -1;

    const [data, total] = await Promise.all([
      Course.find(filters)
        .populate("courseEducatorId", "_id name")
        .populate("courseSubjectCategoryId", "_id title")
        .populate("videoCategoryId", "_id title")
        .populate("pcMaterialId", "_id title")
        .sort({ [sortBy]: sortDirection })
        .skip(skip)
        .limit(limitNum),
      Course.countDocuments(filters),
    ]);

    return res.status(200).json({
      success: true,
      data,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getCourseById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Course ID" });
    }

    const [course, plans] = await Promise.all([
      Course.findById(id)
        .populate("courseEducatorId", "_id name")
        .populate("courseSubjectCategoryId", "_id title")
        .populate("videoCategoryId", "_id title")
        .populate("pcMaterialId", "_id title"),
      PackageCourseEbookPrice.find({ courseId: id }).sort({ isDefault: -1, createdAt: -1 }),
    ]);

    if (!course) {
      return res.status(404).json({ success: false, message: "Course not found" });
    }

    return res.status(200).json({
      success: true,
      data: {
        course,
        plans: plans.map(mapPlanResponse),
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getCourseVideoCategories = async (_req: Request, res: Response) => {
  try {
    const videoCategories = await VideoCategory.find({ status: true })
      .select("_id title slug image courseId order_by status")
      .sort({ order_by: 1, createdAt: -1 });

    return res.status(200).json({ success: true, data: videoCategories });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getCourseMaterials = async (_req: Request, res: Response) => {
  try {
    const materials = await PackageCourseMaterial.find()
      .select("_id title image isActive")
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, data: materials });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createCourseMaterial = async (req: Request, res: Response) => {
  try {
    const validatedData = createMaterialSchema.parse(req.body);
    const material = new PackageCourseMaterial(validatedData);
    await material.save();
    return res.status(201).json({ success: true, data: material });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateCourseMaterial = async (req: Request, res: Response) => {
  try {
    const validatedData = updateMaterialSchema.parse(req.body);
    const material = await PackageCourseMaterial.findByIdAndUpdate(req.params.materialId, validatedData, { new: true });
    if (!material) return res.status(404).json({ success: false, message: "Material not found" });
    return res.status(200).json({ success: true, data: material });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteCourseMaterial = async (req: Request, res: Response) => {
  try {
    const materialId = req.params.materialId as string;
    if (!mongoose.Types.ObjectId.isValid(materialId)) {
      return res.status(400).json({ success: false, message: "Invalid Material ID" });
    }

    const isUsed = await Course.exists({ pcMaterialId: materialId });
    if (isUsed) {
      return res.status(409).json({
        success: false,
        message: "Material is linked with one or more courses. Remove mapping first.",
      });
    }

    const material = await PackageCourseMaterial.findByIdAndDelete(materialId);
    if (!material) return res.status(404).json({ success: false, message: "Material not found" });
    return res.status(200).json({ success: true, message: "Material deleted successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createCourseVideoCategory = async (req: Request, res: Response) => {
  try {
    const validatedData = createVideoCategorySchema.parse(req.body);
    const category = new VideoCategory(validatedData);
    await category.save();
    return res.status(201).json({ success: true, data: category });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateCourseVideoCategory = async (req: Request, res: Response) => {
  try {
    const validatedData = updateVideoCategorySchema.parse(req.body);
    const category = await VideoCategory.findByIdAndUpdate(req.params.videoCategoryId, validatedData, { new: true });
    if (!category) return res.status(404).json({ success: false, message: "Video Category not found" });
    return res.status(200).json({ success: true, data: category });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteCourseVideoCategory = async (req: Request, res: Response) => {
  try {
    const videoCategoryId = req.params.videoCategoryId as string;
    if (!mongoose.Types.ObjectId.isValid(videoCategoryId)) {
      return res.status(400).json({ success: false, message: "Invalid Video Category ID" });
    }

    const isUsed = await Course.exists({ videoCategoryId });
    if (isUsed) {
      return res.status(409).json({
        success: false,
        message: "Video category is linked with one or more courses. Remove mapping first.",
      });
    }

    const category = await VideoCategory.findByIdAndDelete(videoCategoryId);
    if (!category) return res.status(404).json({ success: false, message: "Video Category not found" });
    return res.status(200).json({ success: true, message: "Video Category deleted successfully" });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createCourse = async (req: Request, res: Response) => {
  let session = null;
  try {
    session = await mongoose.startSession();
    session.startTransaction();

    const validatedData = createCourseSchema.parse(req.body);

    const newCourse = new Course(validatedData);
    await newCourse.save({ session });

    // Automatically create a default Video Category for the course if requested
    // This replicates the "Nested Folder Automation" from the plan
    const defaultFolder = new VideoCategory({
      title: `${newCourse.name} - Root`,
      slug: `${newCourse.name.toLowerCase().replace(/ /g, "-")}-root`,
      image: newCourse.image,
      courseId: newCourse._id,
      order_by: 0,
    });
    await defaultFolder.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      success: true,
      message: "Course created successfully with default folder",
      data: { course: newCourse, folder: defaultFolder },
    });
  } catch (error: any) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateCourse = async (req: Request, res: Response) => {
  try {
    const validatedData = createCourseSchema.partial().parse(req.body);
    const id = req.params.id as string;
    const course = await Course.findByIdAndUpdate(id, validatedData, { new: true });
    if (!course) return res.status(404).json({ success: false, message: "Course not found" });
    res.status(200).json({ success: true, data: course });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteCourse = async (req: Request, res: Response) => {
  let session = null;
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Course ID" });
    }

    session = await mongoose.startSession();
    session.startTransaction();

    const course = await Course.findByIdAndDelete(id, { session });
    if (!course) return res.status(404).json({ success: false, message: "Course not found" });

    const [plansResult, foldersResult] = await Promise.all([
      PackageCourseEbookPrice.deleteMany({ courseId: id }, { session }),
      VideoCategory.deleteMany({ courseId: id }, { session }),
    ]);

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      success: true,
      message: "Course deleted successfully.",
      data: {
        deletedCourseId: id,
        deletedPlans: plansResult.deletedCount ?? 0,
        deletedCourseVideoCategories: foldersResult.deletedCount ?? 0,
      },
    });
  } catch (error: any) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createCoursePlan = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Course ID" });
    }

    const courseExists = await Course.findById(id);
    if (!courseExists) {
      return res.status(404).json({ success: false, message: "Course not found" });
    }

    const validatedData = createCoursePlanSchema.parse(req.body);
    const normalizedPayload = {
      ...validatedData,
      duration: validatedData.duration ?? validatedData.subscriptionDurationMonths,
    };

    const newPlan = new PackageCourseEbookPrice({
      courseId: courseExists._id,
      ...normalizedPayload
    });
    
    await newPlan.save();

    res.status(201).json({
      success: true,
      message: "Pricing plan created successfully",
      data: mapPlanResponse(newPlan),
    });
  } catch (error: any) {
    if (error.issues) {
      return res.status(400).json({ success: false, errors: error.issues });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getCoursePlans = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Course ID" });
    }

    const courseExists = await Course.findById(id).select("_id");
    if (!courseExists) {
      return res.status(404).json({ success: false, message: "Course not found" });
    }

    const plans = await PackageCourseEbookPrice.find({ courseId: id }).sort({ isDefault: -1, createdAt: -1 });
    return res.status(200).json({ success: true, data: plans.map(mapPlanResponse) });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getCoursePlanById = async (req: Request, res: Response) => {
  try {
    const id = req.params.planId as string;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid Plan ID" });
    }

    const plan = await PackageCourseEbookPrice.findById(id);
    if (!plan) {
      return res.status(404).json({ success: false, message: "Pricing plan not found" });
    }

    return res.status(200).json({ success: true, data: mapPlanResponse(plan) });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
export const updateCoursePlan = async (req: Request, res: Response) => {
  try {
    const id = req.params.planId as string;
    const validatedData = updateCoursePlanSchema.parse(req.body);
    const normalizedPayload = {
      ...validatedData,
      duration: validatedData.duration ?? validatedData.subscriptionDurationMonths,
    };
    const plan = await PackageCourseEbookPrice.findByIdAndUpdate(id, normalizedPayload, { new: true });
    if (!plan) return res.status(404).json({ success: false, message: "Pricing plan not found" });
    res.status(200).json({ success: true, data: mapPlanResponse(plan) });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteCoursePlan = async (req: Request, res: Response) => {
  try {
    const id = req.params.planId as string;
    const plan = await PackageCourseEbookPrice.findByIdAndDelete(id);
    if (!plan) return res.status(404).json({ success: false, message: "Pricing plan not found" });
    res.status(200).json({ success: true, message: "Pricing plan deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getVideoCategoryRelations = async (_req: Request, res: Response) => {
  try {
    const relations = await VideoCategoryRelation.find()
      .populate("parent", "_id title slug")
      .populate("child", "_id title slug")
      .sort({ order: 1, createdAt: -1 });

    return res.status(200).json({ success: true, data: relations });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createVideoCategoryRelation = async (req: Request, res: Response) => {
  try {
    const { parent, child, order = 0 } = req.body || {};
    if (!parent || !child) {
      return res.status(422).json({ success: false, message: "parent and child are required." });
    }
    if (!mongoose.Types.ObjectId.isValid(parent) || !mongoose.Types.ObjectId.isValid(child)) {
      return res.status(400).json({ success: false, message: "Invalid parent/child ID." });
    }
    if (String(parent) === String(child)) {
      return res.status(400).json({ success: false, message: "parent and child cannot be same." });
    }

    const [parentCategory, childCategory] = await Promise.all([
      VideoCategory.findById(parent).select("_id"),
      VideoCategory.findById(child).select("_id"),
    ]);
    if (!parentCategory || !childCategory) {
      return res.status(404).json({ success: false, message: "Parent or child category not found." });
    }

    const relation = await VideoCategoryRelation.create({ parent, child, order });
    return res.status(201).json({ success: true, data: relation });
  } catch (error: any) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: "Relation already exists." });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateVideoCategoryRelation = async (req: Request, res: Response) => {
  try {
    const relationId = req.params.relationId as string;
    if (!mongoose.Types.ObjectId.isValid(relationId)) {
      return res.status(400).json({ success: false, message: "Invalid relation ID." });
    }

    const { order } = req.body || {};
    const relation = await VideoCategoryRelation.findByIdAndUpdate(
      relationId,
      { order },
      { new: true }
    );
    if (!relation) {
      return res.status(404).json({ success: false, message: "Relation not found." });
    }
    return res.status(200).json({ success: true, data: relation });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteVideoCategoryRelation = async (req: Request, res: Response) => {
  try {
    const relationId = req.params.relationId as string;
    if (!mongoose.Types.ObjectId.isValid(relationId)) {
      return res.status(400).json({ success: false, message: "Invalid relation ID." });
    }

    const relation = await VideoCategoryRelation.findByIdAndDelete(relationId);
    if (!relation) {
      return res.status(404).json({ success: false, message: "Relation not found." });
    }
    return res.status(200).json({ success: true, message: "Relation deleted successfully." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
