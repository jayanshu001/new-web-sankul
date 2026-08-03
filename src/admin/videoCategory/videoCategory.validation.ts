import { z } from "zod";

const objectIdRegex = /^([0-9a-fA-F]{24}|[1-9]\d*)$/;
// Accept either a Mongo ObjectId (24-hex) OR a MySQL numeric id, so the same
// validation works on MySQL where ids are integers. Coerce first: the FE sends
// MySQL ids as JSON numbers (e.g. 3157), so without coercion z.string() rejects
// them. Mirrors the dual-id handling in video.validation.ts.
const objectIdSchema = z.coerce.string().refine(
  (v) => objectIdRegex.test(v) || /^[1-9]\d*$/.test(v),
  { message: "Invalid id" }
);

// Multipart form-data sends every field as a string, so an "empty" optional id
// (no educator selected) arrives as "" — or the literal "null"/"undefined" —
// rather than JS null/undefined. Those slip past .optional()/.nullable() and
// then fail the id regex ("Invalid id"). Normalize them BEFORE validation:
//   - body (create/update): -> null, which the service stores as 0 (clears the
//     educator); .nullable() accepts it.
const bodyOptionalId = z.preprocess(
  (v) => (v === "" || v === "null" || v === "undefined" ? null : v),
  objectIdSchema.nullable().optional()
);
//   - list filters: -> undefined, i.e. "no filter".
const filterOptionalId = z.preprocess(
  (v) => (v === "" || v === "null" || v === "undefined" ? undefined : v),
  objectIdSchema.optional()
);

// Status filter accepts the canonical enum ("active"/"inactive") but also the
// boolean-style values the FE toggle sends (true/false, 1/0) and normalizes them
// to the enum the service expects. "" / "all" -> no filter.
const statusFilter = z.preprocess((v) => {
  if (v === "" || v === "all" || v === "null" || v === "undefined") return undefined;
  if (v === true || v === "true" || v === "1" || v === 1) return "active";
  if (v === false || v === "false" || v === "0" || v === 0) return "inactive";
  return v;
}, z.enum(["active", "inactive"]).optional());

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
  order: z.coerce.number().int().optional().default(0),
  childCategoryIds: parseChildIds.optional().default([]),
  educatorId: bodyOptionalId,
  status: z.coerce.boolean().optional().default(true),
  image: z.string().max(1000).optional().nullable(),
});

export const updateVideoCategorySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  slug: z.string().min(1).max(255).optional(),
  order: z.coerce.number().int().optional(),
  childCategoryIds: parseChildIds.optional(),
  educatorId: bodyOptionalId,
  status: z.coerce.boolean().optional(),
  image: z.string().max(1000).optional().nullable(),
});

export const listQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: statusFilter,
  educatorId: filterOptionalId,
  childCategoryId: filterOptionalId,
  page: z.coerce.number().int().min(1).optional().default(1),
  per_page: z.coerce.number().int().min(1).max(500).optional().default(20),
  // `limit` is the unified category-picker page-size param (FE sends limit=50); it
  // aliases per_page, which the controller resolves with limit taking precedence.
  limit: z.coerce.number().int().min(1).max(500).optional(),
  sort_by: z.enum(["name", "order", "created_at", "updated_at"]).optional().default("order"),
  sort_dir: z.enum(["asc", "desc"]).optional().default("asc"),
});

export const sortFieldMap: Record<string, string> = {
  name: "title",
  order: "order_by",
  created_at: "createdAt",
  updated_at: "updatedAt",
};

// Query schema for the category-scoped Sub-Categories tab list.
export const categorySubCategoriesQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: statusFilter,
  page: z.coerce.number().int().min(1).optional().default(1),
  per_page: z.coerce.number().int().min(1).max(500).optional().default(20),
});

// Query schema for the category-scoped Courses tab list.
export const categoryCoursesQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: statusFilter,
  page: z.coerce.number().int().min(1).optional().default(1),
  per_page: z.coerce.number().int().min(1).max(500).optional().default(20),
});

// Query schema for the category-scoped Videos tab list.
export const categoryVideosQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: statusFilter,
  platform: z.enum(["youtube", "vimeo", "aws"]).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  per_page: z.coerce.number().int().min(1).max(500).optional().default(20),
});
