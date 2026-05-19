# Live Course Lecture — Backend Changes

What the server now does when a client opens a recorded lecture from a live course, and how to operate / extend it.

## The flow

```
Admin PUT /admin/videos/:id
   { platform: "youtube" | "aws", youtube_id | aws_id }
                ↓
            (stored on the Video doc, no upstream call)

Client GET /api/v1/client/live-courses/:id/lecture/:videoId
                ↓
  entitlement gate (subscribed OR priceType=free)
                ↓
  resolveVideoSource(video) — per-platform transcoder, cached in Redis
                ↓
    platform === "youtube" → @distube/ytdl-core → muxed formats
    platform === "aws"     → POST VideoCrypt /getVideoDetails → HLS + per-quality MP4
                ↓
  encryptLecture(resolved) — AES-128-CBC every URL with a fresh token
                ↓
  { files: { token, hls: {...}, progressive: [...] } }
```

The list endpoint (`GET .../recordings`) intentionally **does not** resolve URLs — that would mean N upstream calls per page load. The list is metadata-only; the FE calls the detail endpoint when a row is tapped.

---

## What changed

### New files
- **`src/utils/videoResolver.ts`** — platform-routing transcoder with Redis cache.
- **`docs/backend/live-course-lecture-resolver.md`** — this file.
- **`docs/client/live-course-lecture.md`** — frontend integration guide.

### Modified files
- **`src/client/live-course/live-course.controller.ts`**
  - `encryptLecture(video)` replaces `encryptVideoSource(video)`. Returns the multi-resolution envelope (HLS + progressive[]) instead of a single `{token, videoURL}` pair.
  - `getLiveCourseLecture` now spreads the envelope into its response. 502 if the resolver throws (upstream failure).
  - `listLiveCourseRecordings` no longer emits `videoUrl` / `youtube_id` / `aws_id` / `vimeo_id` on list rows. They were never useful without resolution and just leaked raw ids.

### Dependencies
- **Added:** `@distube/ytdl-core` (active fork of `ytdl-core` — the original is unmaintained and breaks on YouTube changes).
- **Kept:** `youtubei.js` (still used by `/yt-proxy` and `/video-categories/:id/videos`; migrating those is a separate task).

### `.env`
```
VIDEOCRYPT_URL=https://api.videocrypt.com/getVideoDetails
VIDEOCRYPT_ACCESS_KEY=
VIDEOCRYPT_SECRET_KEY=
VIDEOCRYPT_ALLOW_720=false
```

⚠️ The keys are blank by default. Fill them in for any environment that needs to play AWS-stored lectures. Without them the resolver throws and the lecture endpoint returns 502.

---

## The resolver

`resolveVideoSource(video)` returns:

```ts
interface ResolvedSource {
  hlsUrl: string | null;          // null on the YouTube path — no real master
  progressive: ResolvedQuality[]; // sorted high→low
  allow720: boolean;              // hint for the FE quality menu (AWS toggle)
}

interface ResolvedQuality {
  qualityLabel: string; // "1080p" | "720p" | "480p" | ...
  quality: string;
  height: number;
  url: string;          // raw, ready-to-play URL
}
```

