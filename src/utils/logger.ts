// Logger: Winston with daily-rotated JSON files and a colored console renderer.
import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';
import fs from 'fs';
import { getContext } from './requestContext';

interface ExtendedLogger extends winston.Logger {
  logWithContext: (level: string, message: string, context?: Record<string, any>) => void;
}

const logDirectory = path.join(process.cwd(), 'logs');

if (!fs.existsSync(logDirectory)) {
  fs.mkdirSync(logDirectory, { recursive: true });
}

// Injects AsyncLocalStorage request context into every record; fields passed
// explicitly to `logger.info(msg, ctx)` take precedence.
const requestContextFormat = winston.format((info) => {
  const ctx = getContext();
  if (!ctx) return info;
  if (ctx.traceId !== undefined && info.traceId === undefined) info.traceId = ctx.traceId;
  if (ctx.userId !== undefined && info.userId === undefined) info.userId = ctx.userId;
  if (ctx.userRole !== undefined && info.userRole === undefined) info.userRole = ctx.userRole;
  if (ctx.route !== undefined && info.route === undefined) info.route = ctx.route;
  return info;
})();

const customFormat = winston.format.combine(
  requestContextFormat,
  winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  winston.format.errors({ stack: true }),
  winston.format.metadata(),
  winston.format.json()
);

const fileTransport = new winston.transports.DailyRotateFile({
  filename: path.join(logDirectory, 'app-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '14d',
  options: { flags: 'a', mode: 0o644 }
});

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
  bgGreen: '\x1b[1;30;42m',
  bgYellow: '\x1b[1;30;43m',
} as const;
const paint = (code: string, text: string) => `${code}${text}${ANSI.reset}`;

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

const compact = (value: unknown): string => JSON.stringify(value);

/** Console renderer for requestLogger.ts events (those carrying method/url). */
const renderHttpLine = (info: Record<string, any>): string => {
  const { timestamp, message, method, url, statusCode, responseTime, dbMs, cacheHit, cacheMiss, query, params, body } = info;
  const arrow = message === 'API Request Start' ? ANSI.dim + '→' + ANSI.reset : ANSI.dim + '←' + ANSI.reset;
  const methodBadge = paint(colorForMethod(method), String(method).padEnd(6));
  const statusBadge = statusCode !== undefined ? ' ' + paint(colorForStatus(statusCode), String(statusCode)) : '';
  const timing = responseTime ? paint(ANSI.dim, responseTime) : '';
  const cacheBadge =
    cacheHit ? paint(ANSI.bgGreen, ' HIT ') : cacheMiss ? paint(ANSI.bgYellow, ' MISS ') : '';
  const dbBadge = dbMs ? paint(ANSI.dim, `db=${dbMs}ms`) : '';

  let line = `${paint(ANSI.gray, timestamp)} ${arrow} ${methodBadge} ${url}${statusBadge} ${timing} ${dbBadge} ${cacheBadge}`.replace(/ +/g, ' ').trimEnd();

  for (const [label, value] of [['params', params], ['query', query], ['body', body]] as const) {
    if (value !== undefined) line += `\n    ${paint(ANSI.dim, label + ':')} ${compact(value)}`;
  }
  return line;
};

const consoleFormat = winston.format.combine(
  requestContextFormat,
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf((info) => {
    // The logger-level `customFormat` runs `format.metadata()` before this
    // transport format, so method/url/statusCode etc. are nested under `info.metadata`.
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

const baseLogger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  format: customFormat,
  defaultMeta: { service: 'Web-sankul' },
  transports: [
    fileTransport,
    new winston.transports.Console({ format: consoleFormat })
  ],
  exitOnError: false
}) as ExtendedLogger;

baseLogger.logWithContext = (level, message, context = {}) => {
  baseLogger.log(level, message, { ...context });
};

export default baseLogger;
