// Admin masters: Zod schemas for educator, category, material and video payloads.
import { z } from "zod";

export const createEducatorSchema = z.object({
  name: z.string().min(1, "Name is required"),
  image: z.string().url("Image must be a valid URL"),
  about: z.string().optional(),
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters").optional(),
  status: z.boolean().optional().default(true),
});

export const updateEducatorSchema = createEducatorSchema.partial().extend({
  // null clears the stored image; omit keeps it; URL/file upload sets it.
  image: z.string().url("Image must be a valid URL").nullable().optional(),
});

export const createSubjectCategorySchema = z.object({
  title: z.string().min(1, "Title is required"),
  slug: z.string().min(1, "Slug is required"),
  image: z.string().url("Image must be a valid URL"),
  parent: z.union([z.string(), z.number()]).optional().default(0),
  order: z.number().int().optional().default(0),
  status: z.boolean().optional().default(true),
});

export const updateSubjectCategorySchema = createSubjectCategorySchema.partial();

export const createMaterialSchema = z.object({
  title: z.string().min(1, "Title is required"),
  image: z.string().url("Image must be a valid URL").optional(),
  isActive: z.boolean().optional().default(true),
});

export const updateMaterialSchema = createMaterialSchema.partial();

export const createVideoSchema = z.object({
  videoCategoryId: z.string().regex(/^([0-9a-fA-F]{24}|[1-9]\d*)$/, "Invalid ObjectId"),
  title: z.string().min(1, "Title is required"),
  topic: z.string().optional().default(""),
  slug: z.string().min(1, "Slug is required"),
  platform: z.enum(["youtube", "aws", "vimeo"]),
  priceType: z.enum(["free", "paid"]).optional().default("paid"),
  youtube_id: z.string().optional(),
  aws_id: z.string().optional(),
  vimeo_id: z.string().optional(),
  order: z.number().int().optional().default(0),
  status: z.boolean().optional().default(true),
});

export const updateVideoSchema = createVideoSchema.partial();

export const createVideoCategorySchema = z.object({
  title: z.string().min(1, "Title is required"),
  slug: z.string().min(1, "Slug is required"),
  image: z.string().url("Image must be a valid URL"),
  courseId: z.string().regex(/^([0-9a-fA-F]{24}|[1-9]\d*)$/, "Invalid ObjectId").optional(),
  // No `.default(0)`: an omitted order must stay undefined so vcCreate can assign
  // MAX(order_by) + 1 (last in the app). An explicit order is still honoured.
  order_by: z.number().int().optional(),
  status: z.boolean().optional().default(true),
});

export const updateVideoCategorySchema = createVideoCategorySchema.partial();

export const createPackageCategorySchema = z.object({
  title: z.string().min(1, "Title is required"),
  slug: z.string().min(1, "Slug is required"),
  image: z.string().url("Image must be a valid URL"),
  order: z.number().int().optional().default(0),
  status: z.boolean().optional().default(true),
});

export const updatePackageCategorySchema = createPackageCategorySchema.partial();
