import dotenv from "dotenv";
import app from "./app";
import connectDB from "./config/db";
import cron from "node-cron";

dotenv.config();
const PORT = process.env.PORT || 5000; 

const startServer = async () => {
  try {
    // Connect to the database 
    await connectDB();
    // Start the Express server
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

  } catch (error) {
    console.error("Server startup failed:", error);
    process.exit(1);
  }
};

startServer(); 
