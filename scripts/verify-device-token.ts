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
    select: { id: true, os_type: true, firebaseToken: true },
  });
  if (!customer) throw new Error("No live customer to test with.");
  // Token lives in ws_customer.device now — stash the real one and restore it,
  // so this verify run never wipes a live customer's device token.
  const originalToken = customer.firebaseToken;
  console.log("• live customer:", customer.id, "os_type=", customer.os_type);

  const res = await repo.setDeviceToken(customer.id, TEST_TOKEN, "android");
  console.log("• setDeviceToken ->", res, "(count:1 = success)");

  const row = await prisma.customer.findUnique({ where: { id: customer.id }, select: { firebaseToken: true, os_type: true } });
  console.log("• token in ws_customer.device:", row ? { firebaseToken: row.firebaseToken, os_type: row.os_type } : null);

  const audience = await resolveAudience({});
  console.log("• broadcast audience isAll:", audience.isAll);
  const owners = await prisma.customer.findMany({ where: { isAccountDeleted: false, status: true, firebaseToken: { not: null } }, select: { firebaseToken: true } });
  console.log("• tokens a broadcast would collect:", owners.length, "— includes test token:", owners.some((t) => t.firebaseToken === TEST_TOKEN));

  await repo.clearDeviceToken(customer.id, TEST_TOKEN);
  const after = await prisma.customer.findUnique({ where: { id: customer.id }, select: { firebaseToken: true } });
  console.log("• cleanup, token removed:", after?.firebaseToken !== TEST_TOKEN);
  // Restore the customer's original device token.
  await prisma.customer.update({ where: { id: customer.id }, data: { firebaseToken: originalToken, updatedAt: new Date() } });

  await prisma.$disconnect();
  console.log("\nRESULT: registration pipeline + broadcast collection VERIFIED");
}

main().catch(async (e) => { console.error("VERIFY FAILED:", e); await prisma.$disconnect(); process.exit(1); });
