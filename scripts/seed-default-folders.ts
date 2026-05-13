/**
 * One-shot backfill: ensure every existing customer has the two default
 * folders — "My Videos" (type=video) and "My Materials" (type=material).
 *
 * Usage (from repo root):
 *   npx ts-node scripts/seed-default-folders.ts
 *
 * Idempotent. Safe to re-run.
 */
import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../src/config/db";
import { Customer } from "../src/models/customer/Customer.model";
import { Folder } from "../src/models/customer/Folder.model";

const DEFAULTS: Array<{ type: "video" | "material"; name: string }> = [
  { type: "video", name: "My Videos" },
  { type: "material", name: "My Materials" },
];

async function main() {
  await connectDB();

  const cursor = Customer.find({}).select("_id").lean().cursor();
  let scanned = 0;
  let created = 0;

  for await (const c of cursor as any) {
    scanned++;
    for (const d of DEFAULTS) {
      const r = await Folder.updateOne(
        { customerId: c._id, type: d.type, isDefaultFolder: true },
        { $setOnInsert: { customerId: c._id, type: d.type, name: d.name, isDefaultFolder: true } },
        { upsert: true }
      );
      if ((r as any).upsertedCount) created++;
    }
    if (scanned % 500 === 0) console.log(`scanned=${scanned} created=${created}`);
  }

  console.log(`done. customers scanned=${scanned}, default folders created=${created}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
