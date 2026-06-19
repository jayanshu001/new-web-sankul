/*
 * Backfill Mongo referral content → SQL (C8):
 *   ws_referral_terms → ws_refferal_term
 *   ws_referral_faqs  → ws_refferal_faq
 *
 * These are NET-NEW SQL tables, so clear-then-insert is idempotent (like
 * backfill-mongo-only-tail.ts). Fresh SQL auto-increment ids are assigned;
 * we preserve the Mongo order/_id ordering on insert. Mongo `order` maps to
 * the SQL `orderBy` column.
 *
 * Run: DATABASE_URL='...' MONGODB_URI='...' npx tsx scripts/backfill-c8-referral-content.ts
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import { prisma } from "../src/config/prisma";
import { ReferralTerm } from "../src/models/referral/ReferralTerm.model";
import { ReferralFaq } from "../src/models/referral/ReferralFaq.model";

dotenv.config();

(async () => {
  await mongoose.connect(process.env.MONGODB_URI as string, { serverSelectionTimeoutMS: 10000 });

  // Clear (net-new tables → idempotent re-run).
  await prisma.refferalTerm.deleteMany({});
  await prisma.refferalFaq.deleteMany({});

  // ── Terms ──
  const terms: any[] = await ReferralTerm.find({}).sort({ order: 1, _id: 1 }).lean();
  for (const t of terms) {
    await prisma.refferalTerm.create({
      data: {
        text: t.text,
        orderBy: t.order ?? 0,
        status: t.status ?? true,
        createdAt: t.createdAt ?? null,
        updatedAt: t.updatedAt ?? null,
      },
    });
  }
  console.log(`refferal_term: ${terms.length}`);

  // ── FAQs ──
  const faqs: any[] = await ReferralFaq.find({}).sort({ order: 1, _id: 1 }).lean();
  for (const f of faqs) {
    await prisma.refferalFaq.create({
      data: {
        question: f.question,
        answer: f.answer,
        orderBy: f.order ?? 0,
        status: f.status ?? true,
        createdAt: f.createdAt ?? null,
        updatedAt: f.updatedAt ?? null,
      },
    });
  }
  console.log(`refferal_faq: ${faqs.length}`);

  await mongoose.disconnect();
  await prisma.$disconnect();
  console.log("✅ backfill complete");
  process.exit(0);
})();
