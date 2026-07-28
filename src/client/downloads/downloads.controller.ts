import { Request, Response } from "express";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import {
  parseCustomerId,
  getDownloadKey,
  saveDownloadKey,
} from "../../modules/client-download-key/client-download-key.service";
import { putEncryptionKeySchema } from "./downloads.validation";

/**
 * LOGGING RULE FOR THIS FILE: never log `key`, `req.body`, or a service DTO.
 * Log the customer id and a boolean/length at most. The request logger already
 * redacts the `key` body field (utils/scrub.ts), but these handlers are the one
 * place a stray `logger.info({ ...data })` would defeat that.
 */

/** Secrets must not sit in a proxy or browser cache after the response lands. */
const noStore = (res: Response) => {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Pragma", "no-cache");
};

// GET /api/v1/client/downloads/encryption-key
//
// Returns the AES-256 key belonging to the AUTHENTICATED customer only. A 404 is
// a meaningful state, not an error: it tells the app "you have never stored a
// key — generate one now". That is why a DB failure must surface as a 500 and
// never collapse into a 404, or the app would mint a second key and orphan every
// file it had already downloaded.
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
      // A vanished/soft-deleted account is an auth problem, not a "no key yet"
      // one — answering 404 there would tell the app to mint a fresh key for a
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

// PUT /api/v1/client/downloads/encryption-key
//
// Upsert for the authenticated customer. Body `{ key: "<64 hex>" }`; any other
// property (including a `userId`) is rejected by the strict schema — identity
// comes from the token, never the payload.
//
// Re-sending the stored key is a no-op (`changed: false`) and still answers 200,
// so the app's retry-on-failed-sync path is safe to run as often as it likes.
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

    // Parsed here rather than via the `validate({ body })` middleware so the
    // documented 400 + "Invalid encryption key" contract is preserved — the
    // shared middleware answers 422 with a field map, which this client does not
    // understand. Zod's own message rides along under `messages.key` for humans.
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