### YouTube path
- Calls `ytdl.getInfo(youtube_id)`.
- Keeps only muxed formats (`hasAudio && hasVideo`). DASH/adaptive are dropped — single-URL playback only.
- Sorted high→low so `progressive[0]` is the best quality.
- `hlsUrl` is set to `progressive[0]?.url` as a "default playback" stand-in (YouTube doesn't expose a true HLS master).

### AWS path
- POSTs to `VIDEOCRYPT_URL` with `{ id: aws_id }` and `accessKey` / `secretKey` headers.
- Reads `data.file_url_hls` (master playlist) + `data.download_url[]` (`{title, url}` per quality).
- When `VIDEOCRYPT_ALLOW_720=false`, drops 720p entries and sets `allow720: false` on the response.
- Throws when VideoCrypt returns `result: -1` or no `data`.

### Vimeo path
- Passthrough. `progressive[0].url = vimeo_id`. FE plays via Vimeo SDK / iframe.

### Caching
Redis, with per-platform TTL:

| Platform | TTL | Why |
|---|---|---|
| YouTube | 4 hours | YouTube's progressive URLs expire ~6h, so 4h is safely under that. |
| AWS | 24 hours | VideoCrypt URLs are signed for ~24h. |
| Vimeo | (no upstream call) | — |

Cache key: `video-resolve:<platform>:<id>`. Cache misses on read are non-fatal (logged, fall through to resolve).

To **bust the cache** for one video (e.g. after a re-encode):
```
redis-cli DEL video-resolve:aws:4761198_0_8508120003393929
```

---

## Response shape — `GET /lecture/:videoId`

```jsonc
{
  "success": true,
  "data": {
    "_id": "...",
    "title": "...",
    "topic": "...",
    "platform": "youtube" | "aws" | "vimeo",
    "priceType": "free" | "paid",
    "files": {
      "token": "1234567890123456",           // 16-digit numeric string
      "hls": {
        "default_cdn": "primary",
        "cdns": {
          "primary": {
            "url": "<AES-encrypted .m3u8 URL>",   // "" if no HLS available
            "allow720": false                    // FE quality-menu hint
          }
        }
      },
      "progressive": [
        {
          "qualityLabel": "1080p",
          "quality":      "1080p",
          "height":       1080,
          "url":          "<AES-encrypted mp4 URL>"
        },
        { "qualityLabel": "480p", "quality": "480p", "height": 480, "url": "..." },
        { "qualityLabel": "360p", "quality": "360p", "height": 360, "url": "..." }
      ]
    }
  },
  "message": "Lecture fetched."
}
```

Encryption uses the same AES-128-CBC helpers as `/v1/lecture` ([src/utils/videoEncryption.ts](../../src/utils/videoEncryption.ts)). The FE decrypt path is unchanged — just applied per URL field.

### Status codes
| Code | When |
|---|---|
| 200 | OK — envelope returned |
| 403 | Paid lecture, no subscription. Body carries `purchaseOptions`. |
| 404 | Lecture not found or not in this course |
| 422 | Invalid ObjectId |
| 502 | Resolver failed (upstream VideoCrypt / ytdl-core error). Check server logs. |

---

## Operational notes

### YouTube reliability
`@distube/ytdl-core` is the most reliable open-source option, but YouTube actively breaks scraping. When ytdl breaks platform-wide:
- Pin to the last known-good version.
- Check the package's GitHub issues for the workaround.
- A 502 on the lecture endpoint with `error: "Sign in to confirm you're not a bot"` (or similar) in logs is the canonical "ytdl broke" signal.

If your `.env` has `YT_COOKIES_PATH` set (it does in this repo), the resolver does NOT currently pass cookies — ytdl-core's `getInfo` supports a `requestOptions.cookies` option if needed. Add it inside `resolveYoutube` if you start hitting bot-protection.

### VideoCrypt creds
Currently blank in `.env`. Until they're set, any AWS-platform lecture returns 502. To verify VideoCrypt independently:
```bash
curl -X POST $VIDEOCRYPT_URL \
  -H "accessKey: $VIDEOCRYPT_ACCESS_KEY" \
  -H "secretKey: $VIDEOCRYPT_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"id":"4761198_0_8508120003393929"}'
```

### Logs
- `Resolve/encrypt lecture failed` — upstream failure. Look at the `error` field.
- `videoResolver cache read failed` / `cache write failed` — Redis hiccup. Non-fatal; the resolver still works without the cache.

### Performance
- First viewer of a video pays the full upstream cost (1–3s for ytdl, ~500ms for VideoCrypt).
- Subsequent viewers in the TTL window get cache hits (~5ms).
- The TTL was chosen to stay under each provider's URL expiry — never bump it past 6h for YouTube without testing.

---

## Future cleanup

- **Stale `youtubei.js`** — once `categories.controller` and `yt-proxy.controller` are migrated to `@distube/ytdl-core` (or removed), drop `youtubei.js` from `package.json`.
- **Recordings list resolution** — if FE later wants playable URLs on the list page (e.g. to prefetch the next lecture), wire the same envelope into `shapeLecture`. Right now it returns metadata only by design.
- **Vimeo** — current path is a passthrough id. If/when actual Vimeo lectures land, add a real resolver.
