// Video qualities: `qualities` hint on lecture/video listing rows so the download picker can show
// sizes without the expensive per-row detail call; the detail endpoint stays the
// source of truth for the playable set and encrypted URLs.

export interface ListingQuality {
  qualityLabel: string;
  bitrate: number; // bits per second
}

// Sorted highest-first per the FE contract.
const STANDARD_HEIGHTS: Array<{ qualityLabel: string; height: number }> = [
  { qualityLabel: "1080p", height: 1080 },
  { qualityLabel: "720p", height: 720 },
  { qualityLabel: "480p", height: 480 },
  { qualityLabel: "360p", height: 360 },
  { qualityLabel: "240p", height: 240 },
];

// Mirrors estimateBitrateForHeight() in videoResolver.ts, duplicated to avoid
// importing the resolver (ytdl-core + redis on module load).
function bitrateForHeight(height: number): number {
  if (height >= 1080) return 4_500_000;
  if (height >= 720) return 2_500_000;
  if (height >= 480) return 1_200_000;
  if (height >= 360) return 700_000;
  if (height >= 240) return 400_000;
  return 300_000;
}

// Synthetic ladder for lists where real renditions are only known after a resolve.
export function defaultListingQualities(): ListingQuality[] {
  return STANDARD_HEIGHTS
    .filter((q) => q.height <= 720) // match the FE's typical picker (720p top)
    .map((q) => ({ qualityLabel: q.qualityLabel, bitrate: bitrateForHeight(q.height) }));
}

// From LiveSession.recordings ("720p"-style labels), highest-first; labels without
// a parseable height are dropped.
export function qualitiesFromSessionRecordings(
  recordings: Array<{ quality: string | null }> | null | undefined
): ListingQuality[] {
  if (!Array.isArray(recordings) || recordings.length === 0) return [];
  const seen = new Set<string>();
  const out: Array<ListingQuality & { _h: number }> = [];
  for (const r of recordings) {
    const label = typeof r?.quality === "string" ? r.quality.trim() : "";
    const m = label.match(/(\d{3,4})\s*p/i);
    if (!m) continue;
    const height = parseInt(m[1], 10);
    const norm = `${height}p`;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push({ qualityLabel: norm, bitrate: bitrateForHeight(height), _h: height });
  }
  out.sort((a, b) => b._h - a._h);
  return out.map(({ _h, ...rest }) => rest);
}
