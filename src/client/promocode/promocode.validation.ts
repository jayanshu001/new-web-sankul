import { z } from "zod";

export const applyPromocodeSchema = z
  .object({
    promocode: z.string().min(1).max(50),
    package: z.string().nullable().optional(),
    course: z.string().nullable().optional(),
    ebook: z.string().nullable().optional(),
  })
  .refine((d) => !!(d.package || d.course || d.ebook), {
    message: "Provide one of package, course, or ebook.",
  });
