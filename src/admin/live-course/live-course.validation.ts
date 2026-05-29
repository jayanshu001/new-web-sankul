import { z } from "zod";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId");

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
    level:           z.string().trim().min(1, "Level is required"),
    classType:       z.enum(["live", "live_offline", "offline"]).optional(),
    status:        z.boolean(),
    isPaid:        z.boolean().optional(),
    isPopular:     z.boolean().optional(),
    startTime:     z.string().datetime({ offset: true }).nullable().optional(),
    courseEducatorId:  objectId.optional(),
    packageCategoryId: objectId.optional(),
    examCountdownCategoryIds: z.array(objectId).optional(),
    examCountdownIds:         z.array(objectId).optional(),
  })
  .strict();

// All fields optional for PATCH, but reject unknowns and require at least one.
export const updateLiveCourseSchema = createLiveCourseSchema
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update." });
