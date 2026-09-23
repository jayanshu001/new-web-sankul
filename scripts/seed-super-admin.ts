/**
 * Seeder — create (or upsert) a super-admin account in MySQL (ws_users).
 *
 * The admin role is NOT a column on ws_users. It is derived (admin-auth
 * transformer `deriveRole`) from spatie role rows: a role in `ws_roles` whose
 * name contains "super", linked to the admin through the `ws_model_has_roles`
 * pivot with model_type = "App\\Models\\User". This seeder ensures all three:
 *   1. ws_users row (bcrypt password, status=active)
 *   2. ws_roles "super_admin" row
 *   3. ws_model_has_roles pivot linking the two
 *
 * Idempotent: re-running updates the existing admin's password and re-asserts
 * the role link. Safe to run repeatedly.
 *
 * Usage:
 *   yarn seed:superadmin
 *   SEED_ADMIN_EMAIL=foo@bar.com SEED_ADMIN_PASSWORD='Secret123' yarn seed:superadmin
 *
 * Config (env, all optional — defaults shown):
 *   SEED_ADMIN_EMAIL       super.admin@websankul.com
 *   SEED_ADMIN_PASSWORD    ChangeMe@123   (>= 8 chars; CHANGE IT after first login)
 *   SEED_ADMIN_FIRST_NAME  Super
 *   SEED_ADMIN_LAST_NAME   Admin
 *   SEED_ADMIN_ROLE_NAME   super_admin
 *   SEED_ADMIN_GUARD       web
 *
 * Requires DATABASE_URL in .env (see .env.example).
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// Must match admin-auth.service SALT_ROUNDS and the spatie morph class
// (modules/admin-auth/administrator.service.ts ADMIN_MODEL_TYPE).
const SALT_ROUNDS = 10;
const ADMIN_MODEL_TYPE = "App\\Models\\User";

const main = async () => {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("Missing DATABASE_URL. Copy .env.example → .env and set the MySQL URL.");
    process.exit(1);
  }

  const email = (process.env.SEED_ADMIN_EMAIL ?? "super.admin@websankul.com").toLowerCase().trim();
  const password = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe@123";
  const firstName = process.env.SEED_ADMIN_FIRST_NAME ?? "Super";
  const lastName = process.env.SEED_ADMIN_LAST_NAME ?? "Admin";
  const roleName = process.env.SEED_ADMIN_ROLE_NAME ?? "super_admin";
  const guardName = process.env.SEED_ADMIN_GUARD ?? "web";

  if (password.length < 8) {
    console.error("SEED_ADMIN_PASSWORD must be at least 8 characters.");
    process.exit(1);
  }
  // deriveRole maps a role name containing "super" → super_admin. Guard against
  // a custom role name that would silently downgrade the account to "admin".
  if (!roleName.toLowerCase().includes("super")) {
    console.error(`SEED_ADMIN_ROLE_NAME ("${roleName}") must contain "super" or login resolves to a lower role.`);
    process.exit(1);
  }

  const { prisma, disconnectPrisma } = await import("../src/config/prisma.ts");

  try {
    const now = new Date();
    const hashed = await bcrypt.hash(password, SALT_ROUNDS);

    // 1. Admin row (ws_users). Upsert on the unique email; image is NOT NULL.
    const admin = await prisma.adminUser.upsert({
      where: { email },
      update: { password: hashed, firstName, lastName, status: "active", updatedAt: now },
      create: {
        firstName,
        lastName,
        email,
        password: hashed,
        image: "",
        status: "active",
        isDark: "light",
        emailVerifiedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });

    // 2. Super-admin role row (ws_roles). No unique on name, so find-or-create.
    let role = await prisma.adminRoleRow.findFirst({ where: { name: roleName, guardName } });
    if (!role) {
      role = await prisma.adminRoleRow.create({
        data: { name: roleName, guardName, createdAt: now, updatedAt: now },
      });
    }

    // 3. Pivot link (ws_model_has_roles). Composite PK (roleId, modelId, modelType).
    await prisma.adminModelHasRole.upsert({
      where: {
        roleId_modelId_modelType: {
          roleId: role.id,
          modelId: admin.id,
          modelType: ADMIN_MODEL_TYPE,
        },
      },
      update: {},
      create: { roleId: role.id, modelId: admin.id, modelType: ADMIN_MODEL_TYPE },
    });

    console.log("Super-admin seeded successfully:");
    console.log(`  admin id : ${admin.id}`);
    console.log(`  email    : ${admin.email}`);
    console.log(`  role     : ${role.name} (id ${role.id}, guard ${role.guardName})`);
    console.log(`  password : ${process.env.SEED_ADMIN_PASSWORD ? "(from SEED_ADMIN_PASSWORD)" : `"${password}" — CHANGE IT after first login`}`);
  } catch (err) {
    console.error("Super-admin seeding failed:", err);
    process.exit(1);
  } finally {
    await disconnectPrisma();
  }
};

main();
