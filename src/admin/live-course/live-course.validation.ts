import { z } from "zod";

const objectId = z.string().regex(/^([0-9a-fA-F]{24}|[1-9]\d*)$/, "Invalid ObjectId");

// A material/exam category reference, mirroring the recorded-Course schema and
// the LiveCourse model's `{ category, order }` sub-document shape.
const categoryRefSchema = z.object({
  category: objectId,
  order: z.number().int().nonnegative().optional(),
});

export const createLiveCourseSchema = z
  .object({
    name:          z.string().trim().min(1, "Name is required").max(300),
    subtitle:      z.string().trim().optional(),
    description:   z.string().trim().min(1, "Description is required"),
    image:           z.string().url("Image must be a valid URL"),
    ordered:         z.number().int("Ordered must be an integer"),
    shareableLink:   z.string().trim().optional(),
    withMaterial:    z.string().trim().optional(),
    withoutMaterial: z.string().trim().optional(),
    classType:       z.enum(["live", "live_offline", "offline"]).optional(),
    status:        z.boolean(),
    isPaid:        z.boolean().optional(),
    isPopular:     z.boolean().optional(),
    startTime:     z.string().datetime({ offset: true }).nullable().optional(),
    courseEducatorId:  objectId.optional(),
    packageCategoryId: objectId.optional(),
    examCountdownCategoryIds: z.array(objectId).optional(),
    examCountdownIds:         z.array(objectId).optional(),
    materialCategories:       z.array(categoryRefSchema).optional(),
    examCategories:           z.array(categoryRefSchema).optional(),
  })
  .strict();

// All fields optional for PATCH, but reject unknowns and require at least one.
export const updateLiveCourseSchema = createLiveCourseSchema
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update." });

// SQL branch: ref ids are numeric (the Mongo schema enforces ObjectId). Same
// shape, numeric ids. examCountdown*/materialCategories/examCategories pass
// through as arrays (stored as JSON; not validated against Mongo collections).
const numId = z.coerce.number().int().positive();
export const createLiveCourseSqlSchema = z
  .object({
    name:          z.string().trim().min(1, "Name is required").max(300),
    subtitle:      z.string().trim().optional(),
    description:   z.string().trim().min(1, "Description is required"),
    image:           z.string().url("Image must be a valid URL"),
    // Optional since 2026-07-27: omitted → the service assigns previous-row + 1
    // (utils/listOrdering). An explicit value is still honoured, so this only
    // relaxes the contract.
    ordered:         z.coerce.number().int("Ordered must be an integer").optional(),
    shareableLink:   z.string().trim().optional(),
    withMaterial:    z.string().trim().optional(),
    withoutMaterial: z.string().trim().optional(),
    classType:       z.enum(["live", "live_offline", "offline"]).optional(),
    status:        z.boolean(),
    isPaid:        z.boolean().optional(),
    isPopular:     z.boolean().optional(),
    startTime:     z.string().datetime({ offset: true }).nullable().optional(),
    courseEducatorId:  numId.optional(),
    courseSubjectCategoryId: numId.optional(),
    packageCategoryId: numId.optional(),
    examCountdownCategoryIds: z.array(z.any()).optional(),
    examCountdownIds:         z.array(z.any()).optional(),
    timetableFiles:           z.array(z.any()).optional(),
    materialCategories:       z.array(z.any()).optional(),
    examCategories:           z.array(z.any()).optional(),
  })
  .strict();

export const updateLiveCourseSqlSchema = createLiveCourseSqlSchema
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update." });

/**
 * Bulk drag-and-drop reorder body. Same shape as the banners reorder
 * (cms.validation.reorderSchema), with `ordered` instead of `orderBy` to match
 * the ws_live_course column. Ids stay strings — the whole admin API addresses
 * live courses by string id.
 */
export const reorderLiveCoursesSchema = z.object({
  orders: z
    .array(z.object({ id: z.string().min(1), ordered: z.number().int() }))
    .min(1, "orders array is required"),
});
