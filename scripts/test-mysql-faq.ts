/**
 * Smoke test: FAQ module reads from MySQL when `faq` is in MIGRATION_MYSQL_MODULES.
 *
 *   yarn db:test-faq
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const main = async () => {
  if (!process.env.MIGRATION_MYSQL_MODULES?.includes("faq")) {
    console.error('Set MIGRATION_MYSQL_MODULES to include "faq" (e.g. app-update,version,faq)');
    process.exit(1);
  }

  const { connectPrisma, disconnectPrisma } = await import("../src/config/prisma.ts");
  const { listFaqs, listFaqTypes } = await import("../src/modules/faq/faq.service.ts");

  await connectPrisma();
  try {
    const types = await listFaqTypes();
    const all = await listFaqs();
    const general = await listFaqs({ typeId: "general" });
    const referral = await listFaqs({ typeId: "referral" });

    console.log("FAQ types:", types);
    console.log(`FAQs total: ${all.length}`);
    console.log(`FAQs general: ${general.length}, referral: ${referral.length}`);

    if (all.length < 1) {
      console.warn("No FAQs — check dump import.");
      process.exit(1);
    }
    if (types.length !== 2) {
      console.warn("Expected 2 synthetic types (general, referral).");
    }
    console.log("FAQ module OK — data loaded from staging MySQL.");
  } finally {
    await disconnectPrisma();
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
