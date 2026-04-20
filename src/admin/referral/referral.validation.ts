import { z } from "zod";
import { RefferalTransactionStatus } from "../../models/enums";

export const createProgramSchema = z.object({
  name: z.string().min(1).max(50),
  title: z.string().min(1).max(255),
  image: z.string().max(255).optional(),
  referralDiscount: z.number().min(0).max(100),
  referralReward: z.number().min(0).max(100),
  minimumPrice: z.number().int().nonnegative(),
  initialRewardAmount: z.number().int().nonnegative().optional(),
  video: z.string().max(255).optional(),
  status: z.boolean().optional(),
});

export const updateProgramSchema = createProgramSchema.partial();

export const updateTransactionStatusSchema = z.object({
  status: z.enum([
    RefferalTransactionStatus.PENDING,
    RefferalTransactionStatus.SUCCESSFUL,
  ]),
  description: z.string().max(150).optional(),
});

export const adjustRewardPointsSchema = z.object({
  amount: z.number().int(),
  type: z.enum(["credit", "debit"]),
  description: z.string().min(1).max(150),
});
