import { z } from "zod";

// The clean, unified contract the FE should send going forward:
//   { promocode, targetType: "package" | "course" | "ebook" | "liveCourse" | "testSeries", targetId }
// One self-describing pair for every entity — reads the same no matter what the
// user is buying, so the FE never has to pick between scattered per-type fields.
//
// The legacy per-type fields (package / course / ebook) are still accepted so
// existing apps keep working; the controller treats them as a fallback. Either
// way the backend re-detects the id's real type, so a mis-labelled targetType
// (or a misfiled legacy field) can't break the apply.
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
    // Preferred, unified pair.
    targetType: z.enum(TARGET_TYPES).optional(),
    targetId: z.string().nullable().optional(),
    // Legacy per-type fields (deprecated — kept for backward compatibility).
    package: z.string().nullable().optional(),
    course: z.string().nullable().optional(),
    ebook: z.string().nullable().optional(),
  })
  .refine((d) => !!(d.targetId || d.package || d.course || d.ebook), {
    message: "Provide targetId (with targetType), or one of package/course/ebook.",
  });
