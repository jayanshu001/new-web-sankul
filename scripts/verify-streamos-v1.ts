/*
 * Behavioural checks for the StreamOS v1 integration.
 *
 * `yarn typecheck` proves these modules COMPILE. It does not prove the API
 * response contract is unchanged, that the webhook signature actually rejects a
 * forgery, or that a legacy session still resolves the way it always did. This
 * script exercises the real exported functions and asserts on their output.
 *
 * Pure in-process — no database, no network, no env setup. Safe to run anywhere.
 *
 *   npx tsx scripts/verify-streamos-v1.ts
 *
 * Exits non-zero on any failure, so it can gate a deploy.
 *
 * Context: docs/migration/STREAMOS_V1_CHANGE_MATRIX.md
 */

// Must be set BEFORE importing the webhook module — the env-isolation check
// reads it at call time via streamosEnvTag(), which falls back to NODE_ENV.
process.env.STREAMOS_ENV_TAG = "production";

import crypto from "crypto";
import { verifyStreamosSignature } from "../src/utils/streamosSignature";
import {
  toPublicView,
  primaryRecordingsOf,
  pickRecordingSql,
} from "../src/modules/admin-live/admin-live.service";
import { providerOf, pushCredentialsExpired } from "../src/admin/live/streamos.provider";
import { assetIdFromBody, isForeignEnvironment } from "../src/admin/live/streamos.v1.webhook";
import { __test__ as v1parse } from "../src/admin/live/streamos.v1.service";

let pass = 0;
const failures: string[] = [];
let group = "";

