// Admin CMS: Zod request schemas for FAQs, popups, banners, testimonials, links and app version.
import { z } from "zod";

import { UpdateType } from "../../shared/enums";

// Accepts an integer id or a legacy 24-hex ObjectId.
const refIdRegex = /^([0-9a-fA-F]{24}|[1-9]\d*)$/;

export const faqCreateSchema = z.object({
  typeId: z.string().regex(refIdRegex, "Invalid typeId"),
  question: z.string().min(1).max(1000),
  answer: z.string().min(1),
});

export const faqTypeCreateSchema = z.object({
  title: z.string().min(1).max(255),
});
export const faqTypeUpdateSchema = faqTypeCreateSchema.partial();

export const popupCreateSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().min(1),
  image: z.string().min(1).max(500),
  discount: z.string().max(50).optional().default(""),
  promocode: z.string().max(50).optional().default(""),
  promoExpireAt: z.string().min(1),
  status: z.boolean().optional(),
});
export const popupUpdateSchema = popupCreateSchema.partial();

// `image` is required on create (frontend contract). On update it's optional:
// when omitted the existing URL is kept, never nulled.
export const currentAffairCreateSchema = z.object({
  title: z.string().min(1).max(255),
  image: z.string().min(1).max(500),
  youtubeLink: z.string().min(1).max(500),
  status: z.boolean().optional(),
});
export const currentAffairUpdateSchema = currentAffairCreateSchema.partial();

const bannerRefId = z.string().regex(refIdRegex, "Invalid id");

// `ws_banner_slider.key_id` is an int column, so unlike bannerRefId this rejects
// an ObjectId outright. Accepts a number or a string: multipart sends strings, a
// JSON client sends an int, and both must hit the same positive-integer check.
const bannerTargetId = z
  .union([z.string(), z.number()])
  .refine((v) => /^[1-9]\d*$/.test(String(v)), "Invalid keyId");

const BANNER_KEYS_NEEDING_TARGET = ["Packages", "Courses", "Book", "EBook"] as const;

const bannerBaseSchema = z.object({
  image: z.string().min(1).max(500),
  key: z.enum(["Packages", "Courses", "Book", "EBook", "Explore"]).optional(),
  keyId: bannerTargetId.optional(),
  // No `.default(0)`: an omitted orderBy must stay undefined so createBanner can
  // assign previous-row + 1 within that key's list (utils/listOrdering).
  orderBy: z.number().int().optional(),
});

/**
 * `keyId` is mandatory whenever `key` selects a collection, and forbidden for
 * `Explore` (a standalone CTA), so a banner can't deep-link to nothing.
 */
const refineBannerTarget = (
  data: { key?: string; keyId?: string | number },
  ctx: z.RefinementCtx
) => {
  const needsTarget =
    data.key !== undefined &&
    (BANNER_KEYS_NEEDING_TARGET as readonly string[]).includes(data.key);

  if (needsTarget && data.keyId === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["keyId"],
      message: `keyId is required when key is ${data.key}.`,
    });
  }
  if (data.key === "Explore" && data.keyId !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["keyId"],
      message: "keyId is not allowed when key is Explore.",
    });
  }
  // On update `key` and `keyId` must travel together: a lone keyId can't be
  // validated against the stored key, so it would risk stranding a target on an
  // Explore banner.
  if (data.key === undefined && data.keyId !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["key"],
      message: "key is required when keyId is provided.",
    });
  }
};

export const bannerCreateSchema = bannerBaseSchema.superRefine(refineBannerTarget);
export const bannerUpdateSchema = bannerBaseSchema
  .partial()
  .superRefine(refineBannerTarget);

export const liveBannerCreateSchema = z.object({
  image: z.string().min(1).max(500),
  liveCourseId: bannerRefId,
  // Omitted → previous-row + 1 on create, same as bannerBaseSchema above.
  orderBy: z.number().int().optional(),
});
export const liveBannerUpdateSchema = liveBannerCreateSchema.partial();

export const testimonialCreateSchema = z.object({
  name: z.string().min(1).max(255),
  title: z.string().min(1).max(255),
  description: z.string().min(1),
  rating: z.number().int().min(1).max(5),
});
export const testimonialUpdateSchema = testimonialCreateSchema.partial();

// Terms writes validate with `termsCreateSchemaMysql` (modules/terms/terms.validation.ts),
// which pins `module` to the DB enum. Don't add a looser schema here.

export const versionUpsertSchema = z.object({
  latestVersionCode: z.number().int().nonnegative(),
  lastSupportedVersionCode: z.number().int().nonnegative(),
});

export const appUpdateUpsertSchema = z.object({
  latestVersion: z.number().int().nonnegative(),
  updateType: z.enum([UpdateType.IMMEDIATE, UpdateType.FLEXIBLE]).default(UpdateType.FLEXIBLE),
  isUpdateAvailable: z.boolean(),
});

export const socialLinkTypeCreateSchema = z.object({
  title: z.string().min(1).max(255),
});
export const socialLinkTypeUpdateSchema = socialLinkTypeCreateSchema.partial();

export const socialLinkCreateSchema = z.object({
  typeId: z.string().regex(refIdRegex, "Invalid typeId"),
  title: z.string().min(1).max(255),
  icon: z.string().max(500).optional(),
  link: z.string().min(1).max(500).url("Invalid link URL"),
  order: z.number().int().default(0),
  status: z.boolean().optional(),
});
export const socialLinkUpdateSchema = socialLinkCreateSchema.partial();

export const reorderSchema = z.object({
  orders: z.array(z.object({ id: z.string().min(1), orderBy: z.number().int() })).min(1),
});
