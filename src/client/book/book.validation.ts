import { z } from "zod";
import { PaymentMethod } from "../../models/enums";

export const addToCartSchema = z.object({
  bookId: z.string().min(1),
  qty: z.number().int().positive(),
});

export const updateCartItemSchema = z.object({
  qty: z.number().int().positive(),
});

export const attachShippingSchema = z.object({
  name: z.string().min(1).max(50),
  phone: z.string().min(10).max(15),
  alternatePhone: z.string().max(15).optional(),
  email: z.string().email().max(100),
  address: z.string().min(1).max(255),
  address2: z.string().max(255).optional(),
  city: z.string().min(1).max(50),
  stateId: z.string().min(1),
  pincode: z.string().min(4).max(10),
});

export const placeOrderSchema = z.object({
  paymentMethod: z
    .enum([PaymentMethod.RAZORPAY, PaymentMethod.FREE, PaymentMethod.CASH])
    .default(PaymentMethod.RAZORPAY),
});
