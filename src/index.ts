import dotenv from "dotenv";
import app from "./app";
import connectDB from "./config/db";
import logger from "./utils/logger";
import { sendEmail } from "./utils/emailService";
import getLocalIpAddress from "./utils/getLocalIp";
import { pm2Ready } from "./utils/pm2Logger";

dotenv.config();
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    // Connect to the database
    await connectDB();
    // Start the Express server

    app.listen(PORT, async () => {
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
