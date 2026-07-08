import { Request, Response } from "express";
import { ZodError } from "zod";
import { checkAppVersion } from "../../modules/app-version/app-version.service";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import { checkAppVersionQuerySchema } from "./app-version.validation";

// GET /api/v1/client/app-version/check?platform=ios|android&currentVersion=120&currentVersionName=1.2.0
// Returns whether the calling app is up to date, and — via `isForceUpdate` —
// whether it must update before continuing.
//
// NOTE: query is parsed HERE, not via the `validate({ query })` middleware.
// Express 5 makes `req.query` a getter-only property, so the middleware's
// `req.query = parsed` reassignment throws. Parsing locally sidesteps that.
export const checkAppVersionHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;

  const parsed = checkAppVersionQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    const messages: Record<string, string> = {};
    for (const issue of (parsed.error as ZodError).issues) {
      const key = issue.path.join(".") || "_";
      if (!messages[key]) messages[key] = issue.message;
    }
    return failure(res, "Validation failed.", 422, messages);
  }
  const query = parsed.data;

  logger.info("checkAppVersion invoked", {
    traceId,
    platform: query.platform,
    currentVersion: query.currentVersion,
    currentVersionName: query.currentVersionName,
  });

  try {
    const data = await checkAppVersion({
      platform: query.platform,
      currentVersion: query.currentVersion,
      currentVersionName: query.currentVersionName,
    });

    logger.info("checkAppVersion success", {
      traceId,
      platform: data.platform,
      isUpdateAvailable: data.isUpdateAvailable,
      isForceUpdate: data.isForceUpdate,
      source: data.source,
    });
    return success(res, data, "App version checked successfully.");
  } catch (e: any) {
    logger.error("checkAppVersion failed", {
      traceId,
      error: getErrorMessage(e),
      stack: e.stack,
    });
    return failure(res, "Failed to check app version.", 500);
  }
};
