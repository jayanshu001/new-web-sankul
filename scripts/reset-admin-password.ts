/**
 * One-shot admin password reset.
 *
 * Resets the password for a single (non-deleted) admin in `ws_users`, hashing
 * with bcryptjs at the same cost (SALT_ROUNDS = 10) the app uses, so the new
 * password works with the normal admin login flow.
 *
 * Usage:
 *   MONGODB_URI="<env-uri>" npx tsx scripts/reset-admin-password.ts <email> <newPassword>
 *
 * Example:
 *   MONGODB_URI="$MONGODB_URI" npx tsx scripts/reset-admin-password.ts admin@email.com 'S0me-Strong-Pass'
 *
 * Notes:
 *  - Matches the login query: email is lowercased and `deleted: false`.
 *  - Password must be >= 8 chars (mirrors createAdminUser validation).
 *  - This bypasses the current-password check on purpose; run it only against
 *    an account you control.
 */
import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10; // keep in sync with src/admin/auth/admin.auth.service.ts

async function main() {
  const [, , emailArg, newPassword] = process.argv;

  if (!emailArg || !newPassword) {
    console.error("Usage: npx tsx scripts/reset-admin-password.ts <email> <newPassword>");
    process.exit(1);
  }
  if (newPassword.length < 8) {
    console.error("New password must be at least 8 characters.");
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is required.");
    process.exit(1);
  }

  const email = emailArg.toLowerCase().trim();

  await mongoose.connect(uri);
  try {
    const db = mongoose.connection.db!;
    const users = db.collection("ws_users");

    const admin = await users.findOne({ email, deleted: false });
    if (!admin) {
      console.error(`No non-deleted admin found with email: ${email}`);
      process.exit(2);
    }

    const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await users.updateOne(
      { _id: admin._id },
      { $set: { password: hashed, updatedAt: new Date() } }
    );

    console.log(`✓ Password reset for ${email} (id: ${admin._id.toString()})`);
    console.log("Note: existing sessions are NOT auto-revoked by this script.");
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
