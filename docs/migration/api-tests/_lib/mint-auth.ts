/**
 * Test-only JWT minting when Mongo admin login is unavailable.
 * Mirrors scripts/test-live-course-http.ts (admin session check is disabled in middleware).
 */
import jwt from "jsonwebtoken";
import Redis from "ioredis";
import { config } from "./env.js";

function redisClient(): Redis {
  return new Redis({
    host: process.env.REDIS_HOST || "localhost",
    port: Number(process.env.REDIS_PORT) || 6380,
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: 2,
    lazyConnect: true,
  });
}

export async function mintAdminToken(): Promise<string> {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error("JWT_ACCESS_SECRET required for minted admin token");

  const adminId = process.env.MIGRATION_TEST_ADMIN_ID ?? "migration-api-test-admin";
  const token = jwt.sign(
    { id: adminId, email: "migration-api-test@local", role: "super_admin", type: "admin" },
    secret,
    { expiresIn: "1h" }
  );

  const redis = redisClient();
  await redis.connect();
  try {
    await redis.set(`admin_session:${adminId}`, token, "EX", 3600);
  } finally {
    redis.disconnect();
  }
  return token;
}

export async function mintCustomerToken(): Promise<string> {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error("JWT_ACCESS_SECRET required for minted customer token");

  const customerId = process.env.MIGRATION_TEST_CUSTOMER_ID ?? "507f1f77bcf86cd799439011";
  const phone = config.customerPhone || "9999999999";
  const token = jwt.sign(
    { id: customerId, phone, role: "customer", type: "customer" },
    secret,
    { expiresIn: "1h" }
  );

  const redis = redisClient();
  await redis.connect();
  try {
    await redis.set(`customer_session:${customerId}`, token, "EX", 3600);
  } finally {
    redis.disconnect();
  }
  return token;
}
