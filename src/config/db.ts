import mongoose from "mongoose";
import logger from "../utils/logger";

const connectDB = async (): Promise<void> => {
  if (mongoose.connection.readyState >= 1) return;
  try { 
    await mongoose.connect(process.env.MONGODB_URI || "");
    logger.info(`MongoDB connected!`);
  } catch (error) {
    logger.error(`MongoDB connection error! : ${error}`);
  }
};

export default connectDB;
