/*
 * Self-check for live-chat public/private listing separation.
 *
 * This is the one path where a wrong filter is a privacy bug, not a display bug:
 * a private message must never reach a student it was not from or addressed to.
 * The assertions below fail if that scoping breaks.
 *
 *   npx tsx scripts/test-live-chat-private-scope.ts
 *
 * Writes rows into ws_live_chat_message under a throwaway liveClassId and deletes
 * them again in a finally block. Touches no real class.
 */

import assert from "assert";
import dotenv from "dotenv";
dotenv.config();

import { prisma } from "../src/config/prisma";
import { getChatHistory } from "../src/modules/admin-live-course/admin-live-course.service";

const LIVE_CLASS_ID = `__test_chat_scope_${Date.now()}`;
const STUDENT_A = 900000001;
const STUDENT_B = 900000002;

const texts = (rows: Array<{ message: string | null }>) => rows.map((r) => r.message);

async function main() {
  const now = new Date();
  const row = (over: Record<string, unknown>) => ({
    liveClassId: LIVE_CLASS_ID,
    userName: "t",
    createdAt: now,
    updatedAt: now,
    ...over,
  });

  // created oldest → newest so the chronological assertion below is meaningful
  await prisma.liveChatMessage.create({ data: row({ customerId: STUDENT_A, isAdmin: false, isPrivate: false, message: "pub-a" }) as any });
  await prisma.liveChatMessage.create({ data: row({ customerId: STUDENT_B, isAdmin: false, isPrivate: false, message: "pub-b", createdAt: new Date(now.getTime() + 1) }) as any });
  await prisma.liveChatMessage.create({ data: row({ customerId: STUDENT_A, isAdmin: false, isPrivate: true, message: "priv-a", createdAt: new Date(now.getTime() + 2) }) as any });
  await prisma.liveChatMessage.create({ data: row({ customerId: STUDENT_B, isAdmin: false, isPrivate: true, message: "priv-b", createdAt: new Date(now.getTime() + 3) }) as any });
  await prisma.liveChatMessage.create({ data: row({ adminId: 1, isAdmin: true, isPrivate: true, targetCustomerId: STUDENT_A, message: "host-to-a", createdAt: new Date(now.getTime() + 4) }) as any });
  // Unaddressed host message while private — the host talking to the whole class.
  await prisma.liveChatMessage.create({ data: row({ adminId: 1, isAdmin: true, isPrivate: true, targetCustomerId: null, message: "host-to-all", createdAt: new Date(now.getTime() + 5) }) as any });
  await prisma.liveChatMessage.create({ data: row({ adminId: 1, isAdmin: true, isPrivate: false, message: "host-public", createdAt: new Date(now.getTime() + 6) }) as any });

  // Public listing: both modes are stored, only public comes back — and it is the
  // same list for everyone, in chronological order.
  const pub = await getChatHistory(LIVE_CLASS_ID, 100, undefined, { isPrivate: false });
  assert.deepStrictEqual(texts(pub), ["pub-a", "pub-b", "host-public"], `public listing wrong: ${texts(pub)}`);

  // Host: the entire private thread, both students plus their own reply.
  const host = await getChatHistory(LIVE_CLASS_ID, 100, undefined, { isPrivate: true });
  assert.deepStrictEqual(texts(host), ["priv-a", "priv-b", "host-to-a", "host-to-all"], `host private listing wrong: ${texts(host)}`);

  // Student A: own message, the host reply addressed to them, and the host's
  // message to the class. NOT student B's message.
  const a = await getChatHistory(LIVE_CLASS_ID, 100, undefined, { isPrivate: true, viewerId: STUDENT_A });
  assert.deepStrictEqual(texts(a), ["priv-a", "host-to-a", "host-to-all"], `student A private listing wrong: ${texts(a)}`);

  // Student B: own message + the host's message to the class. The reply addressed
  // to A must NOT leak here — that is the whole point of the target column.
  const b = await getChatHistory(LIVE_CLASS_ID, 100, undefined, { isPrivate: true, viewerId: STUDENT_B });
  assert.deepStrictEqual(texts(b), ["priv-b", "host-to-all"], `student B private listing wrong: ${texts(b)}`);
  assert.ok(!texts(b).includes("host-to-a"), "a host reply addressed to A leaked into B's listing");

  // Neither listing may ever contain the other's rows.
  assert.ok(!texts(pub).some((t) => String(t).startsWith("priv")), "private message leaked into the public listing");
  assert.ok(!texts(host).some((t) => String(t).startsWith("pub")), "public message leaked into the private listing");

  console.log("\x1b[32mOK\x1b[0m  public/private listings stay separate and viewer-scoped.");
}

main()
  .catch((e) => {
    console.error(`\x1b[31mFAIL\x1b[0m  ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.liveChatMessage.deleteMany({ where: { liveClassId: LIVE_CLASS_ID } });
    await prisma.$disconnect();
    // Importing the service pulls in Redis, which keeps the event loop alive —
    // exit explicitly or the script hangs after the assertions have passed.
    process.exit(process.exitCode ?? 0);
  });
