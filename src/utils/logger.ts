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

//  Console format for local dev
const consoleFormat = winston.format.combine(
  requestContextFormat,
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf((info) => {
    const { timestamp, level, message, ...meta } = info;
    return `${timestamp} [${level}]: ${message} ${
      Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
    }`;
  })
);

//  Create logger
const baseLogger = winston.createLogger({
  level: 'debug',
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
