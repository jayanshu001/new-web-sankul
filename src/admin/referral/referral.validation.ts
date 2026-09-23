import { z } from "zod";
import { RefferalTransactionStatus } from "../../shared/enums";

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
  // Bank reference / UTR for the manual (offline) transfer finance just made.
  // Optional so the existing admin panel keeps working unchanged; stored on
  // ws_refferal_transaction.reference_number, which the retired RazorpayX payout
  // integration used to own. Blank/whitespace is treated as "not provided".
  referenceNumber: z.string().trim().max(255).optional(),
});

// Reject stays its own endpoint (never a `rejected` value on the status route)
// so the refund can't be bypassed. Reason is optional — a blank one stores NULL
// and must never fail the request.
export const rejectWithdrawalSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const adjustRewardPointsSchema = z.object({
  amount: z.number().int(),
  type: z.enum(["credit", "debit"]),
  description: z.string().min(1).max(150),
});
