/**
 * Backfill ws_enrollment_resume (Layer-2 resume pointer) from existing
 * ws_lecture_progress rows. See docs/be-dashboard-resume-scope.md.
 *
 * LectureProgress is global-per-video and stamps container pointers additively, so
 * a historical row can't perfectly say which scope a shared video was watched
 * under. Best-effort: for each (customer, scopeKind, scopeId) take the most-recent
 * progress row that carries that container and seed the pointer from it. Going
 * forward, scoped heartbeats keep each pointer correct independently.
 *
 * Idempotent: re-running upserts the same (customer, scopeKind, scopeId) rows.
 *
 *   npx tsx scripts/backfill-enrollment-resume.ts
 */
import { prisma } from "../src/config/prisma";

type Kind = "course" | "package" | "liveCourse";

async function main() {
  const now = new Date();
  // Most-recent first so the FIRST row we see per (customer, kind, scopeId) wins.
  const rows = await prisma.lectureProgress.findMany({
    orderBy: { lastWatchedAt: "desc" },
    select: {
      customerId: true, videoId: true, liveSessionId: true,
      courseId: true, packageId: true, liveCourseId: true, lastWatchedAt: true,
    },
  });

  const seen = new Set<string>();
  let created = 0;
  for (const r of rows) {
    const targets: { kind: Kind; scopeId: number | null }[] = [
      { kind: "course", scopeId: r.courseId },
      { kind: "package", scopeId: r.packageId },
      { kind: "liveCourse", scopeId: r.liveCourseId },
    ];
    for (const t of targets) {
      if (t.scopeId == null) continue;
      const key = `${r.customerId}:${t.kind}:${t.scopeId}`;
      if (seen.has(key)) continue; // an already-seen (newer) row owns this pointer
      seen.add(key);
      await prisma.enrollmentResume.upsert({
        where: { uniq_customer_scope: { customerId: r.customerId, scopeKind: t.kind, scopeId: t.scopeId } },
        create: {
          customerId: r.customerId, scopeKind: t.kind, scopeId: t.scopeId,
          videoId: r.videoId ?? null, liveSessionId: r.liveSessionId ?? null,
          lastWatchedAt: r.lastWatchedAt ?? now, createdAt: now, updatedAt: now,
        },
        update: {
          videoId: r.videoId ?? null, liveSessionId: r.liveSessionId ?? null,
          lastWatchedAt: r.lastWatchedAt ?? now, updatedAt: now,
        },
      });
      created++;
    }
  }
  console.log(`Backfill complete. Scanned ${rows.length} progress rows → ${created} enrollment-resume pointers.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("Backfill failed:", e); process.exit(1); });
