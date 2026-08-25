// app.ts
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import path from "path";

import requestLogger from "./utils/requestLogger";
import notFoundMiddleware from "./middlewares/notFound";
import errorHandler from "./middlewares/errorHandler";
import { clientLimiter, globalLimiter, shareLimiter } from "./config/rateLimiter";
import {
  initCrashReporter,
  captureCrashContextMiddleware,
} from "./utils/crashReporter";
import { metricsMiddleware } from "./middlewares/metricsMiddleware";
import { responseSanitizer } from "./middlewares/responseSanitizer";
import { renderMetrics } from "./utils/metrics";
import {
  livenessHandler,
  readinessHandler,
  healthReportHandler,
} from "./middlewares/health";
import { requestContextMiddleware } from "./middlewares/requestContext";
import deeplinkingRoutes from "./deeplinking/deeplinking.routes";
import { isAllowedOrigin, parseAllowedOrigins } from "./config/corsOrigins";
import { istJsonReplacer } from "./utils/istJson";

// ─── Route modules ──────────────────────────────────────────────────────────
import clientRoutes from "./client/client.routes";
import adminRoutes from "./admin/admin.routes";
import educatorRoutes from "./educator/educator.routes";
import promoterRoutes from "./promoter/promoter.routes";
import { razorpayPayoutWebhook } from "./webhooks/razorpay-payout.controller";

const app = express();

// Behind a load balancer / reverse proxy: trust the first proxy hop so `req.ip`
// reflects the real client IP (from X-Forwarded-For) instead of the LB's IP.
// Without this, per-IP rate limiting would bucket ALL traffic under one LB IP.
// Increase the hop count if there is more than one proxy in front of the app.
app.set("trust proxy", 1);

// Render all Date values in JSON responses as IST (ISO-8601 with +05:30) instead
// of the default UTC `...Z`. Storage stays UTC; this is display-only and applies to
// every res.json() centrally. See utils/istJson.ts.
app.set("json replacer", istJsonReplacer);

// --- Security & Performance -------------------------------------------------
app.use(helmet());
app.use(compression());

// --- Crash Reporter ---------------------------------------------------------
initCrashReporter({
  emailTo: "ranavinit6834@gmail.com",
  appName: "WebSankulUpdate",
}); 

// --- CORS -------------------------------------------------------------------
// 1) Open CORS only for static uploads
app.use(
  "/uploads",
  cors({ origin: true, methods: ["GET", "HEAD"], credentials: false })
);

// 2) Serve static uploads
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// --- Well-known files (iOS Universal Links / Android App Links) -------------
const appleAASA = path.join(process.cwd(), "public", ".well-known", "apple-app-site-association");
const assetLinks = path.join(process.cwd(), "public", ".well-known", "assetlinks.json");

app.get(
  ["/.well-known/apple-app-site-association", "/apple-app-site-association"],
  (_req, res, next) =>
    res
      .type("application/json")
      .sendFile(appleAASA, { dotfiles: "allow" }, (err) => err && next(err))
);

app.get(
  ["/.well-known/assetlinks.json", "/assetlinks.json"],
  (_req, res, next) =>
    res
      .type("application/json")
      .sendFile(assetLinks, { dotfiles: "allow" }, (err) => err && next(err))
);

// --- Public deep-link / share routes ---------------------------------------
// Mounted OUTSIDE /api/v1/* so they stay unauthenticated and rate-limit-light.
// Add new share surfaces in src/deeplinking/deeplinking.routes.ts.
app.use("/share", shareLimiter, deeplinkingRoutes);

// 2b) Live-course demo harness — served same-origin to dodge the file:// CORS trap.
// The page uses an inline <script> + two CDN scripts (hls.js, socket.io), both of
// which violate Helmet's default CSP. Relax the policy on this single route only.
app.get(
  "/demo",
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://cdn.jsdelivr.net",
          "https://cdn.socket.io",
        ],
        // The HTML uses inline event handlers (onclick="…"); Helmet defaults
        // this directive to 'none', which blocks them even when scriptSrc
        // allows 'unsafe-inline'.
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'", "ws:", "wss:", "http:", "https:"],
        mediaSrc: ["'self'", "blob:", "data:", "http:", "https:"],
        imgSrc: ["'self'", "data:", "blob:", "http:", "https:"],
      },
    },
  }),
  (_req, res) =>
    res.sendFile(path.join(process.cwd(), "docs", "live-course-demo.html"))
);

// 3) Stricter API CORS (handles preflight)
//
// Allowlist is read from ALLOWED_ORIGINS (CSV). In production this env var
// MUST be set — env validation at boot already fails the process if it's
// missing, but as a defense-in-depth we also refuse to fall back to localhost
// origins here when NODE_ENV=production.
const allowedOriginsRaw = process.env.ALLOWED_ORIGINS;
const isProd = process.env.NODE_ENV === "production";

if (isProd && (!allowedOriginsRaw || allowedOriginsRaw.trim() === "")) {
  // eslint-disable-next-line no-console
  console.error("[cors] FATAL: ALLOWED_ORIGINS is unset in production.");
  process.exit(1);
}

