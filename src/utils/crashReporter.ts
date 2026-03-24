// src/utils/crashReporter.ts
import { sendEmail } from "../utils/emailService";

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
let lastEmailAt = 0;
let crashEmailInFlight = false;

export function captureCrashContextMiddleware() {
  return (req: any, res: any, next: any) => {
    const entry = {
      ts: new Date().toISOString(),
      method: req.method,
      url: req.originalUrl || req.url,
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
    const now = Date.now();
    if (now - lastEmailAt < throttleMs) return;          // throttled
    if (crashEmailInFlight) return;                      // already sending

    crashEmailInFlight = true;
    lastEmailAt = now;

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
