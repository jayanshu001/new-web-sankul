import { Request, Response } from "express";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import { resolveMediaToken } from "../../modules/client-media/client-media.service";

// POST /api/v1/client/media/resolve   { token: "<mediaToken>" }
// Exchanges a short-lived media token for the actual (short-lived) media URL(s).
// Re-verifies the token, binds it to the caller, and re-checks entitlement before
// resolving. This is the ONLY endpoint that returns a real media URL.
export const resolveMedia = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("resolveMedia invoked", { traceId, userId });

  try {
    if (!userId) return failure(res, "Unauthorized.", 401);
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    if (!token) return failure(res, "token is required.", 400);

    const cid = Number(userId);
    if (!Number.isInteger(cid)) return failure(res, "Unauthorized.", 401);

    const result = await resolveMediaToken(token, cid);
    if (!result.ok) {
      logger.warn("resolveMedia rejected", { traceId, userId, status: result.status, message: result.message });
      return failure(res, result.message, result.status);
    }
    return success(res, { kind: result.kind, media: result.media }, "Media resolved.", 200);
  } catch (err) {
    logger.error("resolveMedia failed", { traceId, userId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to resolve media.", 500);
  }
};
