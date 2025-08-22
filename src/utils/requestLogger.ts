import logger from "./logger";
import type { RequestHandler } from 'express';


const requestLogger: RequestHandler = (req, res, next) => {
  const startTime = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - startTime;

    logger.info("API Request", {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      responseTime: `${duration}ms`,
      body: req.method !== "GET" ? req.body : undefined,
    });
  });

  next();
}

export default requestLogger;

