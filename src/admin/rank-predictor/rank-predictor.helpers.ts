import type { Request } from "express";
import { HttpError } from "../../middlewares/errorHandler";
import {
  RANK_ERROR,
  type RescoreOutcome,
} from "../../modules/rank-predictor/rank-predictor.types";

export const adminIdOf = (req: Request): number | null =>
  req.user?.id ? Number(req.user.id) : null;

export const bigIntParam = (req: Request, name: string): bigint =>
  BigInt(req.params[name] as string);

export const toBooleanFlag = (value: unknown): boolean =>
  value === true || value === 1 || String(value) === "true";

export const requireStatusFlag = (body: Record<string, unknown> | undefined): boolean => {
  const value = body?.isActive ?? body?.status;
  if (value === undefined) {
    throw new HttpError(400, "isActive is required.", { error: RANK_ERROR.IS_ACTIVE_REQUIRED });
  }
  return toBooleanFlag(value);
};

export const rescoreMessage = (base: string, { rescored, skipped }: RescoreOutcome): string => {
  if (!rescored && !skipped) return base;
  const skippedNote = skipped ? `, ${skipped} skipped` : "";
  return `${base} ${rescored} submission(s) rescored${skippedNote}.`;
};