const allowedOrigins = parseAllowedOrigins(
  allowedOriginsRaw,
  "http://localhost:3000,http://localhost:5173,http://localhost:5174"
);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (isAllowedOrigin(origin, allowedOrigins)) return cb(null, true);
      console.error(`Blocked by CORS: ${origin}`); // Log blocked origin for debugging
      return cb(null, false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    // include common headers and any custom ones you use
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Accept",
      "x-refresh-token",
      "X-Requested-With",
    ],
    credentials: true,
  })
);

// --- Logging ---------------------------------------------------------------
// morgan's per-request line is useful in dev but noisy + I/O-heavy at production
// RPS (requestLogger already captures structured start/complete logs). Gate it off
// in production.
if (process.env.NODE_ENV !== "production") {
  app.use(morgan("dev"));
}
app.use(requestLogger);
// Open the AsyncLocalStorage scope immediately after requestLogger seeds the
// traceId — every downstream middleware, route handler, mongoose hook, and
// cache call now sees the same per-request context object. See
// utils/requestContext.ts for what flows through it.
app.use(requestContextMiddleware);
app.use(metricsMiddleware);

// --- Body Parsers (order matters) ------------------------------------------
// A) RAW routes FIRST (e.g., Stripe webhooks need raw body). Example:
//    app.post("/webhooks/stripe", express.raw({ type: "application/json" }), stripeWebhookHandler);

// Body-size ceiling for parsed bodies. Deliberately SMALL: large uploads never
// pass through these parsers — ebook PDFs (<=500MB) go direct-to-Spaces via
// `/admin/uploads/presign`, and multipart uploads are handled by multer, which
// streams. A high limit here buys nothing and costs everything: one request can
// allocate the whole limit, and `JSON.parse` on a huge body blocks the event
// loop for seconds, stalling every other request on the worker. Override per
// environment via BODY_LIMIT only if a real payload (bulk admin import) needs it.
const BODY_LIMIT = process.env.BODY_LIMIT || "1mb";

// Only these prefixes need the raw body retained for HMAC signature checks.
// Keeping the capture scoped means we don't hold a SECOND full copy of every
// JSON body on every request just so two webhook routes can verify a signature.
// NOTE: this runs BEFORE the repeated-slash normalizer below, so collapse
// slashes here too — `//api/v1/webhooks/...` must still be recognised.
const RAW_BODY_PATHS = ["/api/v1/webhooks/", "/api/v1/client/webhook"];
const needsRawBody = (url: string): boolean => {
  const path = url.replace(/\/{2,}/g, "/");
  return RAW_BODY_PATHS.some((p) => path.startsWith(p));
};

// Accept application/json, application/*+json, text/json.
// NOTE: do NOT parse when Content-Type is missing. A no-CT fallback here
// drains the request stream for ANY body-less-CT POST/PUT/PATCH — including
// multipart/form-data uploads whose CT was stripped by a proxy — leaving
// multer with an empty stream (req.file === undefined) and silently
// dropping file uploads. Only parse when the CT explicitly says JSON.
const isJsonContentType = (req: { headers: Record<string, any> }): boolean => {
  const ct = req.headers["content-type"] || "";
  return (
    ct.includes("application/json") ||
    ct.includes("+json") ||
    ct.includes("text/json")
  );
};

// B0) Genuinely-large JSON routes, mounted BEFORE the global parser so they get
// their own ceiling (once a body is parsed here, the global parser below is a
// no-op for that request). Bulk question import is the only known JSON payload
// that can legitimately exceed the global limit — a few thousand questions of
// Gujarati text. Everything else large is multipart (multer) or presigned.
const BULK_BODY_LIMIT = process.env.BULK_BODY_LIMIT || "25mb";
app.use(
  "/api/v1/admin/quizzes/questions/bulk",
  express.json({ limit: BULK_BODY_LIMIT, type: isJsonContentType, strict: true })
);

// B) JSON: accept typical JSON + JSON-without-correct-CT + JSON subtypes
app.use(
  express.json({
    limit: BODY_LIMIT,
    type: isJsonContentType,
    // Graceful JSON parse error -> let our middleware catch it
    strict: true,
    // Stash raw body ONLY for the routes that HMAC-verify it (Razorpay payout
    // webhook + client payment webhook). Every other route gets the parsed body
    // alone — see RAW_BODY_PATHS above.
    verify: (req, _res, buf) => {
      if (needsRawBody(req.url || "")) {
        (req as any).rawBody = buf;
      }
    },
  })
);

// C) URL-encoded forms (HTML forms, axios default for FormData without files)
app.use(
  express.urlencoded({
    extended: true,
    limit: BODY_LIMIT,
  })
);

// D) text/* (if you sometimes POST plain text or GraphQL)
app.use(
  express.text({
    type: ["text/plain", "application/graphql"],
    limit: "2mb",
  })
);

// Normalize repeated slashes in request path (e.g. //api/v1 -> /api/v1)
// so misconfigured clients don't miss valid routes.
app.use((req, _res, next) => {
  if (req.url.includes("//")) {
    req.url = req.url.replace(/\/{2,}/g, "/");
  }
  next();
});

