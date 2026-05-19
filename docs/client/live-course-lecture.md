# Live Course Lecture — Frontend Integration Guide (FINAL)

How to fetch and play a recorded lecture from a live course. The server resolves YouTube IDs via ytdl-core and AWS IDs via VideoCrypt, then ships back **multiple quality variants** with every URL AES-encrypted. You decrypt and play.

---

## Pipeline summary

```
1. Tap a lecture in the recordings list
       ↓
2. GET /api/v1/client/live-courses/:id/lecture/:videoId
   → { files: { token, hls, progressive[] } }
       ↓
3. For each URL field (hls.cdns.primary.url + every progressive[i].url):
       decryptLiveLectureSource(token, url) → raw playable URL
       ↓
4. Pick which URL to play (HLS for adaptive, or a specific progressive[i].url
   for a manual quality choice) and hand to the player.
```

The recordings list does **not** include playable URLs — only metadata. Don't expect them there.

---

## 1. Lecture endpoint

### Request
```
GET /api/v1/client/live-courses/:id/lecture/:videoId
Authorization: Bearer <jwt>
```

### Success (200)
```jsonc
{
  "success": true,
  "data": {
    "_id": "...",
    "title": "Day 03 લેક્ચર",
    "topic": "",
    "platform": "youtube" | "aws" | "vimeo",
    "priceType": "free" | "paid",
    "files": {
      "token": "3833730014538127",      // 16-digit numeric STRING (never a number)
      "hls": {
        "default_cdn": "primary",
        "cdns": {
          "primary": {
            "url": "<AES-encrypted .m3u8 URL>",   // "" when no real HLS master
            "allow720": false                    // FE quality-menu hint (AWS only)
          }
        }
      },
      "progressive": [
        { "qualityLabel": "1080p", "quality": "1080p", "height": 1080,
          "url": "<AES-encrypted mp4 URL>" },
        { "qualityLabel": "480p",  "quality": "480p",  "height":  480, "url": "..." },
        { "qualityLabel": "360p",  "quality": "360p",  "height":  360, "url": "..." }
      ]
    }
  },
  "message": "Lecture fetched."
}
```

### Errors
| Code | Meaning | What FE should do |
|---|---|---|
| 403 | Paid lecture, no subscription. Body has `purchaseOptions[]`. | Open the buy popup. |
| 404 | Lecture not found. | "Lecture missing" empty state. |
| 422 | Bad ObjectId. | Should not happen; log + back. |
| 502 | Server couldn't resolve playable URLs (ytdl-core / VideoCrypt failed). | "Playback temporarily unavailable" + retry button. |

---

## 2. Decrypt every URL

Same AES-128-CBC scheme as `/v1/lecture` — but you now apply it per URL field, not once. The token is **shared across all URLs** in the response.

### Helper (already in [`src/helpers/videoDecrypt.ts`](../../src/helpers/videoDecrypt.ts))

```ts
import CryptoJS from 'crypto-js';

const KEY_ALPHABET = '!*@#)($^%1fgv&C3';
const IV_ALPHABET  = '?\\:><{}@#Vjekl44';   // ⚠️ DOUBLE backslash in source

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
  const { token } = files;
  if (typeof token !== 'string') return null;

  const hlsUrl = decryptLiveLectureSource(token, files?.hls?.cdns?.primary?.url);

  const progressive = (files.progressive ?? [])
    .map((p: any) => ({
      qualityLabel: p.qualityLabel,
      height:       p.height,
      url:          decryptLiveLectureSource(token, p.url),
    }))
    .filter((p: any) => p.url);   // drop entries that failed to decrypt

  return {
    hlsUrl,
    progressive,
    allow720: files?.hls?.cdns?.primary?.allow720 ?? true,
  };
}
```

For your example response (token `3833730014538127`), each URL decrypts to a direct playable URL like:
```
https://unboxadmin.4tysixapplabs.com//uploads/videos/<uuid>/index.m3u8
https://.../1080p.mp4
https://.../480p.mp4
https://.../360p.mp4
```

These are **ready to play**. No proxy, no `Authorization` header needed on the video player.

---

## 3. Play the video

### 3.1 Default behavior — HLS first, progressive fallback

```ts
const decrypted = decryptEnvelope(data.files);

// Prefer the HLS master if present — it gives adaptive bitrate.
const defaultUrl = decrypted?.hlsUrl || decrypted?.progressive?.[0]?.url;

setVideoUrl(defaultUrl);
```

### 3.2 Quality picker (manual)

Build the menu off `decrypted.progressive`:

```ts
const qualityOptions = [
  { label: 'Auto', url: decrypted.hlsUrl },                       // adaptive
  ...decrypted.progressive
    // Hide 720p when the backend tells you to.
    .filter(p => decrypted.allow720 || p.height !== 720)
    .map(p => ({ label: p.qualityLabel, url: p.url })),
].filter(o => o.url);

// On selection:
function onQualityChange(option) {
  setVideoUrl(option.url);   // re-mount player with the new URL
}
```

### 3.3 React Native (`LiveCommonVideoPlayer`)

The existing `<Video>` mount works as-is — pass the decrypted URL through. **No `source.headers`**:

```tsx
<Video
  source={{ uri: videoUrl }}    // ← decrypted URL, raw
  // ...rest unchanged
/>
```

If you want to support live quality switching without remounting:
```tsx
<Video
  source={{ uri: selectedUrl, type: selectedUrl.endsWith('.m3u8') ? 'm3u8' : undefined }}
/>
```

### 3.4 Platform notes

