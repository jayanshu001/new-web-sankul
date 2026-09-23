// src/utils/errorSanitizer.ts
//
// ONE RULE: a 5xx response must never carry an internal error string.
//
// WHY THIS EXISTS: during a deploy (PM2 reload, `prisma generate`, a DDL being
// applied, the DB briefly unreachable) the API keeps answering — but the string
// it answers with is whatever the nearest catch block happened to grab. Users on
// the app and admins on the dashboard were shown things like:
//
//   Invalid `prisma.customer.findMany()` invocation in
//   /var/www/api/dist/modules/customer/customer.repository.js:116:24
//   Can't reach database server at `10.0.0.4:3306`
//
// That is three separate problems in one line: it is meaningless to the user, it
// leaks our deployment path/host/port, and it makes a routine 40-second deploy
// look like the product is broken. The user-facing answer for every one of these
// is the same sentence: "Internal Server Error".
//
// SHAPE OF THE FIX: this module only classifies + rewrites a STRING. It never
// changes control flow and never touches 4xx — a 4xx message is a deliberate,
// user-facing sentence ("Course not found", "Please fill in all the required
// details.") and rewriting those would break real product behaviour.
//
// Curated 5xx sentences ("Failed to list subscriptions.") also survive: they
// carry no internals, so the heuristic leaves them alone. Only messages that
// look like they came out of a driver, a stack trace or a file path get
// replaced. Set STRICT_5XX_MESSAGES=true to collapse EVERY 5xx message to the
// generic one instead, if you'd rather not rely on the heuristic at all.
//
// Consumers: `middlewares/errorHandler.ts` (thrown errors) and
// `middlewares/responseSanitizer.ts` (the ~540 hand-written
// `res.status(500).json({ message: error.message })` sites that never reach the
// global handler at all).

/** The single sentence every leaked 5xx collapses to. */
export const INTERNAL_ERROR_MESSAGE = "Internal Server Error";

/**
 * Escape hatch for local debugging: `EXPOSE_ERROR_DETAILS=true` in `.env` keeps
 * raw messages in the response body.
 *
 * Deliberately NOT keyed off NODE_ENV: `ecosystem.config.cjs` defaults to
 * NODE_ENV=development, so a server started without `--env production` would
 * silently opt itself back into leaking. Opting IN has to be explicit.
 */
const detailsExposed = (): boolean => process.env.EXPOSE_ERROR_DETAILS === "true";

/** Collapse every 5xx message, not just the ones that look internal. */
const strictMode = (): boolean => process.env.STRICT_5XX_MESSAGES === "true";

/**
 * Fingerprints of "this came from a machine, not from us".
 *
 * Kept deliberately specific. A false positive costs a curated sentence its
 * wording (it becomes "Internal Server Error", which is still a correct answer
 * for a 5xx); a false negative leaks infrastructure to a customer. But being
 * loose with common English words ("column", "connection failed", "undefined")
 * would genericise half the legitimate messages, so each pattern below has to
 * be something no hand-written product sentence would contain.
 */
const INTERNAL_MESSAGE_PATTERNS: RegExp[] = [
  // ── Prisma ────────────────────────────────────────────────────────────────
  /prisma/i,                       // "Invalid `prisma.x.y()` invocation", PrismaClient*Error
  /\bP\d{4}\b/,                    // P1001 / P2002 / P2024 … Prisma error codes
  /\binvocation\b/i,
  /\bQueryEngine\b/i,

  // ── Stack traces & source locations ───────────────────────────────────────
  /\n/,                            // any multi-line body is a stack/driver dump
  /\n?\s+at\s+[\w$.<>]+\s*\(/,     // "    at Object.foo (/app/dist/…)"
  /[\\/](src|dist|node_modules)[\\/]/,
  /\.(ts|js|mjs|cjs):\d+/,         // "customer.repository.js:116"

  // ── Node / driver / socket level ──────────────────────────────────────────
  /\bE(CONNREFUSED|CONNRESET|TIMEDOUT|PIPE|NOTFOUND|HOSTUNREACH|AI_AGAIN|ACCES|NOENT)\b/i,
  /\bgetaddrinfo\b/i,
  /\bERR_[A-Z_]+\b/,
  /\bcannot find module\b/i,

  // ── MySQL / SQL ───────────────────────────────────────────────────────────
  /\bER_[A-Z_]+\b/,
  /\bSQLSTATE\b/i,
  /\bmysql\b/i,
  /\bunknown column\b/i,
  /\bduplicate entry\b/i,
  /\bdeadlock found\b/i,
  /\bforeign key constraint\b/i,

  // ── Other infrastructure we must not name to a customer ───────────────────
  /\bredis\b/i,
  /\bbullmq\b/i,
  /\bmongo/i,                      // legacy paths that still throw
  /\bcan't reach database server\b/i,
  /\bserver has closed the connection\b/i,

  // ── Raw JS runtime failures (i.e. a bug, not a business rule) ─────────────
  /\b(TypeError|ReferenceError|SyntaxError|RangeError|AggregateError|EvalError)\b/,
  /\bcannot read propert(y|ies)\b/i,
  /\bis not a function\b/i,
  /\bis not defined\b/i,
  /\bis not iterable\b/i,
  /\bmaximum call stack\b/i,
  /\bunexpected token\b/i,

  // ── Host / credential shaped fragments ────────────────────────────────────
  /\b\d{1,3}(\.\d{1,3}){3}:\d{2,5}\b/,  // 10.0.0.4:3306
  /\b[a-z]+:\/\/[^\s]+/i,               // any URI (mysql://, redis://, https://internal…)
];

/** Anything longer than this is a dump, not a sentence. */
const MAX_CLIENT_MESSAGE_LENGTH = 200;

/**
 * True when `message` looks like it came out of the stack rather than out of a
 * product decision. Only meaningful for 5xx — see `sanitizeClientMessage`.
 */
export const isInternalErrorMessage = (message: unknown): boolean => {
  if (typeof message !== "string") return true;

  const trimmed = message.trim();
  if (!trimmed) return true;
  if (trimmed.length > MAX_CLIENT_MESSAGE_LENGTH) return true;

  return INTERNAL_MESSAGE_PATTERNS.some((pattern) => pattern.test(trimmed));
};

/**
 * The only function callers need.
 *
 *   4xx            → returned unchanged (deliberate, user-facing wording).
 *   5xx + internal → INTERNAL_ERROR_MESSAGE.
 *   5xx + curated  → returned unchanged, unless STRICT_5XX_MESSAGES=true.
 *
 * Never throws: a sanitiser that can fail is worse than no sanitiser, because it
 * fails inside an error path that is already degraded.
 */
export const sanitizeClientMessage = (
  message: unknown,
  statusCode: number
): string => {
  const raw = typeof message === "string" ? message : "";

  if (statusCode < 500) return raw;
  if (detailsExposed()) return raw || INTERNAL_ERROR_MESSAGE;
  if (strictMode()) return INTERNAL_ERROR_MESSAGE;

  return isInternalErrorMessage(raw) ? INTERNAL_ERROR_MESSAGE : raw;
};

export default sanitizeClientMessage;
