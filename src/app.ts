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
import { globalLimiter } from "./config/rateLimiter";
import {
  initCrashReporter,
  captureCrashContextMiddleware,
} from "./utils/crashReporter";

// ─── Route modules ──────────────────────────────────────────────────────────
import clientRoutes from "./client/client.routes";
import adminRoutes from "./admin/admin.routes";
import educatorRoutes from "./educator/educator.routes";
import promoterRoutes from "./promoter/promoter.routes";
import { razorpayPayoutWebhook } from "./webhooks/razorpay-payout.controller";

const app = express();

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

// 3) Stricter API CORS (handles preflight)
const allowedOrigins = (
  process.env.ALLOWED_ORIGINS ??
  "http://localhost:3000,http://localhost:5173,http://localhost:5174"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);


app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
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
app.use(morgan("dev"));
app.use(requestLogger);

// --- Body Parsers (order matters) ------------------------------------------
// A) RAW routes FIRST (e.g., Stripe webhooks need raw body). Example:
//    app.post("/webhooks/stripe", express.raw({ type: "application/json" }), stripeWebhookHandler);

// B) JSON: accept typical JSON + JSON-without-correct-CT + JSON subtypes
app.use(
  express.json({
    limit: "10mb",
    // Accept application/json, application/*+json, text/json, and even missing/incorrect CT
    type: (req) => {
      const ct = req.headers["content-type"] || "";
      // parse if it looks like json OR if client forgot to set CT but sends braces
      return (
        ct.includes("application/json") ||
        ct.includes("+json") ||
        ct.includes("text/json") ||
        // Allow parsing when content-type is missing but method usually sends bodies
        (!ct && ["POST", "PUT", "PATCH"].includes(req.method as string) && true)
      );
    },
    // Graceful JSON parse error -> let our middleware catch it
    strict: true,
    // Stash raw body for routes that need HMAC signature verification (e.g. Razorpay payout webhook).
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    },
  })
);

// C) URL-encoded forms (HTML forms, axios default for FormData without files)
app.use(
  express.urlencoded({
    extended: true,
    limit: "10mb",
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

// --- Health/Index ----------------------------------------------------------
app.get("/index.php", async (_req, res) => res.json({ Project: "AppNameUpdateHere" }));
app.get("/api", (_req, res) => res.json({ Project: "AppNameUpdateHere" }));

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

// --- Global Rate Limiter ---------------------------------------------------
app.use(globalLimiter);

// --- Routes ----------------------------------------------------------------
// Master Client Routes (Mobile App / Web Portal)
app.use("/api/v1/client", clientRoutes);

// Master Admin Routes (Dashboard)
app.use("/api/v1/admin", adminRoutes);

// Master Educator Routes (Educator Portal)
app.use("/api/v1/educator", educatorRoutes);

// Master Promoter Routes (Promoter Portal)
app.use("/api/v1/promoter", promoterRoutes);

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
