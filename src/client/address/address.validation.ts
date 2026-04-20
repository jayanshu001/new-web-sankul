import { z } from "zod";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

export const createAddressSchema = z.object({
  name: z.string().min(1, "Name is required").max(50),
  phone: z.string().min(10).max(15),
  alternatePhone: z.string().max(15).optional().nullable(),
  email: z.string().email("Invalid email").max(100),
  address: z.string().min(1, "Address is required").max(255),
  address2: z.string().max(255).optional().default(""),
  city: z.string().min(1, "City is required").max(20),
  stateId: z.string().regex(objectIdRegex, "Invalid stateId").optional().nullable(),
  pincode: z.string().min(4).max(10),
  status: z.boolean().optional().default(true),
});

export const updateAddressSchema = createAddressSchema.partial();
