// Client downloads: HTTP handlers for the per-user offline-download encryption key.
import { Request, Response } from "express";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import {
  parseCustomerId,
  getDownloadKey,
  saveDownloadKey,
} from "../../modules/client-download-key/client-download-key.service";
import { putEncryptionKeySchema } from "./downloads.validation";

// Never log `key`, `req.body`, or a service DTO here — customer id and a
// boolean/length at most. utils/scrub.ts redacts `key` in the request logger, but a
// stray `logger.info({ ...data })` in these handlers would defeat it.

/** Secrets must not sit in a proxy or browser cache after the response lands. */
const noStore = (res: Response) => {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Pragma", "no-cache");
};

// 404 means "no key stored yet, generate one", so a DB failure must surface as 500,
// never 404, or the app mints a second key and orphans every downloaded file.
export const getEncryptionKeyHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("getEncryptionKey invoked", { traceId, path: req.originalUrl, userId });

  try {
    const customerId = parseCustomerId(userId);
    if (customerId == null) {
      logger.warn("getEncryptionKey unauthorized", { traceId });
      return failure(res, "Unauthorized.", 401);
    }

    const result = await getDownloadKey(customerId);
    noStore(res);

    if (!result.ok) {
      // A vanished account is an auth problem: 404 would make the app mint a key for a
      // dead account instead of sending it back through login.
      if (result.reason === "customer_missing") {
        logger.warn("getEncryptionKey customer missing", { traceId, userId });
        return failure(res, "Unauthorized.", 401);
      }
      logger.info("getEncryptionKey miss", { traceId, userId });
      return failure(res, "Download encryption key not found", 404);
    }

    logger.info("getEncryptionKey success", { traceId, userId });
    return success(res, result.dto, "Download encryption key fetched.");
  } catch (err) {
    logger.error("getEncryptionKey failed", {
      traceId,
      userId,
      error: getErrorMessage(err),
      stack: (err as Error).stack,
    });
    return failure(res, "Something went wrong. Please try again later.", 500);
  }
};

// schema rejects any other property (identity comes from the token). Re-sending the
// stored key is a no-op 200, so the app's sync retry is safe.
export const putEncryptionKeyHandler = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("putEncryptionKey invoked", { traceId, path: req.originalUrl, userId });

  try {
    const customerId = parseCustomerId(userId);
    if (customerId == null) {
      logger.warn("putEncryptionKey unauthorized", { traceId });
      return failure(res, "Unauthorized.", 401);
    }

    // Parsed here instead of `validate({ body })` to keep the documented 400
    // "Invalid encryption key" contract; the middleware's 422 field map isn't understood
    // by this client.
    const parsed = putEncryptionKeySchema.safeParse(req.body);
    if (!parsed.success) {
      const detail = parsed.error.issues[0]?.message ?? "key must be exactly 64 hexadecimal characters";
      logger.warn("putEncryptionKey validation failed", { traceId, userId, detail });
      return failure(res, "Invalid encryption key", 400, { key: detail });
    }

    const result = await saveDownloadKey(customerId, parsed.data.key);
    noStore(res);

    if (!result.ok) {
      logger.warn("putEncryptionKey customer missing", { traceId, userId });
      return failure(res, "Unauthorized.", 401);
    }

    logger.info("putEncryptionKey success", { traceId, userId, changed: result.changed });
    return success(res, result.dto, "Download encryption key saved.");
  } catch (err) {
    logger.error("putEncryptionKey failed", {
      traceId,
      userId,
      error: getErrorMessage(err),
      stack: (err as Error).stack,
    });
    return failure(res, "Something went wrong. Please try again later.", 500);
  }
};
