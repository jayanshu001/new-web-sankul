// App assembly: Express middleware chain and API surface mounting.
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

import clientRoutes from "./client/client.routes";
import adminRoutes from "./admin/admin.routes";
import educatorRoutes from "./educator/educator.routes";
import promoterRoutes from "./promoter/promoter.routes";
import { razorpayPayoutWebhook } from "./webhooks/razorpay-payout.controller";

const app = express();

// Trust the first proxy hop so `req.ip` is the real client IP; otherwise per-IP rate
// limiting buckets all traffic under the LB's IP. Raise the count if more proxies are added.
app.set("trust proxy", 1);

// Every res.json() renders Dates as IST (+05:30) instead of UTC `...Z` (utils/istJson.ts).
app.set("json replacer", istJsonReplacer);

app.use(helmet());
app.use(compression());

initCrashReporter({
  emailTo: "ranavinit6834@gmail.com",
  appName: "WebSankulUpdate",
}); 

// Open CORS only for static uploads.
app.use(
  "/uploads",
  cors({ origin: true, methods: ["GET", "HEAD"], credentials: false })
);

app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// iOS Universal Links / Android App Links.
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

// Mounted outside /api/v1/* so share links stay unauthenticated and rate-limit-light.
app.use("/share", shareLimiter, deeplinkingRoutes);

// Live-course demo harness, served same-origin to avoid file:// CORS. Its inline and CDN
// scripts violate Helmet's default CSP, so the policy is relaxed on this route only.
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
        // Inline event handlers need this; Helmet defaults it to 'none' regardless of scriptSrc.
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

// API CORS allowlist from ALLOWED_ORIGINS (CSV). Boot env validation already requires it
// in production; as defense in depth, never fall back to localhost origins there.
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
      console.error(`Blocked by CORS: ${origin}`);
      return cb(null, false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
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

// morgan is dev-only: noisy at production RPS, and requestLogger already logs structurally.
if (process.env.NODE_ENV !== "production") {
  app.use(morgan("dev"));
}
app.use(requestLogger);
// Must follow requestLogger (seeds traceId) so everything downstream shares the context.
app.use(requestContextMiddleware);
app.use(metricsMiddleware);

// Body parsers: order matters. The limit is deliberately small: large uploads go
// direct-to-Spaces (presign) or through multer (streams), while a big limit lets one
// request allocate it all and `JSON.parse` block the event loop for seconds.
const BODY_LIMIT = process.env.BODY_LIMIT || "1mb";

// Only these prefixes keep the raw body (for HMAC checks), so other requests don't hold a
// second copy. Runs before the slash normalizer below, hence the collapse here too.
const RAW_BODY_PATHS = ["/api/v1/webhooks/", "/api/v1/client/webhook"];
const needsRawBody = (url: string): boolean => {
  const path = url.replace(/\/{2,}/g, "/");
  return RAW_BODY_PATHS.some((p) => path.startsWith(p));
};

// Parse only when Content-Type explicitly says JSON. Parsing a missing CT would drain
// the stream of multipart uploads whose CT a proxy stripped, so multer silently gets no file.
const isJsonContentType = (req: { headers: Record<string, any> }): boolean => {
  const ct = req.headers["content-type"] || "";
  return (
    ct.includes("application/json") ||
    ct.includes("+json") ||
    ct.includes("text/json")
  );
};

// Bulk question import is the one JSON payload that legitimately exceeds BODY_LIMIT.
// Mounted before the global parser, which then no-ops for an already-parsed body.
const BULK_BODY_LIMIT = process.env.BULK_BODY_LIMIT || "25mb";
app.use(
  "/api/v1/admin/quizzes/questions/bulk",
  express.json({ limit: BULK_BODY_LIMIT, type: isJsonContentType, strict: true })
);

app.use(
  express.json({
    limit: BODY_LIMIT,
    type: isJsonContentType,
    strict: true,
    verify: (req, _res, buf) => {
      if (needsRawBody(req.url || "")) {
        (req as any).rawBody = buf;
      }
    },
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: BODY_LIMIT,
  })
);

app.use(
  express.text({
    type: ["text/plain", "application/graphql"],
    limit: "2mb",
  })
);

// Collapse repeated slashes so misconfigured clients (//api/v1) still hit valid routes.
app.use((req, _res, next) => {
  if (req.url.includes("//")) {
    req.url = req.url.replace(/\/{2,}/g, "/");
  }
  next();
});

// Crash context: after parsers, before routes.
app.use(captureCrashContextMiddleware());

// Before every route so the patched `res.json` is in place when any handler answers:
// catches controllers that send `error.message` in a 5xx directly and so never reach
// errorHandler. Non-5xx bodies pass through untouched.
app.use(responseSanitizer);

app.get("/index.php", async (_req, res) => res.json({ Project: "WebSankul-API" }));
app.get("/api", (_req, res) => res.json({ Project: "WebSankul-API" }));

if (process.env.NODE_ENV !== "production") {
  app.get("/demo/live-chat", (_req, res) => {
    res.setHeader("Content-Security-Policy", "");
    res.sendFile(path.join(process.cwd(), "docs", "live-chat-demo.html"));
  });
  app.get("/demo/live-course", (_req, res) => {
    res.setHeader("Content-Security-Policy", "");
    res.sendFile(path.join(process.cwd(), "docs", "live-course-demo.html"));
  });
}

// Health and metrics are mounted before the rate limiters so probe/scrape storms are
// never 429d. The probes are public and expose only a boolean per dependency.
app.get("/healthz", livenessHandler);
app.get("/readyz", readinessHandler);

app.get("/health", healthReportHandler);

// Prometheus scrape, gated by the static METRICS_TOKEN bearer. Unset token → 503 rather
// than exposing internal rates publicly.
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

// Client: `clientLimiter` (per user, burst-friendly for parallel home-screen fetches).
// Admin: its own per-admin limiter inside adminRoutes, so not double-limited.
// Educator/promoter: `globalLimiter`. IP fallbacks rely on `trust proxy` above.
app.use("/api/v1/client", clientLimiter, clientRoutes);

app.use("/api/v1/admin", adminRoutes);

app.use("/api/v1/educator", globalLimiter, educatorRoutes);

app.use("/api/v1/promoter", globalLimiter, promoterRoutes);

// HMAC-verified (no Bearer) and unthrottled, since the provider retries. Drain-only:
// withdrawals are paid manually now, so this only settles payouts already in flight.
// Safe to delete (with razorpay-payout.controller.ts, client/payment/razorpayx.ts and
// RAZORPAY_PAYOUT_WEBHOOK_SECRET) once prod has zero rows from:
//   SELECT id FROM ws_refferal_transaction WHERE status='pending' AND reference_number IS NOT NULL;
app.post("/api/v1/webhooks/razorpay-payout", razorpayPayoutWebhook);

// Body-parser throws SyntaxError on invalid JSON; answer 400.
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

app.use(notFoundMiddleware);
app.use(errorHandler);

export default app;
