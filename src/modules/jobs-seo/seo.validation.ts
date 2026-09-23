import { z } from "zod";

const zBool = z.preprocess((v) => (typeof v === "string" ? v === "true" : v), z.boolean());

/** Shared across every content type — imported by jobs-content's validation. */
export const jobContentSeoSchema = z
  .object({
    seoTitle: z.string().max(255).optional(),
    metaDescription: z.string().max(500).optional(),
    metaKeywords: z.string().max(500).optional(),
    canonicalUrl: z.string().max(500).optional(),
    ogTitle: z.string().max(255).optional(),
    ogDescription: z.string().max(500).optional(),
    ogImageUrl: z.string().max(1000).optional(),
    schemaType: z.string().max(50).optional(),
    robotsIndex: zBool.optional().default(true),
    robotsFollow: zBool.optional().default(true),
    focusKeyword: z.string().max(255).optional(),
  })
  .partial();

export type JobContentSeoInput = z.infer<typeof jobContentSeoSchema>;