const g = (name: string) => {
  group = name;
};
const check = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    pass++;
  } else {
    failures.push(`[${group}] ${name}\n      got  = ${JSON.stringify(got)}\n      want = ${JSON.stringify(want)}`);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. Webhook signature. The one thing standing between us and a forged
//    recording URL being written into a course folder.
// ─────────────────────────────────────────────────────────────────────────────
g("signature");
{
  const secret = "whsec_test_abc123";
  const body = Buffer.from(JSON.stringify({ event: "LIVESTREAM_RECORDING_READY" }));
  const now = Math.floor(Date.now() / 1000);
  const hmac = (p: Buffer | string) => crypto.createHmac("sha256", secret).update(p).digest("hex");
  const stamped = (t: number) => hmac(Buffer.concat([Buffer.from(`${t}.`), body]));

  // StreamOS documents "HMAC of the raw body" but uses a Stripe-shaped
  // `t=…,v1=…` header, which conventionally signs `<t>.<body>`. Both are
  // accepted until a real delivery tells us which; neither is forgeable.
  check("stripe-style payload accepted", verifyStreamosSignature(body, `t=${now},v1=${stamped(now)}`, secret, now), { ok: true, scheme: "timestamped" });
  check("body-only payload accepted", verifyStreamosSignature(body, `t=${now},v1=${hmac(body)}`, secret, now), { ok: true, scheme: "body-only" });

  check("tampered body rejected", verifyStreamosSignature(Buffer.from("{}"), `t=${now},v1=${stamped(now)}`, secret, now).ok, false);
  check("wrong secret rejected", verifyStreamosSignature(body, `t=${now},v1=${stamped(now)}`, "wrong", now).ok, false);
  check("replay outside window rejected", verifyStreamosSignature(body, `t=${now - 600},v1=${stamped(now - 600)}`, secret, now).ok, false);
  check("299s inside window accepted", verifyStreamosSignature(body, `t=${now - 299},v1=${stamped(now - 299)}`, secret, now).ok, true);
  check("malformed header rejected", verifyStreamosSignature(body, "garbage", secret, now).ok, false);
  check("missing header rejected", verifyStreamosSignature(body, undefined, secret, now).ok, false);
  check("empty raw body rejected", verifyStreamosSignature(Buffer.alloc(0), `t=${now},v1=${stamped(now)}`, secret, now).ok, false);
  check("unconfigured secret rejected", verifyStreamosSignature(body, `t=${now},v1=${stamped(now)}`, "", now).ok, false);

  // A re-serialised object has different whitespace/key order → must not verify.
  // This is what enforces "use req.rawBody, never the parsed body".
  check("re-serialised body rejected", verifyStreamosSignature(Buffer.from(body.toString() + " "), `t=${now},v1=${stamped(now)}`, secret, now).ok, false);

  let threw = false;
  try {
    verifyStreamosSignature(body, `t=${now},v1=zzz`, secret, now);
  } catch {
    threw = true;
  }
  check("non-hex signature does not throw", threw, false);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. API response contract. Legacy output must be BYTE-IDENTICAL to what it was
//    before the v1 work — this is the promise made to both frontends.
// ─────────────────────────────────────────────────────────────────────────────
g("dto contract");
{
  const MP4 = [
    { quality: "720p", file_size: 100, path: "https://cdn/a-720.mp4" },
    { quality: "480p", file_size: 50, path: "https://cdn/a-480.mp4" },
  ];
  const HLS = [{ quality: "720p", path: "https://cdn/a-720.m3u8" }];
  const row: any = {
    id: 7, title: "Physics 1", subject: "phy", educatorId: 3,
    scheduledAt: null, endAt: null, status: "READY",
    streamId: "T_177", streamProvider: null, streamKey: null,
    pushExpiresAt: null, recordedAssetId: null, notifiedStreamId: null,
    rtmpUrl: "rtmp://x", hlsUrl: "https://cdn/live.m3u8", hlsUrls: { "720": "u" },
    recordings: HLS, mp4Recordings: MP4, recordingTargetFolderId: null,
    createdAt: null, updatedAt: null,
  };

  const legacy = toPublicView(row, [11], undefined, []);
  check("legacy recordings still = mp4Recordings", legacy.recordings, MP4);
  check("legacy hlsRecordings unchanged", legacy.hlsRecordings, HLS);
  check("legacy mp4Url still picks highest", legacy.mp4Url, "https://cdn/a-720.mp4");
  check("null provider column reports legacy", legacy.streamProvider, "legacy");

  // Every key the contract carried BEFORE this work.
  const PRE = ["id","title","liveCourseIds","liveCourseId","liveCourses","liveCourseFolders",
    "subject","endAt","status","scheduledAt","streamId","rtmpUrl","hlsUrl","hlsUrls",
    "recordings","hlsRecordings","mp4Recordings","mp4Url","createdAt","updatedAt"];
  check("no pre-existing key dropped", PRE.filter((k) => !(k in legacy)), []);
  check("exactly 4 keys added, nothing else", Object.keys(legacy).filter((k) => !PRE.includes(k)).sort(),
    ["pushExpiresAt","recordedAssetId","streamKey","streamProvider"]);

  // v1 produces NO mp4 ladder. `recordings` must not publish as [].
  const v1: any = { ...row, streamProvider: "v1", streamKey: "EXSO_1786", recordedAssetId: "MflonNqhUg9", mp4Recordings: [], recordings: HLS };
  const v1View = toPublicView(v1, [11], undefined, []);
  check("v1 recordings fall back to HLS ladder", v1View.recordings, HLS);
  check("v1 mp4Recordings honestly empty", v1View.mp4Recordings, []);
  check("v1 mp4Url null", v1View.mp4Url, null);
  check("v1 streamKey surfaced", v1View.streamKey, "EXSO_1786");
  check("v1 recordedAssetId surfaced", v1View.recordedAssetId, "MflonNqhUg9");

  check("no recording at all stays empty", primaryRecordingsOf({ ...row, recordings: [], mp4Recordings: [] } as any), []);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Provider resolution. NULL must read as legacy — that is what makes the
//    stream_provider column backfill-free for every existing row.
// ─────────────────────────────────────────────────────────────────────────────
g("provider");
{
  check("null column = legacy", providerOf({ streamProvider: null }), "legacy");
  check("absent column = legacy", providerOf({}), "legacy");
  check("null row = legacy", providerOf(null), "legacy");
  check("explicit v1", providerOf({ streamProvider: "v1" }), "v1");
  check("unrecognised value = legacy", providerOf({ streamProvider: "V2" }), "legacy");
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Push-credential expiry. v1 ingest URLs die ~24h after minting; legacy ones
//    never expire and must never be reported as stale.
// ─────────────────────────────────────────────────────────────────────────────
g("push expiry");
{
  check("legacy (null) never expired", pushCredentialsExpired(null), false);
  check("2h in future is valid", pushCredentialsExpired(new Date(Date.now() + 7200e3)), false);
  check("1h in past is expired", pushCredentialsExpired(new Date(Date.now() - 3600e3)), true);
  check("30s away treated as expired (60s guard)", pushCredentialsExpired(new Date(Date.now() + 30e3)), true);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Webhook payload parsing, against StreamOS's own documented samples.
// ─────────────────────────────────────────────────────────────────────────────
g("payload parsing");
{
  check("RECORDING_READY → asset_id", assetIdFromBody({ recording: { asset_id: "MflonNqhUg9", transcoding: true } }), "MflonNqhUg9");
  check("TRANSCODING_COMPLETED → video.id", assetIdFromBody({ video: { id: "oI1j0SfJK3v", url: "https://x/master.m3u8" } }), "oI1j0SfJK3v");
  check("LIVESTREAM_ENDED (recording:null)", assetIdFromBody({ recording: null }), null);
  check("LIVESTREAM_ENDED with a recording", assetIdFromBody({ recording: { asset_id: "ZZZ999" } }), "ZZZ999");
  check("LIVESTREAM_SCHEDULED has no asset", assetIdFromBody({ stream: { rtmp_url: "rtmp://x", stream_key: "EXSO_1786" } }), null);
  check("empty data", assetIdFromBody({}), null);
  check("undefined data", assetIdFromBody(undefined), null);
  check("object id ignored", assetIdFromBody({ video: { id: { nested: 1 } } }), null);
  check("blank id ignored", assetIdFromBody({ video: { id: "   " } }), null);
  check("numeric id coerced", assetIdFromBody({ video: { id: 12345 } }), "12345");
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Environment isolation. Staging and production share ONE StreamOS org and
//    ONE key, so this endpoint can receive the other deployment's recordings.
// ─────────────────────────────────────────────────────────────────────────────
g("env isolation");
{
  check("own env via stream.tags", isForeignEnvironment({ data: { stream: { tags: { wsEnv: "production" } } } }), false);
  check("own env via video.tags", isForeignEnvironment({ data: { video: { tags: { wsEnv: "production" } } } }), false);
  check("own env via recording.tags", isForeignEnvironment({ data: { recording: { tags: { wsEnv: "production" } } } }), false);
  check("own env via data.tags", isForeignEnvironment({ data: { tags: { wsEnv: "production" } } }), false);

  check("staging delivery is foreign", isForeignEnvironment({ data: { stream: { tags: { wsEnv: "staging" } } } }), true);
  check("development delivery is foreign", isForeignEnvironment({ data: { video: { tags: { wsEnv: "development" } } } }), true);

  // UNTAGGED must be treated as OURS. Legacy streams, dashboard-created streams
  // and anything predating the tag carry none — dropping those loses recordings.
  check("no tags at all → ours", isForeignEnvironment({ data: { recording: { asset_id: "X" } } }), false);
  check("empty data → ours", isForeignEnvironment({ data: {} }), false);
  check("no data → ours", isForeignEnvironment({}), false);
  check("tags without wsEnv → ours", isForeignEnvironment({ data: { stream: { tags: { wsSessionId: "42" } } } }), false);
  check("blank wsEnv → ours", isForeignEnvironment({ data: { stream: { tags: { wsEnv: "   " } } } }), false);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Recording promotion. v1 lists lead with an adaptive master; promoting a
//    fixed rendition instead would pin every viewer to that resolution forever.
// ─────────────────────────────────────────────────────────────────────────────
g("recording picker");
{
  const legacyLadder = [
    { quality: "360p", path: "l360.mp4" },
    { quality: "720p", path: "l720.mp4" },
    { quality: "480p", path: "l480.mp4" },
  ];
  check("legacy still picks highest", pickRecordingSql(legacyLadder)?.path, "l720.mp4");
  check("legacy 1080p wins", pickRecordingSql([...legacyLadder, { quality: "1080p", path: "l1080.mp4" }])?.path, "l1080.mp4");
  check("legacy unknown quality falls through", pickRecordingSql([{ quality: "weird", path: "x.mp4" }])?.path, "x.mp4");

  const v1Ladder = [
    { quality: "auto", path: "master.m3u8" },
    { quality: "480p", path: "v480.m3u8" },
    { quality: "720p", path: "v720.m3u8" },
  ];
  check("v1 master beats 720p", pickRecordingSql(v1Ladder)?.path, "master.m3u8");
  check("v1 master order-independent", pickRecordingSql([...v1Ladder].reverse())?.path, "master.m3u8");
  check("v1 master beats 1080p", pickRecordingSql([{ quality: "1080p", path: "v1080.m3u8" }, { quality: "auto", path: "m.m3u8" }])?.path, "m.m3u8");
  check("AUTO is case-insensitive", pickRecordingSql([{ quality: "AUTO", path: "m.m3u8" }, { quality: "720p", path: "v720.m3u8" }])?.path, "m.m3u8");
  check("empty-path master falls through", pickRecordingSql([{ quality: "auto", path: "" }, { quality: "720p", path: "v720.m3u8" }])?.path, "v720.m3u8");
  check("empty list → null", pickRecordingSql([]), null);
  check("undefined → null", pickRecordingSql(undefined as any), null);
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. v1 payload parsing. Two shapes here were WRONG on first implementation and
//    would have shipped silently: renditions sit at the asset ROOT (not inside
//    `video`), and quality labels arrive as "P480" rather than "480p".
// ─────────────────────────────────────────────────────────────────────────────
g("v1 parsing");
{
  const { normalizeQualityLabel, toAsset } = v1parse;

  // Label normalisation. Everything downstream — the promotion picker's
  // preference list, the app's quality menu — matches on "<height>p".
  check('"P480" → "480p"', normalizeQualityLabel("P480"), "480p");
  check('"P1080" → "1080p"', normalizeQualityLabel("P1080"), "1080p");
  check('"480p" passes through', normalizeQualityLabel("480p"), "480p");
  check('"720" → "720p"', normalizeQualityLabel("720"), "720p");
  check('"auto" preserved', normalizeQualityLabel("auto"), "auto");
  check("empty → empty", normalizeQualityLabel(""), "");
  check("null → empty", normalizeQualityLabel(null), "");

  // Renditions at the asset ROOT — the documented shape.
  const rootShape = toAsset({
    public_id: "A1", status: "COMPLETED", kind: "LIVESTREAM_RECORDING",
    duration_seconds: 234, size_bytes: "5913969",
    video: { hls_manifest_url: "https://x/master.m3u8", drm_content_id: null },
    renditions: [{ quality: "P480", url: "https://x/480.m3u8" }, { quality: "P720", url: "https://x/720.m3u8" }],
  });
  check("root renditions parsed", rootShape.renditions.length, 2);
  check("root rendition labels normalised", rootShape.renditions.map((r) => r.quality), ["480p", "720p"]);
  check("hls manifest read from video{}", rootShape.hlsManifestUrl, "https://x/master.m3u8");
  check("size_bytes string coerced to number", rootShape.sizeBytes, 5913969);

  // Defensive fallback: if they ever nest renditions under `video`, still parse.
  const nested = toAsset({
    public_id: "A2", status: "COMPLETED",
    video: { hls_manifest_url: "https://x/m.m3u8", renditions: [{ quality: "P360", url: "https://x/360.m3u8" }] },
  });
  check("nested renditions still parsed", nested.renditions.map((r) => r.quality), ["360p"]);

  // A rendition with no playable URL must not reach the player.
  const noUrl = toAsset({ public_id: "A3", renditions: [{ quality: "P480" }, { quality: "P720", url: "https://x/720.m3u8" }] });
  check("URL-less rendition dropped", noUrl.renditions.length, 1);

  check("missing renditions → []", toAsset({ public_id: "A4" }).renditions, []);
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. THE REAL PAYLOAD. Captured from StreamOS on 2026-09-03 — the first genuine
//    VIDEO_TRANSCODING_COMPLETED we have seen. Everything before this was built
//    from documentation, and the docs got two things wrong, so this exact shape
//    is pinned here as the regression baseline.
// ─────────────────────────────────────────────────────────────────────────────
g("real payload 2026-09-03");
{
  const REAL = {
    event: "VIDEO_TRANSCODING_COMPLETED",
    created_at: "2026-09-03T07:12:57.485Z",
    data: {
      error: null,
      video: {
        id: "nqv14b9Wo2t", drm: true, url: null, kind: "LIVESTREAM_RECORDING",
        title: "stream test with garvit", status: "COMPLETED",
        created_at: "2026-09-03T07:09:28.741Z", size_bytes: "1488978",
        summary_url: null, download_url: null, thumbnail_url: null,
        drm_content_id: "c033b5c61d98", transcript_url: null,
        download_quality: null, duration_seconds: 116, download_size_bytes: null,
      },
      stream: { id: "Hzia0D5XEE2", stream_key: "EXSO_17884189103817" },
      storage: { drm_bytes: "1488978", total_bytes: "1488978" },
      renditions: [
        { url: "https://…/drm-d10cbb/480p/stream.mpd", quality: "480p" },
        { url: "https://…/drm-d10cbb/360p/stream.mpd", quality: "360p" },
        { url: "https://…/drm-d10cbb/240p/stream.mpd", quality: "240p" },
      ],
    },
  };

  // Correlation — the question this whole integration hung on.
  check("asset id extracted", assetIdFromBody(REAL.data), "nqv14b9Wo2t");
  check("stream.stream_key present", REAL.data.stream.stream_key, "EXSO_17884189103817");
  check("stream.id present", REAL.data.stream.id, "Hzia0D5XEE2");

  // No wsEnv tag on this delivery → must be treated as OURS, not dropped.
  check("untagged real delivery is not foreign", isForeignEnvironment(REAL), false);

  // Docs said quality labels look like "P480". The real payload says "480p".
  // normalizeQualityLabel tolerates both — which is why the doc error was harmless.
  check("real labels already <height>p",
    REAL.data.renditions.map((r) => v1parse.normalizeQualityLabel(r.quality)), ["480p", "360p", "240p"]);

  // renditions is a SIBLING of video under data — not nested inside it.
  check("renditions sits beside video, not inside", "renditions" in (REAL.data.video as any), false);

  // ⚠ THE FINDING: this recording is DRM → DASH → unplayable (no licence server).
  check("video.drm is true", REAL.data.video.drm, true);
  check("no HLS manifest on a DRM asset", REAL.data.video.url, null);
  check("every rendition is .mpd (DASH)", REAL.data.renditions.every((r) => r.url.endsWith(".mpd")), true);
  check("no download URL even here", REAL.data.video.download_url, null);
}

// ─────────────────────────────────────────────────────────────────────────────

if (failures.length) {
  console.error(`\n✗ ${failures.length} FAILED\n`);
  for (const f of failures) console.error(`  ${f}\n`);
  console.error(`${pass} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`✓ ${pass} passed, 0 failed`);

// Importing the service layer pulls in Prisma and Redis, whose open handles keep
// the event loop alive even though this script never queries either. Exit
// explicitly rather than hanging after the results are printed.
process.exit(0);
