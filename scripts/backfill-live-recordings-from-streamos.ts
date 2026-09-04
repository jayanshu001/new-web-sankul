/*
 * Recover live-session recordings that StreamOS produced but never delivered to
 * us (the recording webhook was misregistered / unreachable, so the callbacks
 * never landed). This replays EXACTLY what the detail-endpoint recovery does
 * (getLiveSessionStatus): for each ENDED session with no recordings on the row,
 * ask StreamOS what it holds; if recordings exist upstream, persist them, flip
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
 *
 * PROVIDER-AWARE. Each session is polled on the API its own `streamProvider`
 * names, so a mixed table (legacy rows + v1 rows) recovers in one pass. On v1 a
 * recording is a library ASSET: the asset id is stamped on the row as it is
 * discovered, which is also what lets a later webhook correlate to the session.
 */
import dotenv from "dotenv";
import { prisma } from "../src/config/prisma";
import * as adminLiveSql from "../src/modules/admin-live/admin-live.service";
import { enrichMp4Sizes as streamosEnrichMp4Sizes } from "../src/admin/live/streamos.service";
import { getDetails as getStreamDetails, providerOf, StreamosError } from "../src/admin/live/streamos.provider";

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
    try {
      const provider = providerOf(row);
      const details = await getStreamDetails(row);

      if (details.recordings.length === 0) {
        const why = details.recordingProcessing
          ? "recording exists but is still transcoding"
          : "still processing / not recorded";
        console.log(`· [${id}] "${row.title}" (${provider}) — StreamOS has 0 playable recordings (${why}). skip`);
        stillProcessing++;

        // Even when nothing is playable yet, capture the asset pointer if v1
        // surfaced one — it is what the later webhook correlates on, and what a
        // re-run of this script uses to resolve the recording directly.
        if (!DRY && details.recordedAssetId && !row.recordedAssetId) {
          await adminLiveSql.updateSession(id, { recordedAssetId: details.recordedAssetId });
          console.log(`  ↳ stored recordedAssetId=${details.recordedAssetId}`);
        }
        await sleep(150);
        continue;
      }

      if (DRY) {
        console.log(`✓ [${id}] "${row.title}" (${provider}) — WOULD recover ${details.recordings.length} recording(s) + flip READY`);
        recovered++;
        await sleep(150);
        continue;
      }

      const mp4WithSize = details.mp4Recordings.length > 0
        ? await streamosEnrichMp4Sizes(details.mp4Recordings)
        : [];
      await adminLiveSql.updateSession(id, {
        recordings: details.recordings,
        status: "READY",
        ...(mp4WithSize.length > 0 ? { mp4Recordings: mp4WithSize } : {}),
        ...(details.recordedAssetId ? { recordedAssetId: details.recordedAssetId } : {}),
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

      console.log(`✓ [${id}] "${row.title}" (${provider}) — recovered ${details.recordings.length} recording(s), status READY, promoted ${promoted} video(s)${row.subject ? ` into "${row.subject}"` : " (no subject — not promoted)"}`);
      recovered++;
    } catch (err) {
      const msg = err instanceof StreamosError ? `${err.message} (upstream ${err.upstreamStatus ?? "?"})` : (err as Error).message;
      console.log(`✗ [${id}] "${row.title}" — ERROR: ${msg}`);
      errored++;
    }
    // Pacing. Legacy 429 = org capacity; v1 caps at 120 req/min per key and this
    // loop can spend two calls per session (stream + asset), so v1 waits longer.
    await sleep(providerOf(row) === "v1" ? 600 : 200);
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
