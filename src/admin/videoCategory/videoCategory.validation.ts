import { z } from "zod";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;
const objectIdSchema = z.string().regex(objectIdRegex, "Invalid id");

const parseChildIds = z
  .union([
    z.array(objectIdSchema),
    objectIdSchema.transform((v) => [v]),
    z.string().transform((s) =>
      s
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    ),
  ])
  .pipe(z.array(objectIdSchema));

export const createVideoCategorySchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  slug: z.string().min(1, "Slug is required").max(255),
  order: z.coerce.number().int().min(0).optional().default(0),
  childCategoryIds: parseChildIds.optional().default([]),
  educatorId: objectIdSchema.optional().nullable(),
  status: z.coerce.boolean().optional().default(true),
  image: z.string().max(1000).optional().nullable(),
});

export const updateVideoCategorySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  slug: z.string().min(1).max(255).optional(),
  order: z.coerce.number().int().min(0).optional(),
  childCategoryIds: parseChildIds.optional(),
  educatorId: objectIdSchema.optional().nullable(),
  status: z.coerce.boolean().optional(),
  image: z.string().max(1000).optional().nullable(),
});

export const listQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: z.enum(["true", "false"]).optional(),
  educatorId: objectIdSchema.optional(),
  childCategoryId: objectIdSchema.optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  per_page: z.coerce.number().int().min(1).max(200).optional().default(20),
  sort_by: z.enum(["name", "order", "created_at", "updated_at"]).optional().default("order"),
  sort_dir: z.enum(["asc", "desc"]).optional().default("asc"),
});

export const sortFieldMap: Record<string, string> = {
  name: "title",
  order: "order_by",
  created_at: "createdAt",
  updated_at: "updatedAt",
};

// Query schema for the category-scoped Courses tab list.
export const categoryCoursesQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  per_page: z.coerce.number().int().min(1).max(200).optional().default(20),
});

// Query schema for the category-scoped Videos tab list.
export const categoryVideosQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: z.enum(["true", "false"]).optional(),
  platform: z.enum(["youtube", "vimeo", "aws"]).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  per_page: z.coerce.number().int().min(1).max(200).optional().default(20),
});
