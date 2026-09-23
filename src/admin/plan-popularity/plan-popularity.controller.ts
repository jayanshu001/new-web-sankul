import { Request, Response } from "express";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import {
  recomputeScope,
  recomputeAllPopularity,
  POPULARITY_SCOPES,
  type PopularityScope,
} from "../../modules/plan-popularity/plan-popularity.service";

// NOTE: `pinMostPopular` (POST /pin) was removed 2026-08-05 with the
// `most_popular_pinned` column — the "Most Popular" badge is fully automatic and
// has no admin override. See docs/admin/MOST_POPULAR_PLAN_PIN.md.

// POST /api/v1/admin/plan-popularity/recompute   body: { scope? }
// Force a recompute of the effective is_most_popular flags (one scope or all).
// The scheduler already sweeps every PLAN_POPULARITY_REFRESH_HOURS; this is the
// manual "don't wait for tonight" trigger.
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
