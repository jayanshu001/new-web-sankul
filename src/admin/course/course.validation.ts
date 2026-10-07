// Admin courses: Zod request schemas for courses, plans and linked books/categories.
import { z } from "zod";

const objectIdSchema = z.string().regex(/^([0-9a-fA-F]{24}|[1-9]\d*)$/, "Invalid ObjectId");

const categoryRefSchema = z.object({
  category: objectIdSchema,
  order: z.number().int().nonnegative().optional(),
});

const sqlCategoryRefSchema = z.object({
  category: z.coerce.number().int().positive(),
  order: z.coerce.number().int().nonnegative().optional(),
});

export const createCourseSqlSchema = z.object({
  name: z.string().min(1, "Name is required"),
  subtitle: z.string().optional(),
  description: z.string().min(1, "Description is required"),
  // Not .url(): legacy rows hold relative filenames (e.g. "twitter-image.png")
  // that the edit form round-trips.
  image: z.string().min(1, "Image is required"),
  // Omitted → createCourse assigns nextOrder. preprocess, not z.coerce:
  // Number(undefined) is NaN, which would reject an absent key.
  ordered: z
    .preprocess(
      (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
      z.number().int("Ordered must be an integer")
    )
    .optional(),
  shareableLink: z.string().optional(),
  withMaterial: z.string().optional(),
  withoutMaterial: z.string().optional(),
  level: z.string().min(1, "Level is required"),
  status: z.boolean(),
  isPaid: z.boolean().optional(),
  isPopular: z.boolean().optional(),
  // Required on create and update (updateCourse re-requires it after .partial()).
  // preprocess, not z.coerce, so a missing value yields "Educator is required"
  // instead of "expected number, received nan".
  courseEducatorId: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
    z
      .number({
        required_error: "Educator is required",
        invalid_type_error: "Educator is required",
      })
      .int()
      .positive(),
  ),
  courseSubjectCategoryId: z.coerce.number().int().positive().optional(),
  videoCategoryId: z.coerce.number().int().positive().optional(),
  // ws_package_course_material id; null detaches. Forms send 0 / "0" / "" for
  // "no material", normalized to null.
  pcMaterialId: z.preprocess(
    (v) => (v === 0 || v === "0" || v === "" || v === null || v === undefined ? null : v),
    z.coerce.number().int().positive().nullable().optional()
  ),
  materialCategories: z.array(sqlCategoryRefSchema).optional(),
  examCategories: z.array(sqlCategoryRefSchema).optional(),
  // Stored as JSON int[] on ws_course.
  examCountdownIds: z.array(z.coerce.number().int().positive()).optional(),
  examCountdownCategoryIds: z.array(z.coerce.number().int().positive()).optional(),
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

export const linkCourseBooksSchema = z.object({
  bookIds: z.array(z.coerce.number().int().positive()).min(1, "bookIds must not be empty"),
});

export const reorderCourseBooksSchema = z.object({
  order: z
    .array(
      z.object({
        bookId: z.coerce.number().int().positive(),
        order: z.coerce.number().int().nonnegative(),
      })
    )
    .min(1, "order must not be empty"),
});

export
 const reorderCourseCategoriesSchema = z.object({
  order: z
    .array(
      z.object({
        categoryId: z.coerce.number().int().positive(),
        order: z.coerce.number().int().nonnegative(),
      })
    )
    .min(1, "order must not be empty"),
});
