// "Logout from all devices" handler shared by all four auth surfaces so the revocation
// contract cannot drift. `revokeAllTokensForUser` sets a per-user Redis cutoff that
// `authenticate` compares against each JWT's `iat`; `extraTeardown` does surface-specific cleanup.

import type { Request, Response, RequestHandler } from "express";
import { revokeAllTokensForUser, UserType } from "../libs/tokenRevocation";
import { redisClient } from "../config/redis";
import { success, failure, getErrorMessage } from "../utils/httpResponse";
import logger from "../utils/logger";

export interface LogoutAllOptions {
  type: UserType;
  /** Runs after the cutoff is set; failures are only logged since the cutoff alone invalidates every token. */
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
        // Redis unreachable: existing tokens stay valid, but still clear the session
        // pointer (best-effort) and answer success so the client discards its token.
        logger.warn("logoutAllDevices: Redis cutoff write failed", {
          type: opts.type,
          userId,
        });
      }

      // Also fails in-flight requests on the session-pointer check in authenticate.ts.
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
