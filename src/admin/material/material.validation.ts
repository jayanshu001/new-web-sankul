import { z } from "zod";

// ─── Category ─────────────────────────────────────────────────────────────────

export const createMaterialCategorySchema = z.object({
  title: z.string().min(1).max(255),
  slug: z.string().max(255).optional(),
  image: z.string().max(500).optional(),
  parent: z.string().nullable().optional(),
  order: z.coerce.number().int().optional(),
  status: z.coerce.boolean().optional(),
});

export const updateMaterialCategorySchema = createMaterialCategorySchema.partial();

export const reorderCategoriesSchema = z.object({
  parent: z.string().nullable().optional(),
  orders: z.array(z.object({ id: z.string(), order: z.number().int() })).min(1),
});

// ─── Leaf Material ────────────────────────────────────────────────────────────

export const createMaterialSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  materialCategoryId: z.string().min(1),
  file: z.string().min(1).max(1000),
  directLink: z.string().max(1000).optional(),
  thumbnail: z.string().max(500).optional(),
  fileSize: z.number().int().nonnegative().optional(),
  fileMime: z.string().max(100).optional(),
  language: z.string().max(20).optional(),
  isPreview: z.boolean().optional(),
  order: z.number().int().optional(),
  status: z.boolean().optional(),
});

export const updateMaterialSchema = createMaterialSchema.partial().omit({ materialCategoryId: true }).extend({
  materialCategoryId: z.string().min(1).optional(),
});

export const reorderMaterialsSchema = z.object({
  materialCategoryId: z.string().min(1),
  orders: z.array(z.object({ id: z.string(), order: z.number().int() })).min(1),
});

export const bulkStatusSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  status: z.boolean(),
});

export const bulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});
