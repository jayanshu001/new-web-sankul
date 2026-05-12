import dotenv from "dotenv";
import { createServer } from "http";
import app from "./app";
import connectDB from "./config/db";
import logger from "./utils/logger";
import { sendEmail } from "./utils/emailService";
import getLocalIpAddress from "./utils/getLocalIp";
import { pm2Ready } from "./utils/pm2Logger";
import { startNotificationWorker } from "./admin/notification/notification.worker";
import { initLiveChatSocket } from "./socket/livechat.socket";

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
    startNotificationWorker();
    // Start the Express server

    const httpServer = createServer(app);

    // Attach Socket.io for live class chat
    initLiveChatSocket(httpServer, allowedOrigins);

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
