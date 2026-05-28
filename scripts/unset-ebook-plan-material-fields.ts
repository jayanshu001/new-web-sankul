/**
 * One-shot cleanup: remove the deprecated `withMaterial` and `materialPrice`
 * fields from every existing ws_ebook_prices document.
 *
 * Run once per environment:
 *   MONGODB_URI="<env-uri>" npx ts-node scripts/unset-ebook-plan-material-fields.ts
 *
 * Safe to re-run — $unset is idempotent.
 */
import "dotenv/config";
import mongoose from "mongoose";

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is required.");
    process.exit(1);
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error("No DB handle after connect");

  const result = await db.collection("ws_ebook_prices").updateMany(
    {
      $or: [
        { withMaterial: { $exists: true } },
        { materialPrice: { $exists: true } },
      ],
    },
    { $unset: { withMaterial: "", materialPrice: "" } }
  );

  console.log(
    `Matched ${result.matchedCount} docs, modified ${result.modifiedCount}.`
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
