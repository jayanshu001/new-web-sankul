// Guest browse: lets the guest token through allow-listed catalog GETs.
import { Request, Response, NextFunction } from "express";
import { isLiveGuestToken } from "../libs/guestSession";

/**
 * What a guest token may read. `markGuestBrowse` runs at the top of the client router
 * and sets `req.isGuest` for a GET on an allowlisted path carrying a live guest token
 * (libs/guestSession.ts: valid signature AND Firebase `maintain.env === "staging"`).
 * `authenticate`/`requireRole` let it through with no `req.user`; controllers serve the
 * not-purchased view (`customerId = null`).
 *
 * Fail-closed by construction:
 *  - Tokenless is always 401.
 *  - Guest mode off (or Firebase unreadable): `authenticate` answers 401 GUEST_SESSION_EXPIRED.
 *  - Unlisted paths keep their `router.use(authenticate)` gates; a guest token there is
 *    403 ACCOUNT_REQUIRED.
 *  - A customer token is never a guest, so an expired/revoked one still answers 401 and
 *    the app logs out instead of silently showing "not purchased".
 *  - GET only; no write is ever guest-reachable.
 *
 * Paths are relative to /api/v1/client. `:id` matches digits only, which keeps
 * `/packages/my`, `/books/orders`, `/live-courses/my/...` strict. Deliberately not listed
 * (playback / per-user): `/courses/lecture`, `/video-categories/:id/videos/:id`,
 * `/live-courses/:id/recordings*`, `/live-courses/:id/lecture/:id`, `/media/*`, every
 * `/my*`, orders, progress.
 */
export const GUEST_BROWSE_PATHS = [
  "/dashboard",
  "/free-dashboard",
  "/faqs",
  "/faq-types",
  "/popup",
  "/banners",
  "/live-banners",
  "/testimonials",
  "/social-links",
  "/social-link-types",
  "/current-affairs",
  "/terms",
  // list only; /goals/my-goals stays strict
  "/goals",
  "/packages",
  "/packages/types",
  "/packages/type/:id",
  "/packages/goal",
  "/packages/:id",
  "/courses",
  "/courses/categories",
  "/courses/categories/:id/courses",
  "/courses/:id",
  "/video-categories/:id/videos",
  "/video-categories/:id/children",
  "/material-categories/:id/materials",
  "/material-categories/:id/children",
  "/exam-categories/:id/exams",
  "/exam-categories/:id/children",
  "/exam-countdown-categories/:id/packages",
  "/exam-countdown-categories/:id/books-ebooks",
  "/exam-countdown/:id/packages",
  "/exam-countdown/:id/books-ebooks",
  "/package-categories",
  "/package-categories/:id/packages",
  "/catalog/:type/:id/videos",
  "/catalog/:type/:id/materials",
  "/catalog/:type/:id/tests",
  "/educators/:id",
  "/books",
  "/books/trending",
  "/books/trending/books",
  "/books/trending/ebooks",
  "/books/:id",
  "/ebooks",
  "/ebooks/:id",
  "/offline",
  "/offline/centers",
  "/offline/centers/:id",
  "/offline/batches",
  "/offline/batches/:id",
  "/free-tests",
  "/free-materials",
  "/free-videos",
  "/free-ebooks",
  "/free-courses",
  "/recently-added",
  "/exam-countdowns",
  "/exam-countdowns/categories",
  "/exam-countdowns/upcoming",
  "/live-courses",
  "/live-courses/recently-added",
  "/live-courses/upcoming-batches",
  "/live-courses/upcoming-sessions",
  "/live-courses/live-now-sessions",
  "/live-courses/:id",
  "/live-courses/:id/sessions",
  "/live-courses/:id/schedule",
  "/test-series",
  "/test-series/:id",
  "/test-series/:id/papers",
  // search history stays strict
  "/search",
  // start-up reads with no per-user data; the app fires these before any screen
  "/app-version/check",
  "/version",
  "/upgrade",
  "/contactus",
  "/image-notifications",
  "/notifications/count",
];

const GUEST_BROWSE = GUEST_BROWSE_PATHS.map(
  (p) => new RegExp(`^${p.replace(/:type/g, "[a-z-]+").replace(/:id/g, "\\d+")}/?$`, "i")
);

export const isGuestBrowsePath = (path: string): boolean => GUEST_BROWSE.some((re) => re.test(path));

export const markGuestBrowse = async (req: Request, _res: Response, next: NextFunction) => {
  if (req.method !== "GET" || !isGuestBrowsePath(req.path)) return next();
  const token = /^bearer\s+(\S+)/i.exec(req.headers.authorization || "")?.[1];
  // A dead guest token is left unflagged so `authenticate` answers GUEST_SESSION_EXPIRED.
  if (token && (await isLiveGuestToken(token))) req.isGuest = true;
  return next();
};
