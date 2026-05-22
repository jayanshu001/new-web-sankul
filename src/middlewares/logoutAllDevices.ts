// src/middlewares/logoutAllDevices.ts
//
// One-handler-fits-all "logout from all devices" endpoint factory. Used by
// all four auth surfaces (client, admin, educator, promoter) so the
// revocation contract is identical everywhere and there's only one place to
// fix if the cutoff semantics change.
//
// What this does:
//   1. Calls `revokeAllTokensForUser(type, req.user.id)` → sets a per-user
//      cutoff in Redis. The `authenticate` middleware checks this cutoff
//      against the incoming JWT's `iat` on every subsequent request.
//   2. Lets the caller pass an optional `extraTeardown` hook for type-
//      specific cleanup (e.g. clearing the single-device session pointer,
//      flagging DB rows as inactive). The auth services already expose
//      logout helpers that do that work; this handler doesn't duplicate it.
//
// Why a factory rather than 4 near-identical handlers: the only difference
// between the 4 endpoints is the UserType string + the optional cleanup.
// Centralizing prevents drift (e.g. someone forgetting to call
// `revokeAllTokensForUser` on one of the four surfaces).

import type { Request, Response, RequestHandler } from "express";
import { revokeAllTokensForUser, UserType } from "../libs/tokenRevocation";
import { redisClient } from "../config/redis";
import { success, failure, getErrorMessage } from "../utils/httpResponse";
import logger from "../utils/logger";

export interface LogoutAllOptions {
  type: UserType;
  /** Optional teardown — runs AFTER the revocation cutoff is set. Failures
   *  are logged but don't fail the request because the cutoff alone is
   *  enough to invalidate every outstanding token. */
  extraTeardown?: (userId: string) => Promise<void>;
}

export const logoutAllDevicesHandler = (opts: LogoutAllOptions): RequestHandler => {
  return async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      return failure(res, "Unauthorized.", 401);
    }

    try {
      const ok = await revokeAllTokensForUser(opts.type, userId);
      if (!ok) {
        // Redis was unreachable. The cutoff write failed, so existing
        // tokens are still valid — but we can still clear the single-
        // device session pointer (best-effort) and tell the client to
        // discard its local token. Don't return 500: the client should
        // proceed with discard.
        logger.warn("logoutAllDevices: Redis cutoff write failed", {
          type: opts.type,
          userId,
        });
      }

      // Clear the single-device session pointer too, so any in-flight
      // request using the now-expired-cutoff token also fails the existing
      // "active session pointer matches" check in authenticate.ts.
      try {
        await redisClient.del(`${opts.type}_session:${userId}`);
      } catch {
        // best-effort
      }

      if (opts.extraTeardown) {
        try {
          await opts.extraTeardown(userId);
        } catch (err) {
          logger.warn("logoutAllDevices: extraTeardown failed", {
            type: opts.type,
            userId,
            err: getErrorMessage(err),
          });
        }
      }

      logger.info("logoutAllDevices: success", { type: opts.type, userId });
      return success(res, {}, "Logged out from all devices.");
    } catch (err) {
      logger.error("logoutAllDevices: handler failed", {
        type: opts.type,
        userId,
        err: getErrorMessage(err),
      });
      return failure(res, "Failed to log out from all devices.", 500);
    }
  };
};
