import dotenv from "dotenv";
import app from "./app";
import connectDB from "./config/db";
import logger from "./utils/logger";

dotenv.config();
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    // Connect to the database
    await connectDB();
    // Start the Express server
    app.listen(PORT, () => {
      logger.info(`API server running at http://localhost:${PORT}`);
    });
    
  } catch (error) {
    console.error("Server startup failed:", error);
    process.exit(1);
  }
};

startServer();
