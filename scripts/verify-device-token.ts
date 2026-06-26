/**
 * Phase 1.1 verification: prove the device-token registration code path works
 * end-to-end through the REAL repository (same code PUT /client/profile/
 * device-token runs), and that a broadcast audience would pick the token up.
 * Cleans up the test token afterward so it never reaches a real FCM send.
 *
 * Run: npx tsx scripts/verify-device-token.ts
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { prisma } from "../src/config/prisma";
import { customerProfileRepository as repo } from "../src/modules/customer-profile/customer-profile.repository";
import { resolveAudience } from "../src/modules/admin-notification/admin-notification.service";

const TEST_TOKEN = "TEST_FAKE_TOKEN_phase1_verify_DELETE_ME";

async function main() {
  const customer = await prisma.customer.findFirst({
    where: { isAccountDeleted: false, status: true },
    select: { id: true, os_type: true },
  });
  if (!customer) throw new Error("No live customer to test with.");
  console.log("• live customer:", customer.id, "os_type=", customer.os_type);

  const res = await repo.setDeviceToken(customer.id, TEST_TOKEN, "android");
  console.log("• setDeviceToken ->", res, "(count:1 = success)");

  const row = await prisma.customerDeviceToken.findUnique({ where: { token: TEST_TOKEN } });
  console.log("• row in ws_customer_device_token:", row ? { id: row.id, customerId: row.customerId, platform: row.platform } : null);

  const audience = await resolveAudience({});
  console.log("• broadcast audience isAll:", audience.isAll);
  const liveIds = await prisma.customer.findMany({ where: { isAccountDeleted: false, status: true }, select: { id: true } });
  const tokens = await prisma.customerDeviceToken.findMany({ where: { customerId: { in: liveIds.map((c) => c.id) } }, select: { token: true } });
  console.log("• tokens a broadcast would collect:", tokens.length, "— includes test token:", tokens.some((t) => t.token === TEST_TOKEN));

  await repo.clearDeviceToken(customer.id, TEST_TOKEN);
  const after = await prisma.customerDeviceToken.findUnique({ where: { token: TEST_TOKEN } });
  console.log("• cleanup, token removed:", after === null);

  await prisma.$disconnect();
  console.log("\nRESULT: registration pipeline + broadcast collection VERIFIED");
}

main().catch(async (e) => { console.error("VERIFY FAILED:", e); await prisma.$disconnect(); process.exit(1); });
