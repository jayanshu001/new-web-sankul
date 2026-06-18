import { z } from "zod";

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId");

const categoryRefSchema = z.object({
  category: objectIdSchema,
  order: z.number().int().nonnegative().optional(),
});

export const createCourseSchema = z.object({
  name: z.string().min(1, "Name is required"),
  subtitle: z.string().optional(),
  description: z.string().min(1, "Description is required"),
  image: z.string().url("Image must be a valid URL"),
  ordered: z.number().int("Ordered must be an integer"),
  shareableLink: z.string().optional(),
  withMaterial: z.string().optional(),
  withoutMaterial: z.string().optional(),
  level: z.string().min(1, "Level is required"),
  status: z.boolean(),
  isPaid: z.boolean().optional(),
  isPopular: z.boolean().optional(),
  courseEducatorId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId").optional(),
  courseSubjectCategoryId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId").optional(),
  videoCategoryId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId").optional(),
  materialCategories: z.array(categoryRefSchema).optional(),
  examCategories: z.array(categoryRefSchema).optional(),
});

// SQL branch: ids are numeric (the Mongo schema enforces ObjectId). Same shape.
const sqlCategoryRefSchema = z.object({
  category: z.coerce.number().int().positive(),
  order: z.coerce.number().int().nonnegative().optional(),
});

export const createCourseSqlSchema = z.object({
  name: z.string().min(1, "Name is required"),
  subtitle: z.string().optional(),
  description: z.string().min(1, "Description is required"),
  image: z.string().url("Image must be a valid URL"),
  ordered: z.coerce.number().int("Ordered must be an integer"),
  shareableLink: z.string().optional(),
  withMaterial: z.string().optional(),
  withoutMaterial: z.string().optional(),
  level: z.string().min(1, "Level is required"),
  status: z.boolean(),
  isPaid: z.boolean().optional(),
  isPopular: z.boolean().optional(),
  courseEducatorId: z.coerce.number().int().positive().optional(),
  courseSubjectCategoryId: z.coerce.number().int().positive().optional(),
  videoCategoryId: z.coerce.number().int().positive().optional(),
  materialCategories: z.array(sqlCategoryRefSchema).optional(),
  examCategories: z.array(sqlCategoryRefSchema).optional(),
});

const coursePlanBaseSchema = z.object({
  name: z.string().optional(),
  duration: z.number().int().positive("Must be a positive integer").optional(),
  // Backward compatibility with previous payload key.
  subscriptionDurationMonths: z.number().int().positive("Must be a positive integer").optional(),
  price: z.number().nonnegative("Must be a non-negative number"),
  withMaterial: z.boolean().optional().default(false),
  materialPrice: z.number().nonnegative("Must be a non-negative number").optional().default(0),
  isDefault: z.boolean().optional().default(false),
  status: z.boolean().optional().default(true),
});

export const createCoursePlanSchema = coursePlanBaseSchema.refine(
  (data) => data.duration !== undefined || data.subscriptionDurationMonths !== undefined,
  {
  message: "duration is required",
  path: ["duration"],
});

export const updateCoursePlanSchema = coursePlanBaseSchema.partial();