// E) (Optional) catch-all raw for binary uploads to specific endpoints
// Put this BEFORE the route that needs it (not globally), e.g.:
// app.post("/api/files/raw", express.raw({ type: "*/*", limit: "50mb" }), rawFileHandler);

// --- Crash context AFTER parsers, BEFORE routes ----------------------------
app.use(captureCrashContextMiddleware());

// --- 5xx message sanitiser -------------------------------------------------
//
// Mounted BEFORE every route so the patched `res.json` is in place by the time
// any handler answers. It rewrites `message` ONLY on responses with status >=
// 500, so a deploy/DB blip shows "Internal Server Error" instead of a Prisma
// invocation + compiled file path. 2xx/4xx bodies pass through untouched.
//
// This is the net for the ~540 controller catch blocks that answer with
// `res.status(500).json({ message: error.message })` directly and therefore
// never reach errorHandler at the bottom of this file. The raw text is still
// logged — see middlewares/responseSanitizer.ts.
app.use(responseSanitizer);

// --- Health/Index ----------------------------------------------------------
app.get("/index.php", async (_req, res) => res.json({ Project: "WebSankul-API" }));
app.get("/api", (_req, res) => res.json({ Project: "WebSankul-API" }));

// --- Live Chat Demo (dev only) ---------------------------------------------
if (process.env.NODE_ENV !== "production") {
  app.get("/demo/live-chat", (_req, res) => {
    res.setHeader("Content-Security-Policy", ""); // allow inline scripts & CDN in demo
    res.sendFile(path.join(process.cwd(), "docs", "live-chat-demo.html"));
  });
  // Live course streaming test harness (admin go-live + customer join/watch).
  app.get("/demo/live-course", (_req, res) => {
    res.setHeader("Content-Security-Policy", "");
    res.sendFile(path.join(process.cwd(), "docs", "live-course-demo.html"));
  });
}

// --- Health probes ---------------------------------------------------------
//
// Mounted BEFORE the global rate limiter so health-check storms (k8s default
// is 1Hz per pod) don't get 429d. Both endpoints are public — they leak only
// the pre-existing readyState + a boolean per dependency, nothing sensitive.
app.get("/healthz", livenessHandler);
app.get("/readyz", readinessHandler);

// Public full-status report (no auth): DB + Redis + BullMQ queue/worker detail.
// A dashboard/uptime-monitor endpoint — always 200, with the snapshot in the body.
app.get("/health", healthReportHandler);

// --- Metrics endpoint ------------------------------------------------------
//
// Token-gated Prometheus scrape endpoint. Mounted BEFORE the global rate
// limiter so a scrape storm doesn't get throttled like user traffic. Auth
// is a single static bearer token in METRICS_TOKEN — sufficient because
// the value is a long random string set in the env, never logged, and
// only consumed by your Prometheus scrape config.
//
// If METRICS_TOKEN is unset, the endpoint refuses to render (503) — better
// than exposing internal RPS/error rates publicly by accident.
app.get("/metrics", (req, res) => {
  const expected = process.env.METRICS_TOKEN;
  if (!expected) {
    return res.status(503).send("# METRICS_TOKEN not configured\n");
  }
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== expected) {
    return res.status(401).send("# unauthorized\n");
  }
  res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  return res.status(200).send(renderMetrics() + "\n");
});

// --- Routes ----------------------------------------------------------------
// Client uses `clientLimiter` (300/min per user, burst-friendly for home-screen
// parallel fetches). Educator/promoter use `globalLimiter`. Admin has its own
// per-admin `adminLimiter` (240/min) inside adminRoutes — not double-limited.
// Razorpay webhook is HMAC-verified and must not be throttled (provider retries).
// Health/metrics are mounted above limiters and stay unaffected.
// Relies on `trust proxy` (set above) so IP fallbacks key on the real client IP.
// Master Client Routes (Mobile App / Web Portal)
app.use("/api/v1/client", clientLimiter, clientRoutes);

// Master Admin Routes (Dashboard) — own per-admin limiter inside adminRoutes
app.use("/api/v1/admin", adminRoutes);

// Master Educator Routes (Educator Portal)
app.use("/api/v1/educator", globalLimiter, educatorRoutes);

// Master Promoter Routes (Promoter Portal)
app.use("/api/v1/promoter", globalLimiter, promoterRoutes);

// Inbound webhooks (HMAC-verified; no Bearer auth — request authenticity is proven by signature)
app.post("/api/v1/webhooks/razorpay-payout", razorpayPayoutWebhook);


// --- 400 on bad JSON (syntax) ----------------------------------------------
// Body-parser throws SyntaxError for invalid JSON. Convert to 400 here.
app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({
      success: false,
      message: "Invalid JSON in request body",
      detail: err.message,
    });
  }
  next(err);
});

// --- 404 + Central Error ----------------------------------------------------
app.use(notFoundMiddleware);
app.use(errorHandler);

export default app;
