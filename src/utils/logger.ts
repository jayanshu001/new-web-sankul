import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';
import fs from 'fs';
import { getContext } from './requestContext';

//  Custom Logger Interface
interface ExtendedLogger extends winston.Logger {
  logWithContext: (level: string, message: string, context?: Record<string, any>) => void;
}

const logDirectory = path.join(process.cwd(), 'logs');

if (!fs.existsSync(logDirectory)) {
  fs.mkdirSync(logDirectory, { recursive: true });
}

// Inject per-request context (traceId, userId, route, dbMs, cacheHit) into
// every log record. Reads AsyncLocalStorage at format time, so the only
// cost outside a request is one undefined check. Caller-supplied fields
// always take precedence — explicit context in a `logger.info(msg, ctx)`
// call overrides what's in the request context.
const requestContextFormat = winston.format((info) => {
  const ctx = getContext();
  if (!ctx) return info;
  if (ctx.traceId !== undefined && info.traceId === undefined) info.traceId = ctx.traceId;
  if (ctx.userId !== undefined && info.userId === undefined) info.userId = ctx.userId;
  if (ctx.userRole !== undefined && info.userRole === undefined) info.userRole = ctx.userRole;
  if (ctx.route !== undefined && info.route === undefined) info.route = ctx.route;
  return info;
})();

//  JSON file format for logs
const customFormat = winston.format.combine(
  requestContextFormat,
  winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  winston.format.errors({ stack: true }),
  winston.format.metadata(),
  winston.format.json()
);

//  Daily rotating log files
const fileTransport = new winston.transports.DailyRotateFile({
  filename: path.join(logDirectory, 'app-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '14d',
  options: { flags: 'a', mode: 0o644 }
});

//  ANSI colors for the console — no extra dependency (chalk/colors aren't
//  installed); these are the same 16-color codes every terminal supports.
const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  // Bold text on a solid background — for badges that must jump out of a
  // scrolling log, not just tint it (cache HIT/MISS).
  bgGreen: '\x1b[1;30;42m',
  bgYellow: '\x1b[1;30;43m',
} as const;
const paint = (code: string, text: string) => `${code}${text}${ANSI.reset}`;

/** 2xx green, 3xx cyan, 4xx yellow, 5xx red — the whole point of this task:
 * scan a scrolling console and immediately see which requests errored. */
const colorForStatus = (status: number): string =>
  status >= 500 ? ANSI.red : status >= 400 ? ANSI.yellow : status >= 300 ? ANSI.cyan : ANSI.green;

const colorForMethod = (method: string): string => {
  switch (method) {
    case 'GET': return ANSI.cyan;
    case 'POST': return ANSI.green;
    case 'PUT':
    case 'PATCH': return ANSI.yellow;
    case 'DELETE': return ANSI.red;
    default: return ANSI.gray;
  }
};

// Compact one-line JSON — no pretty-printing indent, so a query/params/body
// dump doesn't blow a single request out to a dozen console lines.
const compact = (value: unknown): string => JSON.stringify(value);

/**
 * Console renderer for the two requestLogger.ts events that carry
 * method/url — everything else (service startup logs, error stacks, cron
 * output, etc.) falls through to the generic `[level]: message {meta}` form
 * below unchanged.
 */
const renderHttpLine = (info: Record<string, any>): string => {
  const { timestamp, message, method, url, statusCode, responseTime, dbMs, cacheHit, cacheMiss, query, params, body } = info;
  const arrow = message === 'API Request Start' ? ANSI.dim + '→' + ANSI.reset : ANSI.dim + '←' + ANSI.reset;
  const methodBadge = paint(colorForMethod(method), String(method).padEnd(6));
  const statusBadge = statusCode !== undefined ? ' ' + paint(colorForStatus(statusCode), String(statusCode)) : '';
  const timing = responseTime ? paint(ANSI.dim, responseTime) : '';
  // Black-on-green / black-on-yellow blocks — deliberately louder than the
  // rest of the line so a HIT/MISS is scannable at a glance, not just tinted.
  const cacheBadge =
    cacheHit ? paint(ANSI.bgGreen, ' HIT ') : cacheMiss ? paint(ANSI.bgYellow, ' MISS ') : '';
  const dbBadge = dbMs ? paint(ANSI.dim, `db=${dbMs}ms`) : '';

  let line = `${paint(ANSI.gray, timestamp)} ${arrow} ${methodBadge} ${url}${statusBadge} ${timing} ${dbBadge} ${cacheBadge}`.replace(/ +/g, ' ').trimEnd();

  for (const [label, value] of [['params', params], ['query', query], ['body', body]] as const) {
    if (value !== undefined) line += `\n    ${paint(ANSI.dim, label + ':')} ${compact(value)}`;
  }
  return line;
};

//  Console format for local dev
const consoleFormat = winston.format.combine(
  requestContextFormat,
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf((info) => {
    // The logger-level `customFormat` (see below) runs `winston.format.metadata()`
    // BEFORE this transport-level format does, which nests every field except
    // level/message/timestamp under `info.metadata` — so the real fields (method,
    // url, statusCode...) live one level deeper than they look at first glance.
    const { timestamp, level, message, metadata: nested, ...rest } = info;
    const meta = nested && typeof nested === 'object' ? { ...rest, ...nested } : rest;
    if (typeof meta.method === 'string' && typeof meta.url === 'string') {
      return renderHttpLine({ timestamp, message, ...meta });
    }
    return `${timestamp} [${level}]: ${message} ${
      Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
    }`;
  })
);

//  Create logger
const baseLogger = winston.createLogger({
  // Production defaults to `info` to cut log volume + disk I/O at high RPS; dev
  // stays `debug`. Override explicitly with LOG_LEVEL when needed.
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  format: customFormat,
  defaultMeta: { service: 'Web-sankul' },
  transports: [
    fileTransport,
    new winston.transports.Console({ format: consoleFormat })
  ],
  exitOnError: false
}) as ExtendedLogger; // cast to extended type

// dd logWithContext method
baseLogger.logWithContext = (level, message, context = {}) => {
  baseLogger.log(level, message, { ...context });
};

export default baseLogger;
