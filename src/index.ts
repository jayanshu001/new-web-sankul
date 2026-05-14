import dotenv from "dotenv";
import { createServer } from "http";
import app from "./app";
import connectDB from "./config/db";
import logger from "./utils/logger";
import { sendEmail } from "./utils/emailService";
import getLocalIpAddress from "./utils/getLocalIp";
import { pm2Ready } from "./utils/pm2Logger";
import { initNotificationScheduler, shutdownNotificationScheduler } from "./admin/notification/scheduler";
import { initLiveChatSocket } from "./socket/livechat.socket";
import { initCameraIngest } from "./socket/camera-ingest";

dotenv.config();
const PORT = process.env.PORT || 5000;

const allowedOrigins = (
  process.env.ALLOWED_ORIGINS ??
  "http://localhost:3000,http://localhost:5173,http://localhost:5174"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const startServer = async () => {
  try {
    await connectDB();
    await initNotificationScheduler();

    const gracefulShutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down notification scheduler...`);
      await shutdownNotificationScheduler();
      process.exit(0);
    };
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
    // Start the Express server

    const httpServer = createServer(app);

    // Attach Socket.io for live class chat
    initLiveChatSocket(httpServer, allowedOrigins);

    // Attach the camera-ingest WebSocket bridge (browser camera → ffmpeg → RTMP)
    initCameraIngest(httpServer);

    httpServer.listen(PORT, async () => {
      logger.info(`API server running at http://localhost:${PORT}`);
      logger.info(`Server Local IP: ${getLocalIpAddress()}`, { "localurl": `http://${getLocalIpAddress()}:${PORT}` });
      pm2Ready();
    });
  } catch (error) {
    logger.error("Server startup failed:", error);
    process.exit(1);
  }
};

startServer();
