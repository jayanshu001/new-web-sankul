import { PrismaClient } from "@prisma/client";
import logger from "../utils/logger";
import { incrementContext } from "../utils/requestContext";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaTimingInstalled?: boolean;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.PRISMA_LOG_QUERIES === "true"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
  });

// Query-timing middleware → per-request `dbMs` (restores the parity the retired
// Mongoose timing plugin used to provide). Outside an HTTP request (BullMQ
// workers, scripts) `incrementContext` is a no-op. Instrumentation ONLY — it never
// touches query params or results, so it cannot change any response. Guarded so
// dev hot-reload doesn't stack duplicate middleware on the reused singleton.
if (!globalForPrisma.prismaTimingInstalled) {
  prisma.$use(async (params, next) => {
    const start = process.hrtime.bigint();
    try {
      return await next(params);
    } finally {
      incrementContext("dbMs", Number(process.hrtime.bigint() - start) / 1_000_000);
    }
  });
  globalForPrisma.prismaTimingInstalled = true;
}

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export const connectPrisma = async (): Promise<void> => {
  try {
    await prisma.$connect();
    logger.info("MySQL connected (Prisma).");
  } catch (error) {
    logger.error("MySQL (Prisma) connection error:", error);
    throw error;
  }
};

export const disconnectPrisma = async (): Promise<void> => {
  await prisma.$disconnect();
};

export default prisma;
