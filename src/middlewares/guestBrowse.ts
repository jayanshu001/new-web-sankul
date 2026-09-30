// src/middlewares/guestBrowse.ts
import { Request, Response, NextFunction } from "express";
import { isLiveGuestToken } from "../libs/guestSession";

/**
 * Guest browse — what a guest token may read.
 *
 * `markGuestBrowse` runs once at the top of the client router and sets
 * `req.isGuest` for a GET on an allowlisted path that carries a LIVE GUEST TOKEN
 * (libs/guestSession.ts: valid signature AND Firebase `maintain.env === "staging"`).
 * `authenticate` and `requireRole` let a flagged request through with no `req.user`;
 * controllers then serve the not-purchased view (`customerId = null`).
 *
 * Fail-closed by construction:
 *  - Every request needs a Bearer token. Tokenless is always 401.
 *  - Guest mode off (Firebase not "staging", or unreadable) → the guest token is
 *    dead everywhere: `authenticate` answers 401 GUEST_SESSION_EXPIRED.
 *  - Anything not listed here keeps strict auth — the per-router
 *    `router.use(authenticate)` gates are untouched. A guest token there is
 *    rejected by `authenticate` (403 ACCOUNT_REQUIRED).
 *  - A customer token is NEVER a guest. It goes through full `authenticate`, so
 *    an expired/revoked token still answers 401 and the app still logs the user
 *    out instead of silently showing "not purchased".
 *  - Only GET. No write is ever guest-reachable.
 *
 * Paths are relative to /api/v1/client. `:id` = digits only, which is what keeps
 * `/packages/my`, `/books/orders`, `/live-courses/my/...` strict.
 * Deliberately NOT listed (playback / per-user): `/courses/lecture`,
 * `/video-categories/:id/videos/:id`, `/live-courses/:id/recordings*`,
 * `/live-courses/:id/lecture/:id`, `/media/*`, every `/my*`, orders, progress.
 */
export const GUEST_BROWSE_PATHS = [
  // dashboard
  "/dashboard",
  "/free-dashboard",
  // cms
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
  // goals (list only — /goals/my-goals stays strict)
  "/goals",
  // packages
  "/packages",
  "/packages/types",
  "/packages/type/:id",
  "/packages/goal",
  "/packages/:id",
  // courses
  "/courses",
  "/courses/categories",
  "/courses/categories/:id/courses",
  "/courses/:id",
  // category drill-downs
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
  // catalog
  "/catalog/:type/:id/videos",
  "/catalog/:type/:id/materials",
  "/catalog/:type/:id/tests",
  // educators
  "/educators/:id",
  // books + ebooks
  "/books",
  "/books/trending",
  "/books/trending/books",
  "/books/trending/ebooks",
  "/books/:id",
  "/ebooks",
  "/ebooks/:id",
  // offline
  "/offline",
  "/offline/centers",
  "/offline/centers/:id",
  "/offline/batches",
  "/offline/batches/:id",
  // free
  "/free-tests",
  "/free-materials",
  "/free-videos",
  "/free-ebooks",
  "/free-courses",
  // recently added + exam countdowns
  "/recently-added",
  "/exam-countdowns",
  "/exam-countdowns/categories",
  "/exam-countdowns/upcoming",
  // live courses
  "/live-courses",
  "/live-courses/recently-added",
  "/live-courses/upcoming-batches",
  "/live-courses/upcoming-sessions",
  "/live-courses/live-now-sessions",
  "/live-courses/:id",
  "/live-courses/:id/sessions",
  "/live-courses/:id/schedule",
  // test series
  "/test-series",
  "/test-series/:id",
  "/test-series/:id/papers",
  // search (history stays strict)
  "/search",
  // app start-up reads (no per-user data) — the app fires these before any screen
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

/** True when the path (relative to /api/v1/client) is guest-browsable. */
export const isGuestBrowsePath = (path: string): boolean => GUEST_BROWSE.some((re) => re.test(path));

export const markGuestBrowse = async (req: Request, _res: Response, next: NextFunction) => {
  if (req.method !== "GET" || !isGuestBrowsePath(req.path)) return next();
  const token = /^bearer\s+(\S+)/i.exec(req.headers.authorization || "")?.[1];
  // A dead guest token is left unflagged so `authenticate` answers GUEST_SESSION_EXPIRED.
  if (token && (await isLiveGuestToken(token))) req.isGuest = true;
  return next();
};
