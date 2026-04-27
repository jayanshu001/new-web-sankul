import { z } from "zod";

export const GUARDS = ["web", "educator", "promoter"] as const;
export type Guard = (typeof GUARDS)[number];

const objectIdRegex = /^[0-9a-fA-F]{24}$/;
export const objectIdSchema = z.string().regex(objectIdRegex, "Invalid id");

export const guardSchema = z.enum(GUARDS);

export const createPermissionSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  guard: guardSchema,
});

export const updatePermissionSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  guard: guardSchema.optional(),
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

export const sortFieldMap: Record<string, string> = {
  id: "_id",
  name: "name",
  created_at: "createdAt",
  updated_at: "updatedAt",
};
