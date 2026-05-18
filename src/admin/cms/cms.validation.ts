import { z } from "zod";
import { UpdateType } from "../../models/enums";

// ─── FAQ ──
export const faqCreateSchema = z.object({
  typeId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid typeId"),
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

// ─── Banner ──
const bannerObjectId = z
  .string()
  .regex(/^[a-fA-F0-9]{24}$/, "keyId must be a valid ObjectId");

export const bannerCreateSchema = z.object({
  image: z.string().min(1).max(500),
  key: z.enum(["Packages", "Courses", "Book", "EBook"]).optional(),
  keyId: bannerObjectId.optional(),
  orderBy: z.number().int().default(0),
});
export const bannerUpdateSchema = bannerCreateSchema.partial();

// ─── Live Banner ──
export const liveBannerCreateSchema = z.object({
  image: z.string().min(1).max(500),
  liveCourseId: bannerObjectId,
  orderBy: z.number().int().default(0),
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
  typeId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid typeId"),
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
