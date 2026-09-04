/*
 * Probe the REAL StreamOS v1 API and check our client against it.
 *
 * Everything we built is derived from documentation — no byte has crossed the
 * wire yet. This script is the cheapest way to find out where the docs and the
 * live API disagree, BEFORE a real class depends on it.
 *
 * READ-ONLY BY DEFAULT. It lists assets and livestreams; it creates nothing,
 * changes nothing, and consumes no stream slot.
 *
 *   STREAMOS_API_KEY=sk_live_… npx tsx scripts/probe-streamos-v1.ts
 *
 * Opt in to the write path (creates ONE stream, then immediately ends it):
 *
 *   STREAMOS_API_KEY=sk_live_… PROBE_WRITE=1 npx tsx scripts/probe-streamos-v1.ts
 *
 * ⚠ PROBE_WRITE takes a live-stream slot for a few seconds. Staging and
 *   production share one StreamOS organisation, so a slot taken here is a slot a
 *   real class cannot use. NEVER run it during class hours.
 *
 * Context: docs/migration/STREAMOS_V1_CHANGE_MATRIX.md
 */

import dotenv from "dotenv";
dotenv.config();

import { streamosV1Base, streamosV1ApiKey } from "../src/config/streamos";
import {
  listAssets,
  listLiveStreams,
  getAsset,
  createLiveStream,
  endLiveStream,
  getLiveStream,
  StreamosError,
} from "../src/admin/live/streamos.v1.service";

const WRITE = process.env.PROBE_WRITE === "1" || process.env.PROBE_WRITE === "true";

const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m: string) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const info = (m: string) => console.log(`    ${m}`);
const head = (m: string) => console.log(`\n\x1b[1m${m}\x1b[0m`);

let failures = 0;
const fail = (m: string) => {
  failures++;
  bad(m);
};

const describe = (e: unknown): string =>
  e instanceof StreamosError
    ? `${e.message} (upstream ${e.upstreamStatus ?? "?"})`
    : (e as Error)?.message ?? String(e);

