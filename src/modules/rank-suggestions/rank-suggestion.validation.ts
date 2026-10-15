import { z } from "zod";
import { publicUrlFor } from "../../middlewares/upload";
import { SUGGESTION_KINDS, SUGGESTION_PRODUCT_TYPES } from "./rank-suggestion.types";

const MARKS_LIMIT = 100000;
const SORT_ORDER_LIMIT = 1000000;
const BIGINT_MAX = BigInt("9223372036854775807");

/**
 * Images are uploaded through this API, so a text `image` (sent back unchanged
 * on edit) must point at our own bucket — the student site only renders hosts
 * on its next/image allow-list and would fail on anything else.
 */
const UPLOAD_ORIGIN = publicUrlFor("");

const zBool = z.preprocess((v) => (typeof v === "string" ? v === "true" : v), z.boolean());

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

export const suggestionIdParamSchema = z.object({ id: z.coerce.number().int().positive() });

const marksBound = z.coerce.number().min(-MARKS_LIMIT).max(MARKS_LIMIT).nullish();

/** PUT replaces the whole row, so create and update share one schema. */
export const rankSuggestionSchema = z
  .object({
    kind: z.enum(SUGGESTION_KINDS),
    productType: z.enum(SUGGESTION_PRODUCT_TYPES).nullish(),
    productId: z.coerce.bigint().positive().max(BIGINT_MAX).nullish(),
    url: z
      .string()
      .trim()
      .max(2048)
      .url("Enter a full link, e.g. https://websankullive.classx.co.in/new-courses/381")
      .refine((value) => value.startsWith("https://"), "The link must start with https://")
      .nullish(),
    title: optionalText(255),
    image: optionalText(1000).refine(
      (value) => value === null || value.startsWith(UPLOAD_ORIGIN),
      "Upload the image here instead of pasting a link."
    ),
    description: optionalText(500),
    ctaLabel: optionalText(60),
    minMarks: marksBound,
    maxMarks: marksBound,
    sortOrder: z.coerce.number().int().min(-SORT_ORDER_LIMIT).max(SORT_ORDER_LIMIT).optional(),
    isActive: zBool.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "product") {
      if (!value.productType) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["productType"], message: "Pick a product type." });
      }
      if (!value.productId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["productId"], message: "Pick a product." });
      }
    } else {
      if (!value.url) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["url"], message: "Enter the link." });
      }
      if (!value.title) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["title"], message: "Enter a title for the link." });
      }
      if (!value.image) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["image"], message: "Upload an image for the link." });
      }
    }
    if (value.minMarks != null && value.maxMarks != null && value.minMarks >= value.maxMarks) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxMarks"],
        message: "Max marks must be greater than min marks.",
      });
    }
  });
