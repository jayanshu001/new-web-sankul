// src/middlewares/idempotency.ts
import { Request, Response, NextFunction, RequestHandler } from "express";
import crypto from "crypto";
import { redisClient, isRedisReady } from "../config/redis";
import { failure } from "../utils/httpResponse";
import logger from "../utils/logger";

/**
 * Idempotency middleware — for mutating endpoints (payments, referral credits,
 * order creation) where a retried client request must not double-apply.
 *
 * Contract:
 *   - Client sends `Idempotency-Key: <opaque string>` header on POST/PUT/PATCH.
 *   - First request: middleware stores a fingerprint + reserves the key.
 *     The wrapped handler runs; its response body is cached under the key.
 *   - Replay with same key + same payload: previously-cached response is
 *     replayed verbatim (same status + body).
 *   - Replay with same key + DIFFERENT payload: 409 conflict.
 *   - Missing key on a configured route: 400.
 *   - Redis unavailable: fail-open with a warn (do not block writes on cache).
 *
 * Storage: `idem:{scope}:{key}` -> JSON { fingerprint, status, body, ts }
 * TTL: 24h default.
 */
export interface IdempotencyOptions {
  scope: string; // logical namespace, e.g. "referral", "payment"
  required?: boolean; // 400 if header missing (default true)
  ttlSeconds?: number; // default 86400
}

const fingerprintRequest = (req: Request): string => {
  const payload = JSON.stringify({
    method: req.method,
    path: req.originalUrl,
    body: req.body ?? null,
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
};

export const idempotency = (opts: IdempotencyOptions): RequestHandler => {
  const ttl = opts.ttlSeconds ?? 86400;
  const required = opts.required ?? true;

  return async (req: Request, res: Response, next: NextFunction) => {
    const key = (req.header("Idempotency-Key") || "").trim();

    if (!key) {
      if (required) {
        return failure(
          res,
          "Idempotency-Key header is required for this endpoint.",
          400
        );
      }
      return next();
    }

    if (!isRedisReady()) {
      logger.warn("Idempotency: Redis not ready; failing open", {
        scope: opts.scope,
        key,
      });
      return next();
    }

    const storeKey = `idem:${opts.scope}:${key}`;
    const fp = fingerprintRequest(req);

    try {
      const cached = await redisClient.get(storeKey);
      if (cached) {
        const parsed = JSON.parse(cached) as {
          fingerprint: string;
          status: number;
          body: any;
        };
        if (parsed.fingerprint !== fp) {
          return failure(
            res,
            "Idempotency-Key reused with a different payload.",
            409
          );
        }
        return res.status(parsed.status).json(parsed.body);
      }
    } catch (err) {
      logger.warn("Idempotency: cache read failed; failing open", {
        scope: opts.scope,
        key,
        err: (err as Error).message,
      });
      return next();
    }

    // Wrap res.json to capture and persist the first successful response.
    const originalJson = res.json.bind(res);
    (res as any).json = (body: any) => {
      const status = res.statusCode;
      // Persist async; do not block the response.
      void redisClient
        .set(
          storeKey,
          JSON.stringify({ fingerprint: fp, status, body, ts: Date.now() }),
          "EX",
          ttl,
          "NX"
        )
        .catch((err) =>
          logger.warn("Idempotency: cache write failed", {
            scope: opts.scope,
            key,
            err: (err as Error).message,
          })
        );
      return originalJson(body);
    };

    return next();
  };
};

export default idempotency;
