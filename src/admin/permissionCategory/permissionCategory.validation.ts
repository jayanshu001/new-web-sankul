import { z } from "zod";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;
export const objectIdSchema = z.string().regex(objectIdRegex, "Invalid id");

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const createPermissionCategorySchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(255),
  slug: z
    .string()
    .trim()
    .min(1, "Slug is required")
    .max(255)
    .regex(slugRegex, "Slug must be lowercase, alphanumeric, hyphen-separated"),
  order: z.coerce.number().int().min(0).optional().default(0),
  status: z.coerce.boolean().optional().default(true),
});

export const updatePermissionCategorySchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  slug: z.string().trim().min(1).max(255).regex(slugRegex).optional(),
  order: z.coerce.number().int().min(0).optional(),
  status: z.coerce.boolean().optional(),
});

export const listQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  per_page: z.coerce.number().int().min(1).max(200).optional().default(20),
  sort_by: z.enum(["id", "title", "order", "created_at", "updated_at"]).optional().default("order"),
  sort_dir: z.enum(["asc", "desc"]).optional().default("asc"),
});

export const sortFieldMap: Record<string, string> = {
  id: "_id",
  title: "title",
  order: "order",
  created_at: "createdAt",
  updated_at: "updatedAt",
};
