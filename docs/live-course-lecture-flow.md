# Recorded Lecture — End-to-End Flow

The complete pipeline for any recorded video — whether it lives inside a live course or a recorded course. **One unified contract across two endpoint families.** Backend + frontend both work from this doc.

> The `/api/v1/client/yt-proxy` endpoint has been removed. Any URL the FE consumes that still points there is either a stale cached response or a leftover from an older client build. Restart the app, clear caches, re-fetch.

---

## 1. Big picture

```
┌─────────────────────┐
│ ADMIN PANEL         │
│ uploads a video     │
│ with youtube_id OR  │
│ aws_id              │
└──────────┬──────────┘
           │ PUT /api/v1/admin/videos/:id
           ▼
┌─────────────────────────────────────────────────────────────┐
│ Video document (MongoDB)                                    │
│   { platform, youtube_id?, aws_id?, vimeo_id?, ... }        │
│ Raw IDs only. No transcoding yet.                           │
└──────────┬──────────────────────────────────────────────────┘
           │
           │ (later, when a client opens the lecture)
           ▼
┌─────────────────────────────────────────────────────────────┐
│ Client app taps a lecture row in the recordings list        │
└──────────┬──────────────────────────────────────────────────┘
           │ GET /api/v1/client/live-courses/:id/recordings
           │   → metadata only (no playable URLs)
           │
           │ GET /api/v1/client/live-courses/:id/lecture/:videoId
           ▼
┌─────────────────────────────────────────────────────────────┐
│ BACKEND                                                     │
│ 1. Entitlement check (subscribed OR priceType=free)         │
│ 2. resolveVideoSource(video)                                │
│      youtube → @distube/ytdl-core → muxed formats           │
│      aws     → POST VideoCrypt → HLS master + MP4 per qty   │
│      (cached in Redis: youtube 4h, aws 24h)                 │
│ 3. encryptLecture() — AES-128-CBC every URL with one token  │
└──────────┬──────────────────────────────────────────────────┘
           │ Response: { data: { files: { token, hls, progressive } } }
           ▼
┌─────────────────────────────────────────────────────────────┐
│ FRONTEND                                                    │
│ 1. Read data.files.token                                    │
│ 2. Decrypt every URL field (hls.cdns.primary.url +          │
│    every progressive[i].url) with the SAME token            │
│ 3. Pick a URL (HLS for adaptive, or a specific quality)     │
│ 4. <Video source={{ uri: decryptedUrl }} />                 │
└─────────────────────────────────────────────────────────────┘
```

## Endpoint families

There are **two pairs** of endpoints, one per content area. Both pairs follow the same pattern: a list (metadata only) and a detail (resolved + encrypted envelope).

| Content area | List endpoint (metadata) | Detail endpoint (encrypted envelope) |
|---|---|---|
| **Live course recorded lectures** | `GET /api/v1/client/live-courses/:id/recordings` | `GET /api/v1/client/live-courses/:id/lecture/:videoId` |
| **Recorded videos by category** | `GET /api/v1/client/video-categories/:id/videos` | `GET /api/v1/client/video-categories/:id/videos/:videoId` |

Both detail endpoints return the **same** `{ files: { token, hls, progressive } }` envelope. One decryption helper covers both flows.

> Anything that used to mint `/api/v1/client/yt-proxy?t=...` URLs has been removed. If the FE is still seeing those, it's a stale cache.

---

## 2. Step 1 — Admin uploads

### Endpoint
```
PUT /api/v1/admin/videos/:id
Authorization: Bearer <admin jwt>
Content-Type: application/json
```

### Body (one of)
```jsonc
// YouTube
{
  "name": "Day 03 લેક્ચર",
  "slug": "day-03-lecture",
  "order": 0,
  "topic": "",
  "type": "free",
  "videoCategoryId": "69e8ba2fa323f50f4fc0e29a",
  "status": true,
  "youtube": true,
  "vimeo": false,
  "aws": false,
  "youtubeId": "dQw4w9WgXcQ",        // ← 11-char YouTube id
  "vimeoId": null,
  "awsId": null
}

// AWS / VideoCrypt
{
  "name": "Day 03 લેક્ચર",
  "slug": "day-03-lecture",
  "order": 0,
  "topic": "",
  "type": "free",
  "videoCategoryId": "69e8ba2fa323f50f4fc0e29a",
  "status": true,
  "youtube": false,
  "vimeo": false,
  "aws": true,
  "youtubeId": null,
  "vimeoId": null,
  "awsId": "4761198_0_8508120003393929"   // ← VideoCrypt internal id
}
```

