import { z } from "zod";
import { UpdateType } from "../../shared/enums";

// Accepts a MySQL integer id or a legacy Mongo ObjectId (migration-tolerant).
const refIdRegex = /^([0-9a-fA-F]{24}|[1-9]\d*)$/;

// ─── FAQ ──
export const faqCreateSchema = z.object({
  typeId: z.string().regex(refIdRegex, "Invalid typeId"),
  question: z.string().min(1).max(1000),
  answer: z.string().min(1),
});
export const faqUpdateSchema = faqCreateSchema.partial();

// ─── FAQ Type ──
export const faqTypeCreateSchema = z.object({
  title: z.string().min(1).max(255),
});
export const faqTypeUpdateSchema = faqTypeCreateSchema.partial();

// ─── Popup ──
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

// ─── Current Affairs ──
// `image` required on create (must always be present per the frontend
// contract). On update it's optional: when the admin doesn't change the
// image, the request omits it and genericUpdate's $set leaves the existing
// URL untouched — never null it out.
export const currentAffairCreateSchema = z.object({
  title: z.string().min(1).max(255),
  image: z.string().min(1).max(500),
  youtubeLink: z.string().min(1).max(500),
  status: z.boolean().optional(),
});
export const currentAffairUpdateSchema = currentAffairCreateSchema.partial();

// ─── Banner ──
const bannerRefId = z.string().regex(refIdRegex, "Invalid id");

// `ws_banner_slider.key_id` is a plain int column — unlike bannerRefId this
// rejects a legacy ObjectId outright rather than accepting an id that could
// never be stored. Accepts a number as well as a string: these routes are
// multipart (everything arrives as a string) but a JSON client would send an
// int, and both must reach the same positive-integer check.
const bannerTargetId = z
  .union([z.string(), z.number()])
  .refine((v) => /^[1-9]\d*$/.test(String(v)), "Invalid keyId");

/** Collection keys that deep-link to a row and therefore require `keyId`. */
const BANNER_KEYS_NEEDING_TARGET = ["Packages", "Courses", "Book", "EBook"] as const;

const bannerBaseSchema = z.object({
  image: z.string().min(1).max(500),
  key: z.enum(["Packages", "Courses", "Book", "EBook", "Explore"]).optional(),
  keyId: bannerTargetId.optional(),
  // No `.default(0)`: an omitted orderBy must stay undefined so createBanner can
  // assign the TOP slot of that key's list (utils/listOrdering). An explicit
  // value is still honoured as-is.
  orderBy: z.number().int().optional(),
});

/**
 * `keyId` is mandatory whenever `key` selects a collection, and forbidden for
 * `Explore` (a standalone CTA with no target). Enforced here so a banner can't
 * be saved as a deep link that points nowhere.
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

// ─── Live Banner ──
export const liveBannerCreateSchema = z.object({
  image: z.string().min(1).max(500),
  liveCourseId: bannerRefId,
  // Omitted → top slot on create, same as bannerBaseSchema above.
  orderBy: z.number().int().optional(),
});
export const liveBannerUpdateSchema = liveBannerCreateSchema.partial();

// ─── Testimonial ──
export const testimonialCreateSchema = z.object({
  name: z.string().min(1).max(255),
  title: z.string().min(1).max(255),
  description: z.string().min(1),
  rating: z.number().int().min(1).max(5),
});
export const testimonialUpdateSchema = testimonialCreateSchema.partial();

// ─── Terms ──
export const termsCreateSchema = z.object({
  module: z.string().min(1).max(100),
  terms: z.string().min(1),
  freeShippingMinimumOrderAmount: z.number().int().nonnegative().default(0),
  status: z.boolean().optional(),
});
export const termsUpdateSchema = termsCreateSchema.partial();

// ─── Version ──
export const versionUpsertSchema = z.object({
  latestVersionCode: z.number().int().nonnegative(),
  lastSupportedVersionCode: z.number().int().nonnegative(),
});

// ─── App update ──
export const appUpdateUpsertSchema = z.object({
  latestVersion: z.number().int().nonnegative(),
  updateType: z.enum([UpdateType.IMMEDIATE, UpdateType.FLEXIBLE]).default(UpdateType.FLEXIBLE),
  isUpdateAvailable: z.boolean(),
});

// ─── Social Link Type ──
export const socialLinkTypeCreateSchema = z.object({
  title: z.string().min(1).max(255),
});
export const socialLinkTypeUpdateSchema = socialLinkTypeCreateSchema.partial();

// ─── Social Link ──
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
