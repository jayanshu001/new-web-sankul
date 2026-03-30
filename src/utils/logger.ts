import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';
import fs from 'fs';

//  Custom Logger Interface
interface ExtendedLogger extends winston.Logger {
  logWithContext: (level: string, message: string, context?: Record<string, any>) => void;
}

const logDirectory = path.join(process.cwd(), 'logs');

if (!fs.existsSync(logDirectory)) {
  fs.mkdirSync(logDirectory, { recursive: true });
}

//  JSON file format for logs
const customFormat = winston.format.combine(
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
