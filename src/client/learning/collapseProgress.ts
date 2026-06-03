/**
 * Progress is stored per (customer, lecture, container). The same video can
 * therefore have several rows for one customer — one per product they've opened
 * it from, each with its own resume position / completion.
 *
 * Listing screens (course detail, catalog, category, recordings) show a single
 * "watched" hint per video and do NOT carry a specific container context, so
 * they want the *furthest* progress the user has made on the video anywhere:
 *   - positionSec / durationSec / lastWatchedAt from the most-advanced row
 *   - completed = true if the video is completed in ANY container
 *
 * This collapses the raw per-container rows down to one entry per video for
 * exactly that use. (Per-container reads — the Resume feed, the dashboard
 * rollups — must NOT use this; they filter on a container pointer instead.)
 */
export interface CollapsedProgress {
  positionSec: number;
  durationSec: number;
  completed: boolean;
  completedAt: Date | null;
  lastWatchedAt: Date | null;
}

const better = (a: any, b: any): any => {
  // Prefer the row that proves the most progress: completed wins, then the
  // higher absolute position, then the more recent watch.
  if (!!a.completed !== !!b.completed) return a.completed ? a : b;
  if ((a.positionSec ?? 0) !== (b.positionSec ?? 0))
    return (a.positionSec ?? 0) > (b.positionSec ?? 0) ? a : b;
  const at = a.lastWatchedAt ? new Date(a.lastWatchedAt).getTime() : 0;
  const bt = b.lastWatchedAt ? new Date(b.lastWatchedAt).getTime() : 0;
  return at >= bt ? a : b;
};

/**
 * Reduce raw LectureProgress rows (already filtered to one customer + a set of
 * videoIds) to a Map keyed by videoId string, holding the furthest progress.
 */
export function collapseProgressByVideo(rows: any[]): Map<string, CollapsedProgress> {
  const best = new Map<string, any>();
  for (const r of rows) {
    if (!r.videoId) continue;
    const key = String(r.videoId);
    const cur = best.get(key);
    best.set(key, cur ? better(cur, r) : r);
  }
  const out = new Map<string, CollapsedProgress>();
  for (const [key, r] of best) {
    out.set(key, {
      positionSec: r.positionSec ?? 0,
      durationSec: r.durationSec ?? 0,
      completed: !!r.completed,
      completedAt: r.completedAt ?? null,
      lastWatchedAt: r.lastWatchedAt ?? null,
    });
  }
  return out;
}

/** Single-video variant: pick the furthest row, or null if none. */
export function collapseProgressRows(rows: any[]): CollapsedProgress | null {
  if (!rows.length) return null;
  const r = rows.reduce((acc, cur) => (acc ? better(acc, cur) : cur), null as any);
  return {
    positionSec: r.positionSec ?? 0,
    durationSec: r.durationSec ?? 0,
    completed: !!r.completed,
    completedAt: r.completedAt ?? null,
    lastWatchedAt: r.lastWatchedAt ?? null,
  };
}
