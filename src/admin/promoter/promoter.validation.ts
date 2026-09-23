import { z } from "zod";

export const createPromoterSchema = z.object({
  fullName: z.string().min(1).max(255),
  email: z.string().email().max(255),
  phone: z.string().min(6).max(20),
  password: z.string().min(6).max(100),
  image: z.string().max(500).optional(),
  status: z.boolean().optional(),
});

export const updatePromoterSchema = z.object({
  fullName: z.string().min(1).max(255).optional(),
  email: z.string().email().max(255).optional(),
  phone: z.string().min(6).max(20).optional(),
  password: z.string().min(6).max(100).optional(),
  image: z.string().max(500).optional(),
  status: z.boolean().optional(),
});
