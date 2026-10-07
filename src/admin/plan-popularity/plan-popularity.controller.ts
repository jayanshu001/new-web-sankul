// Admin plan popularity: HTTP handler to recompute the "Most Popular" plan badge.
import { Request, Response } from "express";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import {
  recomputeScope,
  recomputeAllPopularity,
  POPULARITY_SCOPES,
  type PopularityScope,
} from "../../modules/plan-popularity/plan-popularity.service";

// The "Most Popular" badge is fully automatic; there is no admin pin override.

// Manual recompute of is_most_popular (one scope or all) without waiting for the
// scheduler's PLAN_POPULARITY_REFRESH_HOURS sweep.
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
