/*
 * Backfill ws_book.is_trending + ws_ebook.is_trending from Mongo
 * (ws_books.isTrending / ws_ebooks.isTrending), matched by name.
 * Idempotent: sets is_trending=1 for matched trending rows.
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import { prisma } from "../src/config/prisma";

dotenv.config();

(async () => {
  await mongoose.connect(process.env.MONGODB_URI as string, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db!;

  const trendingBookNames = (await db.collection("ws_books").find({ isTrending: true }).project({ name: 1 }).toArray()).map((b) => b.name).filter(Boolean);
  let bookSet = 0;
  for (const name of trendingBookNames) {
    const r = await prisma.book.updateMany({ where: { name }, data: { isTrending: true } });
    bookSet += r.count;
  }
  console.log(`books: ${trendingBookNames.length} trending in Mongo → ${bookSet} SQL rows set`);

  const trendingEbookNames = (await db.collection("ws_ebooks").find({ isTrending: true }).project({ name: 1 }).toArray()).map((e) => e.name).filter(Boolean);
  let ebookSet = 0;
  for (const name of trendingEbookNames) {
    const r = await prisma.eBook.updateMany({ where: { name }, data: { isTrending: true } });
    ebookSet += r.count;
  }
  console.log(`ebooks: ${trendingEbookNames.length} trending in Mongo → ${ebookSet} SQL rows set`);

  await mongoose.disconnect();
  await prisma.$disconnect();
  process.exit(0);
})();
