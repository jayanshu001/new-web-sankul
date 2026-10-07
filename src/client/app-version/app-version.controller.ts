// Client app version: HTTP handler comparing installed vs store version.
import { Request, Response } from "express";
import { ZodError } from "zod";
import { checkAppVersion } from "../../modules/app-version/app-version.service";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import { checkAppVersionQuerySchema } from "./app-version.validation";

// Query is parsed here rather than via `validate({ query })`: Express 5 makes
// `req.query` getter-only, so the middleware's reassignment throws.
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