### What's stored
A Mongo `Video` document carrying the raw id under the matching field (`youtube_id` / `aws_id` / `vimeo_id`) and `platform: "youtube" | "aws" | "vimeo"`. **No transcoding happens at upload time.** The transcode is deferred to the first client request and cached in Redis.

---

## 3. Step 2 — Client list (metadata only)

### Endpoint
```
GET /api/v1/client/live-courses/:id/recordings
Authorization: Bearer <customer jwt>
```

### Response (200)
```jsonc
{
  "success": true,
  "data": {
    "liveCourse": { "_id": "...", "name": "...", "image": "..." },
    "subscribed": true,
    "totalLectures": 42,
    "folders": [
      {
        "folderId": "...",
        "title": "Day 03",
        "image": "...",
        "order": 0,
        "lectures": [
          {
            "_id": "6a05a8d8c818602bfbbe0ef5",
            "title": "Day 03 લેક્ચર",
            "topic": "",
            "platform": "youtube",        // "youtube" | "aws" | "vimeo"
            "priceType": "free",          // "free" | "paid"
            "order": 0,
            "locked": false               // true → paid + not subscribed
            // NO videoUrl, NO youtube_id, NO aws_id, NO files block.
          }
        ]
      }
    ],
    "purchaseOptions": []                  // populated when !subscribed
  },
  "message": "Recorded lectures fetched."
}
```

### What the FE does with this
- Render the folder/lecture tree.
- Show "locked" lectures with a buy CTA (use `purchaseOptions`).
- On row tap → call the **detail** endpoint (Step 3).

**Do not** try to play from this response. Playable URLs are intentionally omitted — resolving N lectures upfront would cost N upstream calls per page load.

---

## 4. Step 3 — Client detail (resolved + encrypted URLs)

Pick the endpoint that matches the content area. Both return the SAME envelope.

### Endpoint — live course lecture
```
GET /api/v1/client/live-courses/:id/lecture/:videoId
Authorization: Bearer <customer jwt>
```

### Endpoint — recorded video by category
```
GET /api/v1/client/video-categories/:id/videos/:videoId
Authorization: Bearer <customer jwt>
```

### Response (200) — identical for both endpoints

### Response (200)
```jsonc
{
  "success": true,
  "code": 200,
  "data": {
    "_id": "6a05a8d8c818602bfbbe0ef5",
    "title": "Day 03 લેક્ચર",
    "topic": "",
    "platform": "youtube",
    "priceType": "free",
    "files": {
      "token": "3833730014538127",        // 16-digit numeric STRING — shared across all URLs below
      "hls": {
        "default_cdn": "primary",
        "cdns": {
          "primary": {
            "url": "<AES-encrypted .m3u8 URL>",   // "" when no HLS master (YouTube path)
            "allow720": false                    // FE quality-menu hint (AWS-driven)
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
  "message": "Lecture fetched.",
  "messages": {}
}
```

### Errors

| Code | Body | Meaning | FE action |
|---|---|---|---|
| 403 | `{ message: "Subscribe to this live course...", purchaseOptions: [...] }` | Paid lecture, no subscription. | Open buy popup. |
| 404 | `{ message: "Lecture not found." }` / `{ message: "Video not found in this category." }` | Video missing/disabled. | Empty state. |
| 404 | `{ message: "Lecture does not belong to this live course." }` | Cross-course videoId. | Empty state. |
| 422 | `{ message: "Invalid live course or video id." }` / `{ message: "Invalid category or video id." }` | Bad ObjectId. | Should not happen. |
| 502 | `{ message: "Failed to resolve playable URLs for this <lecture|video>." }` | ytdl-core / VideoCrypt failed. | "Try again later" + retry button. |

### What's in `files`

