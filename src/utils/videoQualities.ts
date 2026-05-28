// Lightweight `qualities` array embedded in lecture/video LISTING rows so the
// mobile download picker can render "720p — ~320 MB" without a per-row call to
// the detail endpoint (which resolves + encrypts a playback token, expensive).
// The client falls back to the detail endpoint when the user actually confirms
// a download and needs the encrypted URL.

export interface ListingQuality {
  qualityLabel: string;
  bitrate: number; // bits per second
}

// Standard rendition ladder we publish across all videos. The detail endpoint
// remains the source of truth for the actual playable set; this list is a
// best-effort hint for the download size estimator. Sorted highest-first per
// the FE contract.
const STANDARD_HEIGHTS: Array<{ qualityLabel: string; height: number }> = [
  { qualityLabel: "1080p", height: 1080 },
  { qualityLabel: "720p", height: 720 },
  { qualityLabel: "480p", height: 480 },
  { qualityLabel: "360p", height: 360 },
  { qualityLabel: "240p", height: 240 },
];

// Mirrors estimateBitrateForHeight() in videoResolver.ts. Duplicated here so
// listing rows can be built without importing the resolver (which pulls in
// ytdl-core + redis on module load).
function bitrateForHeight(height: number): number {
  if (height >= 1080) return 4_500_000;
  if (height >= 720) return 2_500_000;
  if (height >= 480) return 1_200_000;
  if (height >= 360) return 700_000;
  if (height >= 240) return 400_000;
  return 300_000;
}

// Synthetic ladder for recorded-lecture lists where progressive renditions are
// only known after a live ytdl/VideoCrypt resolve. Returns the standard 4-tier
// set the FE expects.
export function defaultListingQualities(): ListingQuality[] {
  return STANDARD_HEIGHTS
    .filter((q) => q.height <= 720) // match the FE's typical picker (720p top)
    .map((q) => ({ qualityLabel: q.qualityLabel, bitrate: bitrateForHeight(q.height) }));
}

// Build a `qualities` array from a LiveSession.recordings list (already on hand
// in the live-course recordings endpoint). `quality` strings on those rows look
// like "720p" / "480p" — we keep the label and attach the height-based bitrate
// estimate. Sorted highest-first; entries we can't parse a height from are
// dropped. Returns [] when input is empty/invalid.
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
