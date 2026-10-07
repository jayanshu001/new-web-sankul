// Admin offline centers: Zod schemas for banner, city, center, batch and reorder payloads.
import { z } from "zod";

const objectIdSchema = z.string().regex(/^([0-9a-fA-F]{24}|[1-9]\d*)$/, "Invalid id.");

export const bannerCreateSchema = z.object({
  image: z.string().min(1).max(500),
  key: z.string().max(100).optional(),
  keyId: z.number().int().optional(),
  orderBy: z.number().int().default(0),
});
export const bannerUpdateSchema = bannerCreateSchema.partial();

export const cityCreateSchema = z.object({
  name: z.string().min(1).max(100),
  image: z.string().min(1).max(500),
  stateId: objectIdSchema.optional(),
  order: z.number().int().default(0),
  status: z.boolean().optional(),
});
export const cityUpdateSchema = cityCreateSchema.partial();

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

export const batchCreateSchema = z.object({
  name: z.string().min(1).max(255),
  image: z.string().min(1).max(500),
  description: z.string().min(1),
  startAt: z.string().min(1),
  duration: z.string().min(1).max(100),
  centerId: objectIdSchema,
  status: z.boolean().optional(),
});

export const reorderSchema = z.object({
  orders: z.array(z.object({ id: z.string().min(1), orderBy: z.number().int() })).min(1),
});
