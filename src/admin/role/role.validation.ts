import { z } from "zod";
import { GUARDS, objectIdSchema, guardSchema } from "../permission/permission.validation";

export { GUARDS };

export const createRoleSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  guard: guardSchema,
  permission_ids: z.array(objectIdSchema).default([]),
});

export const updateRoleSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  guard: guardSchema.optional(),
  permission_ids: z.array(objectIdSchema).optional(),
});

export const listQuerySchema = z.object({
  guard: guardSchema.optional(),
  search: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  per_page: z.coerce.number().int().min(1).max(200).optional().default(20),
  sort_by: z.enum(["id", "name", "created_at", "updated_at"]).optional().default("created_at"),
  sort_dir: z.enum(["asc", "desc"]).optional().default("desc"),
});

export const guardOnlyQuerySchema = z.object({
  guard: guardSchema.optional(),
});

export const syncPermissionsSchema = z.object({
  guard: guardSchema.optional(),
  permission_ids: z.array(objectIdSchema),
});

export const sortFieldMap: Record<string, string> = {
  id: "_id",
  name: "name",
  created_at: "createdAt",
  updated_at: "updatedAt",
};
