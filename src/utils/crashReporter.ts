// src/utils/crashReporter.ts
import { sendEmail } from "../utils/emailService";
import { redisClient, isRedisReady } from "../config/redis";

type CrashReporterOptions = {
  appName?: string;
  emailTo: string;                 // where to send crash emails
  throttleMs?: number;             // avoid spam: minimum ms between mails
  sendTimeoutMs?: number;          // give email this many ms before giving up
};

const lastRequests: Array<{
  ts: string;
  method: string;
  url: string;
  ip?: string;
  ua?: string | undefined;
  status?: number;
}> = [];

const MAX_REQ_SNAPSHOT = 20;
// Per-pod guard — fine to stay in-memory; prevents the SAME pod from sending
// two emails for two near-simultaneous crashes during its dying moments.
let crashEmailInFlight = false;
// CROSS-pod throttle uses Redis SET NX EX. Without this, a crash loop across
// N pods would emit N emails per throttle window — alert spam during the
// moment you most need a clean signal. Lock key includes the title so two
// different crash types within the same window each get one email.
const CRASH_LOCK_KEY = (title: string) => `crash-email-lock:${title}`;

// Strip the query string off a request URL before snapshotting it. Crash
// emails attach the last 20 requests, and a careless `/reset?token=abc123`
// would otherwise leak the token via email. Path is enough for triage.
const stripQuery = (url: string): string => {
  const i = url.indexOf("?");
  return i === -1 ? url : url.slice(0, i);
};

export function captureCrashContextMiddleware() {
  return (req: any, res: any, next: any) => {
    const fullUrl = req.originalUrl || req.url || "";
    const entry = {
      ts: new Date().toISOString(),
      method: req.method,
      url: stripQuery(fullUrl),
      ip: req.ip,
      ua: req.get?.("user-agent"),
      status: undefined as number | undefined,
    };

    res.on?.("finish", () => {
      entry.status = res.statusCode;
    });

    lastRequests.push(entry);
    if (lastRequests.length > MAX_REQ_SNAPSHOT) lastRequests.shift();
    next();
  };
}

export function initCrashReporter(opts: CrashReporterOptions) {
  const {
    appName = "Xcelyst",
    emailTo,
    throttleMs = 10 * 60 * 1000, // 10 minutes
    sendTimeoutMs = 4000,         // 4 seconds
  } = opts;

  const sendCrashEmail = async (title: string, payload: any) => {
    if (crashEmailInFlight) return; // same-pod guard
    crashEmailInFlight = true;

    // Cross-pod throttle. SET NX EX is atomic — exactly one pod wins per
    // throttle window per crash title. If Redis is down (likely during
    // major outages — the very moments we want a crash email), fail open
    // and let the email through; better one alert per pod than zero.
    if (isRedisReady()) {
      try {
        const acquired = await redisClient.set(
          CRASH_LOCK_KEY(title),
          String(Date.now()),
          "EX",
          Math.ceil(throttleMs / 1000),
          "NX"
        );
        if (acquired !== "OK") {
          crashEmailInFlight = false;
          return;
        }
      } catch {
        // fall-open
      }
    }

    const html = `
      <html>
        <body>
          <h2>🚨 ${appName} crash detected</h2>
          <p><strong>Title:</strong> ${escapeHtml(title)}</p>
          <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
          <p><strong>PID:</strong> ${process.pid}</p>
          <p><strong>Uptime (s):</strong> ${Math.floor(process.uptime())}</p>
          <p><strong>Memory (MB):</strong> ${Math.round(process.memoryUsage().rss / 1_000_000)}</p>
          <h3>Error</h3>
          <pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre>
          <h3>Last ${lastRequests.length} requests</h3>
          <pre>${escapeHtml(JSON.stringify(lastRequests, null, 2))}</pre>
        </body>
      </html>
    `;

    // Race with timeout so we don’t hang the dying process
    const timeout = new Promise((_r, rej) =>
      setTimeout(() => rej(new Error("sendEmail timeout")), sendTimeoutMs)
    );

    try {
      await Promise.race([sendEmail(emailTo, `${appName} CRASH: ${title}`, html), timeout]);
    } catch {
      // swallow — we’re crashing anyway
    } finally {
      crashEmailInFlight = false;
    }
  };

  process.on("unhandledRejection", (reason, p) => {
    const payload = {
      type: "unhandledRejection",
      reason: serializeError(reason),
      promise: String(p),
    };
    void sendCrashEmail("Unhandled Promise Rejection", payload).finally(() => {
      // Exit soon after scheduling the email; let your process manager restart it
      setImmediate(() => process.exit(1));
    });
  });

  process.on("uncaughtException", (err) => {
    const payload = {
      type: "uncaughtException",
      error: serializeError(err),
    };
    void sendCrashEmail("Uncaught Exception", payload).finally(() => {
      setImmediate(() => process.exit(1));
    });
  });
}

// Helpers
function serializeError(e: unknown) {
  if (e instanceof Error) {
    return { name: e.name, message: e.message, stack: e.stack };
  }
  try {
    return JSON.parse(JSON.stringify(e));
  } catch {
    return String(e);
  }
}

function escapeHtml(input: string) {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
