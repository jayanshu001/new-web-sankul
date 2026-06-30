/*
 * Recover live-session recordings that StreamOS produced but never delivered to
 * us (the recording webhook was misregistered / unreachable, so the callbacks
 * never landed). This replays EXACTLY what the detail-endpoint recovery does
 * (getLiveSessionStatus): for each ENDED session with no recordings on the row,
 * poll StreamOS streamDetails; if recordings exist upstream, persist them, flip
 * status -> READY, and auto-promote the best one into each linked subject folder.
 *
 * Safe + idempotent: only touches sessions where status === "ENDED" AND the row
 * currently has zero recordings. Re-running is a no-op once recovered.
 *
 * Read-only preview (no writes):  DRY=1 npx tsx scripts/backfill-live-recordings-from-streamos.ts
 * Apply:                          npx tsx scripts/backfill-live-recordings-from-streamos.ts
 * Specific sessions only:         npx tsx scripts/backfill-live-recordings-from-streamos.ts 52 53 54
 *
 * NOTE: only operates on the MySQL (admin-live) backend — that is the live path.
 */
import dotenv from "dotenv";
import { prisma } from "../src/config/prisma";
import * as adminLiveSql from "../src/modules/admin-live/admin-live.service";
import { getStreamDetails, enrichMp4Sizes as streamosEnrichMp4Sizes, StreamosError } from "../src/admin/live/streamos.service";

dotenv.config();

const DRY = process.env.DRY === "1" || process.env.DRY === "true";
const onlyIds = process.argv.slice(2).map((s) => Number(s)).filter((n) => Number.isInteger(n));

type SqlRow = Awaited<ReturnType<typeof adminLiveSql.listSessions>>["rows"][number];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log(`=== Live recording recovery from StreamOS ${DRY ? "(DRY RUN — no writes)" : "(APPLYING)"} ===\n`);

  // Collect ENDED sessions (paginate to be safe).
  const ended: SqlRow[] = [];
  const take = 200;
  for (let skip = 0; ; skip += take) {
    const { rows } = await adminLiveSql.listSessions({ status: "ENDED", skip, take });
    ended.push(...rows);
    if (rows.length < take) break;
  }

  const candidates = ended.filter((row) => {
    if (onlyIds.length && !onlyIds.includes(Number(row.id))) return false;
    if (!row.streamId) return false;
    const hasRecordings = adminLiveSql.toPublicView(row, []).recordings.length > 0;
    return !hasRecordings;
  });

  console.log(`ENDED sessions: ${ended.length} | empty-recording candidates: ${candidates.length}\n`);

  let recovered = 0, stillProcessing = 0, errored = 0, promotedTotal = 0;

  for (const row of candidates) {
    const id = Number(row.id);
    const streamId = row.streamId as string;
    try {
      const details = await getStreamDetails(streamId);

      if (details.recordings.length === 0) {
        console.log(`· [${id}] "${row.title}" — StreamOS has 0 recordings (still processing / not recorded). skip`);
        stillProcessing++;
        await sleep(150);
        continue;
      }

      if (DRY) {
        console.log(`✓ [${id}] "${row.title}" — WOULD recover ${details.recordings.length} recording(s) + flip READY`);
        recovered++;
        await sleep(150);
        continue;
      }

      const mp4WithSize = details.mp4Recordings.length > 0
        ? await streamosEnrichMp4Sizes(details.mp4Recordings)
        : [];
      await adminLiveSql.updateByStreamId(streamId, {
        recordings: details.recordings,
        status: "READY",
        ...(mp4WithSize.length > 0 ? { mp4Recordings: mp4WithSize } : {}),
      });

      const courseIds = await adminLiveSql.getLinkedCourseIds(id);
      const videosBefore = await prisma.video.count({ where: { liveSessionId: id } });
      await adminLiveSql.maybeAutoPromoteRecordingSql({
        sessionId: id,
        sessionTitle: row.title ?? null,
        subject: row.subject ?? null,
        recordings: details.recordings,
        liveCourseIds: courseIds,
      });
      const videosAfter = await prisma.video.count({ where: { liveSessionId: id } });
      const promoted = Math.max(0, videosAfter - videosBefore);
      promotedTotal += promoted;

      console.log(`✓ [${id}] "${row.title}" — recovered ${details.recordings.length} recording(s), status READY, promoted ${promoted} video(s)${row.subject ? ` into "${row.subject}"` : " (no subject — not promoted)"}`);
      recovered++;
    } catch (err) {
      const msg = err instanceof StreamosError ? `${err.message} (upstream ${err.upstreamStatus ?? "?"})` : (err as Error).message;
      console.log(`✗ [${id}] "${row.title}" — ERROR: ${msg}`);
      errored++;
    }
    await sleep(200); // be gentle with StreamOS (429 = capacity limit)
  }

  console.log(`\n=== Summary ===`);
  console.log(`recovered:        ${recovered}${DRY ? " (would)" : ""}`);
  console.log(`videos promoted:  ${promotedTotal}`);
  console.log(`still processing: ${stillProcessing}`);
  console.log(`errored:          ${errored}`);

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error("FATAL:", e);
  await prisma.$disconnect();
  process.exit(1);
});
