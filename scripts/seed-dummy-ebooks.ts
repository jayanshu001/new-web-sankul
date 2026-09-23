/**
 * Seed dummy rows into ws_ebook for cache load/volume testing.
 *
 * Defaults to 500 rows. Every non-null column on the EBook model is populated so
 * the rows exercise the ebook list/detail + cache code paths just like real data.
 *
 * Every row is tagged  name starts with "DUMMY_SEED"  so it can be removed cleanly:
 *   npx tsx scripts/seed-dummy-ebooks.ts --clean
 *
 * Usage:
 *   npx tsx scripts/seed-dummy-ebooks.ts               # 500 rows
 *   COUNT=1000 npx tsx scripts/seed-dummy-ebooks.ts    # custom count
 *   npx tsx scripts/seed-dummy-ebooks.ts --clean       # delete all DUMMY_SEED ebooks
 *
 * ⚠ Writes to whatever DATABASE_URL points at — run against STAGING, not prod.
 */
import { prisma } from "../src/config/prisma";

const TAG = "DUMMY_SEED";
const COUNT = Number(process.env.COUNT) || 500;
const BATCH = Number(process.env.BATCH) || 500;

const LANGUAGES = ["English", "Gujarati", "Hindi"] as const;

async function clean() {
  const res = await prisma.eBook.deleteMany({
    where: { name: { startsWith: TAG } },
  });
  console.log(`Deleted ${res.count} dummy ebooks.`);
}

async function seed() {
  const now = new Date();
  const rows = Array.from({ length: COUNT }, (_, i) => {
    const n = i + 1;
    return {
      name: `${TAG} eBook ${n}`,
      thumbnail: `https://dummy.example.com/ebooks/thumb-${n}.jpg`,
      image: `https://dummy.example.com/ebooks/cover-${n}.jpg`,
      description: `Dummy seeded eBook #${n} for cache testing.`,
      termsAndConditions: "Dummy terms and conditions for load testing.",
      author: `Author ${n}`,
      publisher: `Publisher ${(n % 20) + 1}`,
      orderby: n,
      isTrending: n % 5 === 0,
      language: LANGUAGES[n % LANGUAGES.length],
      bookDemoUrl: `https://dummy.example.com/ebooks/demo-${n}.pdf`,
      bookUrl: `https://dummy.example.com/ebooks/book-${n}.pdf`,
      bookFileName: `book-${n}.pdf`,
      demoFileName: `demo-${n}.pdf`,
      bookUploadStatus: "completed",
      demoUploadStatus: "completed",
      bookUploadProgress: 100,
      demoUploadProgress: 100,
      shareableLink: `https://dummy.example.com/ebooks/share-${n}`,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
  });

  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const res = await prisma.eBook.createMany({ data: chunk });
    inserted += res.count;
    console.log(`Inserted ${inserted}/${COUNT}`);
  }
  console.log(`Done. Seeded ${inserted} dummy ebooks.`);
}

async function main() {
  const isClean = process.argv.includes("--clean");
  if (isClean) {
    await clean();
  } else {
    await seed();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
