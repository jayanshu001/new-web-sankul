/**
 * Backfill: replace email/blank `user_name` on ADMIN live-chat messages with
 * the admin's real name from ws_users.
 *
 * Historically, admin live-chat messages persisted the admin's EMAIL as
 * `user_name` (the admin JWT carries no name, so the old controller fell back
 * to email). The send path is now fixed to store the real name (or "Super
 * Admin"), but rows written before that fix still show the email in
 * GET /api/v1/admin/live-chat/:liveClassId/history.
 *
 * This script normalizes those existing rows:
 *   - only touches `is_admin = 1` rows whose user_name is blank or looks like
 *     an email (contains "@") — rows already carrying a proper name are left
 *     alone, so it's safe + idempotent.
 *   - new name = `${firstName} ${lastName}` for the row's admin_id, else
 *     "Super Admin".
 *
 * Run: yarn tsx scripts/backfill-livechat-admin-usernames.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.liveChatMessage.findMany({
    where: { isAdmin: true },
    select: { id: true, adminId: true, userName: true },
    orderBy: { id: "asc" },
  });

  // Distinct admin ids on these rows → resolve names in one query.
  const adminIds = Array.from(
    new Set(rows.map((r) => r.adminId).filter((v): v is number => v != null))
  );
  const admins = adminIds.length
    ? await prisma.adminUser.findMany({
        where: { id: { in: adminIds.map((n) => BigInt(n)) } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const nameByAdminId = new Map<string, string>();
  for (const a of admins) {
    const name = [a.firstName, a.lastName].filter(Boolean).join(" ").trim();
    if (name) nameByAdminId.set(String(a.id), name);
  }

  const needsFix = (u: string | null | undefined): boolean => {
    const v = (u ?? "").trim();
    return v === "" || v.includes("@");
  };

  let updated = 0;
  let skipped = 0;
  for (const r of rows) {
    if (!needsFix(r.userName)) {
      skipped++;
      continue;
    }
    const newName =
      (r.adminId != null ? nameByAdminId.get(String(r.adminId)) : undefined) || "Super Admin";
    await prisma.liveChatMessage.update({
      where: { id: r.id },
      data: { userName: newName, updatedAt: new Date() },
    });
    console.log(`  #${r.id}: "${r.userName ?? ""}" -> "${newName}"`);
    updated++;
  }

  console.log(`\nDone. admin rows: ${rows.length}, updated: ${updated}, already-ok: ${skipped}.`);
}

main()
  .catch((e) => {
    console.error("Backfill failed:", (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
