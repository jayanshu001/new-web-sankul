import { Request, Response } from "express";
import { z } from "zod";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import {
  setPinned,
  recomputeScope,
  recomputeAllPopularity,
  POPULARITY_SCOPES,
  type PopularityScope,
} from "../../modules/plan-popularity/plan-popularity.service";

const scopeEnum = z.enum(["course", "package", "ebook", "liveCourse", "testSeries"]);

const pinSchema = z.object({
  scope: scopeEnum,
  planId: z.number().int().positive(),
  pinned: z.boolean(),
});

// POST /api/v1/admin/plan-popularity/pin
// Admin override: pin/unpin a plan as "Most Popular". The product is recomputed
// immediately — a pin wins; an unpin falls back to the most-purchased plan.
export const pinMostPopular = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  try {
    const parsed = pinSchema.safeParse(req.body);
    if (!parsed.success) {
      return failure(res, "Invalid body. Expected { scope, planId, pinned }.", 422);
    }
    const { scope, planId, pinned } = parsed.data;
    const r = await setPinned(scope as PopularityScope, planId, pinned);
    if (r === "not_found") return failure(res, "Plan not found in this scope.", 404);
    logger.info("pinMostPopular success", { traceId, scope, planId, pinned });
    return success(res, { scope, planId, pinned }, pinned ? "Plan pinned as Most Popular." : "Plan unpinned.");
  } catch (err) {
    logger.error("pinMostPopular failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to update Most Popular pin.", 500);
  }
};

// POST /api/v1/admin/plan-popularity/recompute   body: { scope? }
// Force a recompute of the effective is_most_popular flags (one scope or all).
export const recomputeMostPopular = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  try {
    const scope = req.body?.scope as string | undefined;
    if (scope) {
      if (!POPULARITY_SCOPES.includes(scope as PopularityScope)) {
        return failure(res, `Invalid scope. One of: ${POPULARITY_SCOPES.join(", ")}.`, 422);
      }
      const changed = await recomputeScope(scope as PopularityScope);
      logger.info("recomputeMostPopular (scope) success", { traceId, scope, changed });
      return success(res, { scope, changed }, "Recomputed.");
    }
    const changed = await recomputeAllPopularity();
    logger.info("recomputeMostPopular (all) success", { traceId, changed });
    return success(res, { changed }, "Recomputed all scopes.");
  } catch (err) {
    logger.error("recomputeMostPopular failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to recompute Most Popular.", 500);
  }
};
