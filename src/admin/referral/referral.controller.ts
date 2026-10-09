// Admin referral: HTTP handlers for programs, withdrawals, rewards and referrers.
// Mutating routes are protected by `idempotency` + `adminMutationLimiter` in
// referral.routes.ts.

import { Request, Response } from "express";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { success } from "../../utils/httpResponse";
import {
  createProgramSchema,
  updateProgramSchema,
  updateTransactionStatusSchema,
  rejectWithdrawalSchema,
  adjustRewardPointsSchema,
} from "./referral.validation";
import * as referralService from "../../modules/referral/referral-admin.service";

export const getPrograms = asyncHandler(async (req: Request, res: Response) => {
  const { data, pagination } = await referralService.listPrograms(
    req.query as referralService.ListProgramsQuery
  );
  return res.status(200).json({ success: true, data, ...(pagination ? { pagination } : {}) });
});

export const getProgramById = asyncHandler(async (req: Request, res: Response) => {
  const data = await referralService.getProgramById(req.params.id as string);
  return success(res, data as any);
});

export const createProgram = asyncHandler(async (req: Request, res: Response) => {
  const validated = createProgramSchema.parse(req.body);
  const data = await referralService.createProgram(validated);
  return res.status(201).json({ success: true, data });
});

export const updateProgram = asyncHandler(async (req: Request, res: Response) => {
  const validated = updateProgramSchema.parse(req.body);
  const data = await referralService.updateProgram(req.params.id as string, validated);
  return success(res, data as any);
});

export const deleteProgram = asyncHandler(async (req: Request, res: Response) => {
  await referralService.deleteProgram(req.params.id as string);
  return success(res, {}, "Program deleted.");
});

export const getTransactions = asyncHandler(async (req: Request, res: Response) => {
  const { data, pagination } = await referralService.listTransactions(
    req.query as referralService.ListTransactionsQuery
  );
  return res.status(200).json({ success: true, data, pagination });
});

export const updateWithdrawalStatus = asyncHandler(async (req: Request, res: Response) => {
  const validated = updateTransactionStatusSchema.parse(req.body);
  const data = await referralService.updateWithdrawalStatus(
    req.params.id as string,
    validated
  );
  return success(res, data as any);
});

export const rejectWithdrawal = asyncHandler(async (req: Request, res: Response) => {
  const { reason } = rejectWithdrawalSchema.parse(req.body ?? {});
  await referralService.rejectWithdrawal(req.params.id as string, reason);
  return success(res, {}, "Withdrawal rejected and refunded.");
});

export const getWithdrawalsReport = asyncHandler(async (req: Request, res: Response) => {
  const { data, pagination } = await referralService.getWithdrawalsReport(
    req.query as referralService.WithdrawalsReportQuery
  );
  return res.status(200).json({ success: true, data, pagination });
});

export const exportWithdrawalsCsv = asyncHandler(async (req: Request, res: Response) => {
  const csv = await referralService.buildWithdrawalsCsv(
    req.query as referralService.WithdrawalsCsvQuery
  );
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="WithdrawalRequests.csv"');
  return res.status(200).send(csv);
});

export const adjustCustomerRewards = asyncHandler(async (req: Request, res: Response) => {
  const validated = adjustRewardPointsSchema.parse(req.body);
  const data = await referralService.adjustCustomerRewards(
    req.params.customerId as string,
    validated
  );
  return res.status(201).json({ success: true, data });
});

export const getReferrers = asyncHandler(async (req: Request, res: Response) => {
  const { data, pagination } = await referralService.listReferrers(
    req.query as referralService.ReferrersQuery
  );
  return res.status(200).json({ success: true, data, pagination });
});
