import { z } from "zod";

const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id.");

// ─── Banner ──
export const bannerCreateSchema = z.object({
  image: z.string().min(1).max(500),
  key: z.string().max(100).optional(),
  keyId: z.number().int().optional(),
  orderBy: z.number().int().default(0),
});
export const bannerUpdateSchema = bannerCreateSchema.partial();

// ─── City ──
export const cityCreateSchema = z.object({
  name: z.string().min(1).max(100),
  image: z.string().min(1).max(500),
  order: z.number().int().default(0),
  status: z.boolean().optional(),
});
export const cityUpdateSchema = cityCreateSchema.partial();

// ─── Center ──
export const centerCreateSchema = z.object({
  name: z.string().min(1).max(255),
  images: z.array(z.string()).default([]),
  address: z.string().min(1),
  latitude: z.number(),
  longitude: z.number(),
  phone: z.string().min(1).max(20),
  cityId: objectIdSchema,
  status: z.boolean().optional(),
});
export const centerUpdateSchema = centerCreateSchema.partial();

// ─── Batch ──
export const batchCreateSchema = z.object({
  name: z.string().min(1).max(255),
  image: z.string().min(1).max(500),
  description: z.string().min(1),
  startAt: z.string().min(1),
  duration: z.string().min(1).max(100),
  centerId: objectIdSchema,
  status: z.boolean().optional(),
});
export const batchUpdateSchema = batchCreateSchema.partial();

export const reorderSchema = z.object({
  orders: z.array(z.object({ id: z.string().min(1), orderBy: z.number().int() })).min(1),
});