| Field | Type | Meaning |
|---|---|---|
| `files.token` | string | 16-digit numeric. Single use. Don't cache. |
| `files.hls.cdns.primary.url` | string | AES-encrypted `.m3u8` master URL. `""` when not available. |
| `files.hls.cdns.primary.allow720` | boolean | When `false`, FE quality menu must hide 720p even if present in `progressive[]`. |
| `files.progressive[]` | array | One entry per available quality, sorted **highest → lowest**. |
| `files.progressive[].qualityLabel` | string | e.g. `"1080p"`. Use this in the menu. |
| `files.progressive[].height` | number | e.g. `1080`. Use for filtering / sorting if needed. |
| `files.progressive[].url` | string | AES-encrypted direct playable URL (HLS variant or MP4). |

---

## 5. Step 4 — Decrypt

The same AES-128-CBC scheme as `/v1/lecture`. The token is **shared** across all URLs in the response — derive key/iv ONCE, reuse.

### Algorithm
- Two fixed 16-char alphabets:
  - `KEY_ALPHABET    = "!*@#)($^%1fgv&C3"`
  - `IV_ALPHABET     = "?\\:><{}@#Vjekl44"` *(double-backslash in JS source)*
- For each digit `d` in `token`: `key += KEY_ALPHABET[d]`, `iv += IV_ALPHABET[d]`.
- Both end up 16 bytes. AES-128-CBC + PKCS7 + base64.

### Helper (lives in `src/helpers/videoDecrypt.ts`)

```ts
import CryptoJS from 'crypto-js';

const KEY_ALPHABET = '!*@#)($^%1fgv&C3';
const IV_ALPHABET  = '?\\:><{}@#Vjekl44';   // ⚠️ DOUBLE backslash

export const decryptLiveLectureSource = (
  token?: string,
  encryptedValue?: string,
): string | undefined => {
  if (!token || !encryptedValue) return undefined;
  try {
    let key = '', iv = '';
    for (const d of token) {
      key += KEY_ALPHABET.charAt(Number(d));
      iv  += IV_ALPHABET.charAt(Number(d));
    }
    const cipherParams = CryptoJS.lib.CipherParams.create({
      ciphertext: CryptoJS.enc.Base64.parse(encryptedValue),
    });
    const decrypted = CryptoJS.AES.decrypt(
      cipherParams,
      CryptoJS.enc.Utf8.parse(key),
      { iv: CryptoJS.enc.Utf8.parse(iv) },
    );
    return decrypted.toString(CryptoJS.enc.Utf8).trim() || undefined;
  } catch (e) {
    console.warn('Unable to decrypt live lecture source', e);
    return undefined;
  }
};
```

### Decrypt the whole envelope

```ts
function decryptEnvelope(files: any) {
  const { token } = files || {};
  if (typeof token !== 'string') return null;

  const hlsUrl = decryptLiveLectureSource(token, files?.hls?.cdns?.primary?.url);

  const progressive = (files.progressive ?? [])
    .map((p: any) => ({
      qualityLabel: p.qualityLabel,
      height:       p.height,
      url:          decryptLiveLectureSource(token, p.url),
    }))
    .filter((p: any) => p.url);

  return {
    hlsUrl,
    progressive,
    allow720: files?.hls?.cdns?.primary?.allow720 ?? true,
  };
}
```

### What the decrypted URLs look like

| Platform | `hlsUrl` example | `progressive[].url` example |
|---|---|---|
| `youtube` | `https://rr3---sn-...googlevideo.com/...` (same as best progressive) | `https://rr3---sn-...googlevideo.com/...` (per quality) |
| `aws` | `https://dcga6fn5s6xlr.cloudfront.net/mnt/hls/<id>.m3u8` | `https://.../1080p.mp4` etc. |
| `vimeo` | `null` / empty | The raw Vimeo id (passthrough) |

> The decrypted strings are **direct CDN URLs** — playable as-is. No `Authorization` header. No proxy. **If a decrypted value points at `/api/v1/client/yt-proxy?t=...`, you're either reading a stale cached response or hitting the wrong endpoint.**

---

## 6. Step 5 — Play

### Pick a URL
```ts
const env = decryptEnvelope(response.data.files);

// Prefer HLS (adaptive bitrate); fall back to the highest progressive.
const defaultUrl = env?.hlsUrl || env?.progressive?.[0]?.url;
```

### Hand to `<Video>`
```tsx
<Video
  source={{ uri: defaultUrl }}
  // NO source.headers. The URL is the CDN, not our proxy.
/>
```

