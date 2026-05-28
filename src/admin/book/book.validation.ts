import { z } from "zod";
import { BookLanguage, BookOrderStatus, BookCourier } from "../../models/enums";

const zBool = z.preprocess(
  (v) => (typeof v === "string" ? v === "true" : v),
  z.boolean()
);

export const createBookSchema = z.object({
  name: z.string().min(1).max(255),
  examCountdownCategoryId: z.string().nullable().optional(),
  thumbnail: z.string().max(500).optional(),
  author: z.string().max(150).optional(),
  image: z.string().max(500).optional(),
  description: z.string().optional(),
  demoUrl: z.string().max(500).optional(),
  weight: z.coerce.number().int().nonnegative().optional(),
  pages: z.coerce.number().int().nonnegative().optional(),
  dynamicLink: z.string().max(500).optional(),
  listPrice: z.coerce.number().int().nonnegative(),
  discountedPrice: z.coerce.number().int().nonnegative(),
  shippingPrice: z.coerce.number().int().nonnegative().default(0),
  orderBy: z.coerce.number().int().default(0),
  language: z
    .enum([BookLanguage.ENGLISH, BookLanguage.GUJARATI, BookLanguage.HINDI])
    .optional(),
  isMagazine: zBool.optional(),
  isCombo: zBool.optional(),
  isTrending: zBool.optional(),
  status: zBool.optional(),
});

export const updateBookSchema = createBookSchema.partial();

export const reorderBooksSchema = z.object({
  orders: z
    .array(z.object({ id: z.string().min(1), orderBy: z.number().int() }))
    .min(1),
});

export const updateOrderStatusSchema = z.object({
  status: z.enum([
    BookOrderStatus.PENDING,
    BookOrderStatus.VERIFIED,
    BookOrderStatus.SHIPPED,
    BookOrderStatus.DELIVERED,
    BookOrderStatus.CANCELLED,
    BookOrderStatus.FAILED,
  ]),
  location: z.string().max(150).optional(),
  remarks: z.string().max(500).optional(),
});

export const setTrackingSchema = z.object({
  trackingId: z.string().min(1).max(100),
  courier: z.enum([BookCourier.MAHAVIR, BookCourier.TIRUPATI]),
  status: z.string().max(100).optional(),
  location: z.string().max(150).optional(),
  note: z.string().max(255).optional(),
});

export const addTrackingEventSchema = z.object({
  status: z.string().min(1).max(100),
  location: z.string().max(150).optional(),
  note: z.string().max(255).optional(),
  at: z.coerce.date().optional(),
});

export const updateSettingsSchema = z.object({
  freeShippingMinOrderAmount: z.number().int().nonnegative().optional(),
  supportPhone: z.string().max(20).optional(),
  termsAndConditions: z.array(z.string()).optional(),
  gstRate: z.number().min(0).optional(),
  originCity: z.string().max(50).optional(),
  originHub: z.string().max(100).optional(),
});
