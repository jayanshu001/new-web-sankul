// Client promocodes: Zod request schemas.
import { z } from "zod";

// Preferred contract: { promocode, targetType, targetId }. Legacy per-type fields
// (package / course / ebook) are still accepted as a fallback for existing apps. The
// backend re-detects the id's real type either way, so a mislabelled targetType can't
// break the apply.
export const TARGET_TYPES = [
  "package",
  "course",
  "ebook",
  "liveCourse",
  "testSeries",
] as const;

export const applyPromocodeSchema = z
  .object({
    promocode: z.string().min(1).max(50),
    targetType: z.enum(TARGET_TYPES).optional(),
    targetId: z.string().nullable().optional(),
    // Legacy per-type fields, kept for backward compatibility.
    package: z.string().nullable().optional(),
    course: z.string().nullable().optional(),
    ebook: z.string().nullable().optional(),
  })
  .refine((d) => !!(d.targetId || d.package || d.course || d.ebook), {
    message: "Provide targetId (with targetType), or one of package/course/ebook.",
  });