### Quality picker
```ts
const options = [
  ...(env.hlsUrl ? [{ label: 'Auto', url: env.hlsUrl }] : []),
  ...env.progressive
    .filter(p => env.allow720 || p.height !== 720)
    .map(p => ({ label: p.qualityLabel, url: p.url })),
];

// On user pick → setVideoUrl(option.url), <Video> re-mounts with the new URL.
```

### Full call-site (drop into `LiveVideoScreen.tsx`)

```ts
import { decryptLiveLectureSource } from '../../helpers/videoDecrypt';

} else if (lectureId && liveCourseIdParam) {
  try {
    const res: any = await getLiveLectureAPI(liveCourseIdParam, lectureId);
    const data = res?.data?.data ?? {};
    if (cancelled) return;

    setSessionTitleApi(data.title ?? null);
    setSessionCourseName(
      data?.liveCourse?.name ?? data?.liveCourses?.[0]?.name ?? null,
    );
    setAccessLevel('full');

    const files = data?.files;
    const token = files?.token;

    const hlsUrl = decryptLiveLectureSource(token, files?.hls?.cdns?.primary?.url);
    const allow720 = files?.hls?.cdns?.primary?.allow720 ?? true;
    const progressive = (files?.progressive ?? [])
      .map((p: any) => ({
        qualityLabel: p.qualityLabel,
        height:       p.height,
        url:          decryptLiveLectureSource(token, p.url),
      }))
      .filter((p: any) => p.url);

    const defaultUrl = hlsUrl || progressive[0]?.url;

    if (!defaultUrl) {
      console.warn('[LiveVideoScreen] no playable URL after decrypt', { id: data._id });
    }

    setQualities(progressive);
    setAllow720(allow720);
    setVideoUrl(defaultUrl);
  } catch (err: any) {
    if (cancelled) return;
    const body = err?.data ?? err;
    if (body?.purchaseOptions) handlePurchaseFromError(body);
  }
}
```

---

## 7. Backend reference — what runs server-side

### Files involved
- `src/client/live-course/live-course.controller.ts` — `getLiveCourseLecture`, `listLiveCourseRecordings`, `encryptLecture(video)`.
- `src/client/categories/categories.controller.ts` — `getVideoByCategory`, `listVideosByCategory`, `encryptVideoEnvelope(video)`.
- `src/utils/videoResolver.ts` — `resolveVideoSource(video)` (per-platform transcoder + Redis cache). **Shared by both controllers.**
- `src/utils/videoEncryption.ts` — `generateToken`, `generateKey`, `generateVector`, `encrypt`.

### Removed (do not reintroduce)
- `src/client/categories/yt-proxy.controller.ts` — deleted.
- `GET /api/v1/client/yt-proxy` route — removed from `client.routes.ts`.
- `youtubei.js` dependency — uninstalled. Use `@distube/ytdl-core` going forward.

### Resolver behavior

| Platform | Source | Library | TTL | Output |
|---|---|---|---|---|
| `youtube` | `youtube_id` | `@distube/ytdl-core` `getInfo()` | 4h | Muxed formats only. `hlsUrl = progressive[0].url`. |
| `aws` | `aws_id` | `axios.post(VIDEOCRYPT_URL, { id })` | 24h | Real HLS master + per-quality MP4. 720p filtered when `VIDEOCRYPT_ALLOW_720=false`. |
| `vimeo` | `vimeo_id` | (passthrough) | — | `progressive[0].url = vimeo_id`. |

Cache key: `video-resolve:<platform>:<id>`. Bust manually with `redis-cli DEL <key>` after re-encoding.

### Required `.env`
```
VIDEOCRYPT_URL=https://api.videocrypt.com/getVideoDetails
VIDEOCRYPT_ACCESS_KEY=<real key>
VIDEOCRYPT_SECRET_KEY=<real secret>
VIDEOCRYPT_ALLOW_720=false
```

Without these, AWS-platform lectures return 502.

---

## 8. Common failure modes

### "Video playback failed — Response code: 403" (Android) / "Cannot Open — media format not supported" (iOS)

The player is trying to hit a URL that responded with JSON / HTML instead of video bytes.

