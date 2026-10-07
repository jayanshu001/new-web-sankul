// 5xx message sanitizer: keeps internal error strings out of client responses.
// A 5xx response must never carry an internal error string (Prisma invocation
// text, file paths, DB host:port). This module only classifies and rewrites the
// message string; it never changes control flow and never touches 4xx, whose
// messages are deliberate user-facing sentences. Curated 5xx sentences survive
// the heuristic; STRICT_5XX_MESSAGES=true collapses every 5xx message instead.
//
// Consumers: middlewares/errorHandler.ts (thrown errors) and
// middlewares/responseSanitizer.ts (controller catch blocks that answer directly).

/** The single sentence every leaked 5xx collapses to. */
export const INTERNAL_ERROR_MESSAGE = "Internal Server Error";

/**
 * Local-debug escape hatch: `EXPOSE_ERROR_DETAILS=true` keeps raw messages.
 * Not keyed off NODE_ENV because PM2 defaults it to development, which would
 * silently re-enable leaking.
 */
const detailsExposed = (): boolean => process.env.EXPOSE_ERROR_DETAILS === "true";

const strictMode = (): boolean => process.env.STRICT_5XX_MESSAGES === "true";

/**
 * Fingerprints of machine-generated messages. Kept specific: a false positive
 * only genericises a curated sentence, but loose common-word patterns would
 * genericise half the legitimate ones. Each pattern must be something no
 * hand-written product sentence would contain.
 */
const INTERNAL_MESSAGE_PATTERNS: RegExp[] = [
  /prisma/i,                       // "Invalid `prisma.x.y()` invocation", PrismaClient*Error
  /\bP\d{4}\b/,                    // P1001 / P2002 / P2024 … Prisma error codes
  /\binvocation\b/i,
  /\bQueryEngine\b/i,

  /\n/,                            // any multi-line body is a stack/driver dump
  /\n?\s+at\s+[\w$.<>]+\s*\(/,     // "    at Object.foo (/app/dist/…)"
  /[\\/](src|dist|node_modules)[\\/]/,
  /\.(ts|js|mjs|cjs):\d+/,         // "customer.repository.js:116"

  /\bE(CONNREFUSED|CONNRESET|TIMEDOUT|PIPE|NOTFOUND|HOSTUNREACH|AI_AGAIN|ACCES|NOENT)\b/i,
  /\bgetaddrinfo\b/i,
  /\bERR_[A-Z_]+\b/,
  /\bcannot find module\b/i,

  /\bER_[A-Z_]+\b/,
  /\bSQLSTATE\b/i,
  /\bmysql\b/i,
  /\bunknown column\b/i,
  /\bduplicate entry\b/i,
  /\bdeadlock found\b/i,
  /\bforeign key constraint\b/i,

  /\bredis\b/i,
  /\bbullmq\b/i,
  /\bmongo/i,
  /\bcan't reach database server\b/i,
  /\bserver has closed the connection\b/i,

  /\b(TypeError|ReferenceError|SyntaxError|RangeError|AggregateError|EvalError)\b/,
  /\bcannot read propert(y|ies)\b/i,
  /\bis not a function\b/i,
  /\bis not defined\b/i,
  /\bis not iterable\b/i,
  /\bmaximum call stack\b/i,
  /\bunexpected token\b/i,

  /\b\d{1,3}(\.\d{1,3}){3}:\d{2,5}\b/,  // 10.0.0.4:3306
  /\b[a-z]+:\/\/[^\s]+/i,               // any URI (mysql://, redis://, https://internal…)
];

// Anything longer is a dump, not a sentence.
const MAX_CLIENT_MESSAGE_LENGTH = 200;

/** True when `message` looks machine-generated. Only meaningful for 5xx. */
export const isInternalErrorMessage = (message: unknown): boolean => {
  if (typeof message !== "string") return true;

  const trimmed = message.trim();
  if (!trimmed) return true;
  if (trimmed.length > MAX_CLIENT_MESSAGE_LENGTH) return true;

  return INTERNAL_MESSAGE_PATTERNS.some((pattern) => pattern.test(trimmed));
};

/**
 * 4xx: unchanged. 5xx internal: INTERNAL_ERROR_MESSAGE. 5xx curated: unchanged
 * unless STRICT_5XX_MESSAGES=true. Must never throw; it runs inside an
 * already-degraded error path.
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