(async () => {
  console.log("\n\x1b[1mStreamOS v1 — live API probe\x1b[0m");
  console.log(`Base: ${streamosV1Base()}`);
  console.log(`Mode: ${WRITE ? "READ + WRITE (creates one stream)" : "READ-ONLY"}`);

  if (!streamosV1ApiKey()) {
    console.error("\n\x1b[31mSTREAMOS_API_KEY is not set.\x1b[0m");
    console.error("Generate one at https://streamos.in/settings/api-keys, then:");
    console.error("  STREAMOS_API_KEY=sk_live_… npx tsx scripts/probe-streamos-v1.ts\n");
    process.exit(2);
  }

  // ── 1. Auth, base URL, envelope ───────────────────────────────────────────
  // One read proves four things at once: the host is right, the Bearer header
  // is accepted, the response envelope unwraps, and our parser holds.
  head("1. Authentication + envelope  ·  GET /assets/");
  let sampleAssetId: string | null = null;
  try {
    const res = await listAssets();
    ok(`Authenticated. ${res.assets.length} asset(s), ${res.folders.length} folder(s) returned.`);
    if (res.assets.length) {
      const a = res.assets[0];
      sampleAssetId = a.publicId || null;
      info(`sample: ${a.publicId}  status=${a.status}  kind=${a.kind}`);
      if (!a.publicId) fail("Asset returned without a public_id — our parser expects one.");
    } else {
      info("Library is empty — fine, but nothing to inspect below.");
    }
  } catch (e) {
    fail(`GET /assets/ failed: ${describe(e)}`);
    console.error("\nEverything else depends on this. Stopping.\n");
    process.exit(1);
  }

  // ── 2. Asset detail — the recording playback shape ────────────────────────
  head("2. Asset detail  ·  GET /assets/{id}/");
  if (!sampleAssetId) {
    info("Skipped — no asset in the library yet.");
  } else {
    try {
      const a = await getAsset(sampleAssetId);
      ok(`Fetched ${a.publicId}`);
      info(`status=${a.status}  duration=${a.durationSeconds ?? "null"}s  size=${a.sizeBytes ?? "null"}`);
      info(`hlsManifestUrl: ${a.hlsManifestUrl ? "present" : "\x1b[31mNULL\x1b[0m"}`);
      info(`renditions: ${a.renditions.length}${a.renditions.length ? ` (${a.renditions.map((r) => r.quality).join(", ")})` : ""}`);
      if (a.tags && Object.keys(a.tags).length) {
        info(`tags: ${JSON.stringify(a.tags)}`);
      } else {
        info("tags: none on this asset");
      }
      if (String(a.status).toUpperCase() === "COMPLETED" && !a.hlsManifestUrl) {
        fail("Asset is COMPLETED but hlsManifestUrl is null — nothing would be playable.");
      }
    } catch (e) {
      fail(`GET /assets/{id}/ failed: ${describe(e)}`);
    }
  }

  // ── 3. Livestream list ────────────────────────────────────────────────────
  head("3. Livestreams  ·  GET /livestreams/");
  try {
    const streams = await listLiveStreams();
    ok(`${streams.length} livestream(s) returned.`);
    for (const s of streams.slice(0, 3)) {
      info(`${s.publicId}  status=${s.status}  recordedAsset=${s.recordedAssetId ?? "none"}`);
    }
    const statuses = [...new Set(streams.map((s) => String(s.status)))];
    if (statuses.length) info(`statuses seen: ${statuses.join(", ")}`);
    // The docs promise SCHEDULED → READY_TO_STREAM → ENDED and no LIVE state.
    const unexpected = statuses.filter((s) => !["SCHEDULED", "READY_TO_STREAM", "ENDED", ""].includes(s));
    if (unexpected.length) {
      fail(`Undocumented status value(s): ${unexpected.join(", ")} — our liveness logic assumes only the documented three.`);
    }
  } catch (e) {
    fail(`GET /livestreams/ failed: ${describe(e)}`);
  }

  // ── 4. Write path (opt-in) ────────────────────────────────────────────────
  head("4. Create + end a stream  ·  POST /livestreams/");
  if (!WRITE) {
    info("Skipped (read-only). Re-run with PROBE_WRITE=1 to test it.");
    info("⚠ That takes a live-stream slot — never during class hours.");
  } else {
    let publicId: string | null = null;
    try {
      const created = await createLiveStream({
        title: `WebSankul probe ${new Date().toISOString()}`,
        customTags: { wsEnv: "probe", wsSessionId: "0" },
      });
      publicId = created.publicId;
      ok(`Created ${created.publicId}`);
      info(`status=${created.status}`);
      info(`rtmpUrl: ${created.rtmpUrl ? "present" : "null"}`);
      info(`streamKey: ${created.streamKey ?? "null"}`);
      info(`pushExpiresAt: ${created.pushExpiresAt ?? "null"}`);

      // The 24h expiry is the single behavioural assumption our provisioning
      // rework is built on. If it is absent, that rework may be unnecessary.
      if (!created.pushExpiresAt) {
        fail("No push_expires_at returned — our 24h-expiry handling assumes it exists.");
      } else {
        const hours = (new Date(created.pushExpiresAt).getTime() - Date.now()) / 3_600_000;
        info(`  → expires in ~${hours.toFixed(1)}h ${hours > 20 && hours < 30 ? "(matches the documented 24h)" : "\x1b[33m(NOT ~24h — check the docs again)\x1b[0m"}`);
      }
      if (!created.rtmpUrl) fail("No rtmp_url on a directly-created stream — expected one.");

      // Does our own tag survive the round trip? This is what our webhook
      // correlation falls back to when their `stream` object is absent.
      const back = await getLiveStream(created.publicId);
      const tags = back.tags ?? {};
      if (Object.keys(tags).length) {
        ok(`customTags echoed back: ${JSON.stringify(tags)}`);
        if ((tags as any).wsSessionId === undefined) {
          fail("customTags returned but wsSessionId is missing — our fallback correlation would not work.");
        }
      } else {
        fail("customTags did NOT come back on the stream — our fallback correlation depends on it. Ask StreamOS.");
      }
    } catch (e) {
      fail(`Create failed: ${describe(e)}`);
    } finally {
      if (publicId) {
        try {
          await endLiveStream(publicId);
          ok(`Ended ${publicId} — slot released.`);
        } catch (e) {
          fail(`Could not end ${publicId}: ${describe(e)} — END IT MANUALLY in the StreamOS dashboard, it is holding a slot.`);
        }
      }
    }
  }

  // ── verdict ───────────────────────────────────────────────────────────────
  console.log("");
  if (failures) {
    console.log(`\x1b[31m${failures} problem(s) found.\x1b[0m Each one is a place the live API differs from the docs we built against.\n`);
    process.exit(1);
  }
  console.log("\x1b[32mNo mismatches found.\x1b[0m Our client agrees with the live API on everything probed.");
  if (!WRITE) console.log("Read-only run — the create/end path is still unproven.\n");
  else console.log("");
  process.exit(0);
})().catch((e) => {
  console.error("\nFATAL:", describe(e), "\n");
  process.exit(1);
});
