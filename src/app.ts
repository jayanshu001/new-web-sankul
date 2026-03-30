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
import customerAuthRoutes from "./modules/auth/customer/auth.routes";
import adminAuthRoutes from "./modules/auth/admin/admin.auth.routes";
import customerRoutes from "./modules/customer/customer.routes";

const app = express();

// --- Security & Performance -------------------------------------------------
app.use(helmet());
app.use(compression());

// --- Crash Reporter ---------------------------------------------------------
initCrashReporter({
  emailTo: "ranavinit6834@gmail.com",
  appName: "AppNameUpdateHere",
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
const allowedOrigins = [
  "http://localhost:3000",
];

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

// E) (Optional) catch-all raw for binary uploads to specific endpoints
// Put this BEFORE the route that needs it (not globally), e.g.:
// app.post("/api/files/raw", express.raw({ type: "*/*", limit: "50mb" }), rawFileHandler);

// --- Crash context AFTER parsers, BEFORE routes ----------------------------
app.use(captureCrashContextMiddleware());

// --- Health/Index ----------------------------------------------------------
app.get("/index.php", async (_req, res) => res.json({ Project: "AppNameUpdateHere" }));
app.get("/api", (_req, res) => res.json({ Project: "AppNameUpdateHere" }));

// --- Routes ----------------------------------------------------------------
// Customer auth  →  /api/v1/auth/otp/generate  |  /api/v1/auth/otp/validate
app.use("/api/v1/auth", customerAuthRoutes);

// Admin auth     →  /api/v1/admin/auth/login  |  /api/v1/admin/auth/register
app.use("/api/v1/admin/auth", adminAuthRoutes);

// Customer general → /api/v1/customer/profile
app.use("/api/v1/customer", customerRoutes);


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