**Check the URL string the player attempted.** If it contains:
- **`/api/v1/client/yt-proxy?t=...`** → **stale data on the client.** The yt-proxy endpoint and the code that minted these URLs have been removed from the server. There is no longer a way for the server to return one. If the FE is still using such a URL, it's reading from cache/storage/state populated by an older build. **Fix:** clear caches (AsyncStorage / Redux persist / RTK Query cache / app storage), restart the app, and re-fetch.
- **`/stream/...m3u8`** → another removed proxy URL from an earlier iteration. Same fix: clear caches, re-fetch.
- **A direct `https://` CDN URL** that still 403s → upstream signed URL expired. The resolver caches Redis-side; bust the cache with `redis-cli DEL video-resolve:<platform>:<id>` and re-fetch.

### "Failed to resolve playable URLs for this lecture." (502)

Backend resolver threw. Check server logs for `Resolve/encrypt lecture failed`. Typical causes:
- VideoCrypt credentials missing/wrong (`VIDEOCRYPT_ACCESS_KEY`, `VIDEOCRYPT_SECRET_KEY` blank).
- ytdl-core broke against a YouTube anti-bot update — pin to last known-good, or pass cookies via `requestOptions.cookies`.
- Network egress blocked to YouTube or VideoCrypt from your host.

### Decrypt returns empty string

- IV alphabet has 15 chars instead of 16 → backslash escaping bug. Source must be `"?\\:><{}@#Vjekl44"` (double `\`).
- Token used as a number instead of a string → leading zero dropped → wrong key/iv.
- Missing `enc.Utf8.parse` around key/iv → CryptoJS runs passphrase mode → garbage.
- Missing `CipherParams.create({ ciphertext: enc.Base64.parse(ct) })` around the ciphertext → wrong input shape.

### "Lecture fetched" but `data.files` is missing

You're hitting an old build of the server. Restart `npm run dev`. The new shape is `data.files.{token,hls,progressive}` — NOT `data.{token,videoURL}` (that was the previous iteration).

---

## 9. Quick decision table

| Symptom | Where to look |
|---|---|
| Decrypted URL starts with `/api/v1/client/yt-proxy` | FE is on the wrong endpoint (Section 4 + 8) |
| Decrypted URL is empty `""` for hls only | YouTube path doesn't expose HLS — fall back to `progressive[0]` |
| Decrypted URL is empty `""` for everything | Token/IV/key derivation bug — Section 8 |
| 502 from the lecture endpoint | Backend resolver failure — Section 8 |
| 403 from the lecture endpoint | Entitlement — open buy popup with `purchaseOptions` |
| 200 but `files` field absent | Old server build — restart |

---

## 10. End-to-end smoke test

### Server side
```bash
curl -X GET \
  "http://localhost:4001/api/v1/client/live-courses/<liveCourseId>/lecture/<videoId>" \
  -H "Authorization: Bearer <customer jwt>" | jq .
```

Expect: `data.files.token` (16-digit string), `data.files.hls.cdns.primary.url` (long base64), `data.files.progressive[]` with at least one entry.

### Client side
Paste in browser console with CryptoJS loaded:
```js
const KEY = '!*@#)($^%1fgv&C3';
const IV  = '?\\:><{}@#Vjekl44';

const token = '<files.token from response>';
const ct    = '<any files.*.url from response>';

let key = '', iv = '';
for (const c of token) { key += KEY.charAt(Number(c)); iv += IV.charAt(Number(c)); }
console.log('lengths', key.length, iv.length);   // 16 16

console.log(CryptoJS.AES.decrypt(
  CryptoJS.lib.CipherParams.create({ ciphertext: CryptoJS.enc.Base64.parse(ct) }),
  CryptoJS.enc.Utf8.parse(key),
  { iv: CryptoJS.enc.Utf8.parse(iv) }
).toString(CryptoJS.enc.Utf8));
// → should print a direct https://... URL
```

---

## TL;DR

1. Admin uploads → only stores `youtube_id` / `aws_id`. **No transcoding.**
2. List endpoint (`/recordings`) → metadata only, no URLs.
3. Detail endpoint (`/lecture/:videoId`) → server resolves via ytdl-core / VideoCrypt → returns `{ files: { token, hls, progressive[] } }` with every URL AES-encrypted.
4. FE decrypts once per URL using a shared `token`, picks one URL, plays it directly. No proxy. No auth header.
5. If the FE ever sees `/yt-proxy` or `/stream/...m3u8` in the decrypted output — wrong endpoint or stale cache.