- The decrypted **HLS URL** is consumable by `react-native-video` (iOS native AVPlayer, Android ExoPlayer).
- The decrypted **progressive URLs** are MP4 — playable by the same component.
- For `platform === 'youtube'`, the decrypted progressive URLs are **YouTube's own CDN URLs** (`*.googlevideo.com/...`), still played by `react-native-video`. You do **not** need `react-native-youtube-iframe` for this flow.

---

## 4. End-to-end call site

Replace the existing fetch+decrypt block in [LiveVideoScreen.tsx:424-464](../../src/screens/app/liveCourseMaterials/LiveVideoScreen.tsx#L424-L464):

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

    // Decrypt the envelope.
    const token = data?.files?.token;
    const hlsEnc = data?.files?.hls?.cdns?.primary?.url;
    const allow720 = data?.files?.hls?.cdns?.primary?.allow720 ?? true;
    const progressive = (data?.files?.progressive ?? []).map((p: any) => ({
      qualityLabel: p.qualityLabel,
      height:       p.height,
      url:          decryptLiveLectureSource(token, p.url),
    })).filter((p: any) => p.url);

    const hlsUrl = decryptLiveLectureSource(token, hlsEnc);
    const defaultUrl = hlsUrl || progressive[0]?.url;

    if (!defaultUrl) {
      console.warn('[LiveVideoScreen] no playable URL after decrypt', { id: data._id });
    }

    setQualities(progressive);   // power the quality menu
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

## 5. Recordings list — what NOT to expect

`GET /api/v1/client/live-courses/:id/recordings` is **metadata-only**:

```jsonc
{
  "data": {
    "liveCourse": { "_id": "...", "name": "...", "image": "..." },
    "subscribed": true,
    "totalLectures": 42,
    "folders": [
      {
        "folderId": "...",
        "title": "Day 03",
        "lectures": [
          {
            "_id": "...",
            "title": "...",
            "topic": "...",
            "platform": "aws",
            "priceType": "free",
            "order": 0,
            "locked": false
            // ⚠️ No videoUrl / no youtube_id / no aws_id / no files block.
          }
        ]
      }
    ]
  }
}
```

When the user taps a row, call `/lecture/:videoId` to get the playable envelope. Don't try to play directly from the list payload — the data isn't there.

---

## 6. Gotchas

### 6.1 Backslash in IV alphabet
The IV alphabet contains a literal `\` at index 1. In JS source you MUST write `"\\"`. Otherwise IV becomes 15 bytes and AES silently fails (`decrypt` returns `""`).

```js
const IV = '?\\:><{}@#Vjekl44';   // ✅ 16 chars
const IV = '?\:><{}@#Vjekl44';    // ❌ 15 chars
```

### 6.2 The token is shared across all URLs
You generate `key` / `iv` **once** from `files.token`, then reuse them to decrypt every URL in the envelope. Don't compute fresh key/iv per URL — you'll just waste cycles.

### 6.3 `progressive[]` is sorted high → low
`progressive[0]` is the highest available quality. For the quality menu, render the array order as-is.

### 6.4 `hls.cdns.primary.url` can be empty string
Means the resolver didn't produce a real HLS master (typical on the YouTube path). Fall back to `progressive[0].url`.

### 6.5 `allow720`
Server hint. When `false`, **hide** 720p in the quality menu even though it may exist in `progressive[]`. This is an AWS-specific cost/quality decision.

### 6.6 Token is a numeric STRING
`"3833730014538127"`. If anything coerces it to a number, a leading `0` digit would be dropped and key derivation goes wrong. Always treat as string.

### 6.7 Don't cache the envelope
Every fetch generates a fresh token + ciphertext. Don't store `files` in redux/persist — refetch when the user opens the lecture again.

---

## 7. Smoke test

Paste in Metro / browser console with CryptoJS loaded:

```js
const KEY = '!*@#)($^%1fgv&C3';
const IV  = '?\\:><{}@#Vjekl44';
const token = '<paste files.token>';
const ct    = '<paste any encrypted URL from the response>';

let key = '', iv = '';
for (const c of token) {
  key += KEY.charAt(Number(c));
  iv  += IV.charAt(Number(c));
}
console.log('lengths:', key.length, iv.length);   // both 16

const out = CryptoJS.AES.decrypt(
  CryptoJS.lib.CipherParams.create({ ciphertext: CryptoJS.enc.Base64.parse(ct) }),
  CryptoJS.enc.Utf8.parse(key),
  { iv: CryptoJS.enc.Utf8.parse(iv) },
).toString(CryptoJS.enc.Utf8);

console.log('decrypted:', out);   // should be an https://... URL
```

If the URL prints → decrypt path is fine. If empty → backslash bug or `Utf8.parse` missing.

---

## 8. Verification checklist

1. ☐ `import { decryptLiveLectureSource }` in `LiveVideoScreen.tsx`.
2. ☐ Reading `data.files.token` (not `data.token`).
3. ☐ Decrypting `data.files.hls.cdns.primary.url` for the HLS URL.
4. ☐ Mapping `data.files.progressive[]` through decrypt for the quality list.
5. ☐ Falling back to `progressive[0].url` when `hlsUrl` is empty.
6. ☐ No `Authorization` header on `<Video source>`.
7. ☐ Quality menu hides 720p when `allow720 === false`.
8. ☐ Smoke test prints a URL.
9. ☐ Network tab shows `<Video>` fetching the CDN directly (200).
10. ☐ Playback works.

---

## TL;DR

1. `data.files` carries `{ token, hls: {...}, progressive: [...] }`.
2. Use **one** key/iv derived from `files.token` to decrypt every URL in the envelope.
3. `hls.cdns.primary.url` → adaptive playback. `progressive[i].url` → specific quality.
4. Hand the URL straight to `<Video>`. No headers, no proxy.
5. Respect `allow720`.
