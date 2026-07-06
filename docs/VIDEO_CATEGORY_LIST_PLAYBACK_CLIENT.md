# Video Category — List Now Carries Playback URLs (Client Doc)

`GET /api/v1/client/video-categories/:id/videos` now returns the **encrypted
playback envelope** (`request.files` — HLS + progressive) on **every item in the
list**, identical to what the detail endpoint
(`/video-categories/:id/videos/:videoId`) already returns.

This means the app can **play and download** (HLS / progressive, per quality)
directly from the list — no per-row detail call needed.

---

## TL;DR

| | |
|---|---|
| **Endpoint** | `GET /api/v1/client/video-categories/:id/videos?page=1&limit=20` |
| **Auth** | **Required** — `Authorization: Bearer <accessToken>` |
| **Price filter** | `?type=free` → only free videos · `?type=paid` → only paid · omit → all |
| **Price field** | Each item exposes **`isPaid`** (boolean). `priceType` (string) is no longer returned |
| **New field** | Each `data.list[i]` now has a `request` object (or `null`) |
| **Shape** | `request.files = { token, hls, progressive }` — same as the detail API |
| **URLs** | **Encrypted** (same scheme as `/v1/lecture` / the detail endpoint) — decrypt with the per-item `token` exactly as you already do on the detail screen |

---

## 1. What changed

**Before:** each list item had `progress`, `recordings` (usually `[]` for
non-live videos), and `qualities` (labels + bitrate only — no URLs). To actually
play/download, the app had to call the detail endpoint per video.

**After:** each list item additionally has:

```jsonc
"request": {
  "files": {
    "token": "1337826029233001",
    "hls": {
      "default_cdn": "primary",
      "cdns": { "primary": { "url": "<encrypted>", "allow720": false } }
    },
    "progressive": [
      { "qualityLabel": "480p", "quality": "480p", "height": 480, "bitrate": 1200000, "hasAudio": true, "hasVideo": true, "url": "<encrypted>" },
      { "qualityLabel": "360p", "quality": "360p", "height": 360, "bitrate": 700000,  "hasAudio": true, "hasVideo": true, "url": "<encrypted>" },
      { "qualityLabel": "240p", "quality": "240p", "height": 240, "bitrate": 400000,  "hasAudio": true, "hasVideo": true, "url": "<encrypted>" }
    ]
  }
}
```

This is **byte-for-byte the same `request.files` block** the detail endpoint
returns — so whatever decrypt + player/download code you already use on the
video detail screen works unchanged on list items.

> `recordings` and `qualities` are unchanged and still present. `recordings` is
> still only non-empty for videos promoted from a live session. For playback/
> download, **use `request.files`** — it's populated for all resolvable videos
> (AWS, YouTube, Vimeo), not just live ones.

---

## 1b. Price filter & `isPaid` field

- **Filter:** pass `?type=free` to get only free videos, or `?type=paid` for
  only paid. Omit it to get all. Any other value is ignored (returns all).
  Combine freely with `page`/`limit`/`search`.
- **Field rename:** each list item now exposes a boolean **`isPaid`** instead of
  the old string `priceType`. `isPaid: true` = paid, `isPaid: false` = free.
  The raw `priceType` string is no longer in the response.

```
GET /api/v1/client/video-categories/:id/videos?type=free   → free videos only
GET /api/v1/client/video-categories/:id/videos?type=paid   → paid videos only
GET /api/v1/client/video-categories/:id/videos             → all videos
```

## 2. Full response example

`GET /api/v1/client/video-categories/6a1c1594dde3e6309cbc751d/videos?page=1&limit=20`

```jsonc
{
  "success": true,
  "data": {
    "category": { "_id": "6a1c1594dde3e6309cbc751d", "title": "January(2025)", "...": "..." },
    "scope": { "kind": "course", "id": "6a1d586590405a483d47e1e6" },
    "list": [
      {
        "_id": "6a19736359f7f485f583a6e1",
        "title": "Lecture 01 January (2025) Week 01",
        "platform": "aws",
        "isPaid": false,
        "aws_id": "4283735_0_4888283336440542",
        "progress": null,
        "recordings": [],
        "qualities": [
          { "qualityLabel": "720p", "bitrate": 2500000 },
          { "qualityLabel": "480p", "bitrate": 1200000 }
        ],
        "request": {
          "files": {
            "token": "…",
            "hls": { "default_cdn": "primary", "cdns": { "primary": { "url": "<encrypted>", "allow720": false } } },
            "progressive": [
              { "qualityLabel": "480p", "quality": "480p", "height": 480, "bitrate": 1200000, "hasAudio": true, "hasVideo": true, "url": "<encrypted>" }
            ]
          }
        }
      }
    ]
  },
  "pagination": { "total": 2, "page": 1, "limit": 20, "totalPages": 1 }
}
```

---

## 3. `request: null` — handle it

If a video's source can't be resolved at request time (upstream error, missing
id, etc.), that item's `request` is **`null`** instead of failing the whole
page. Treat `null` as "playback not available right now":

- Render the row, but disable play/download (or retry via the detail endpoint).
- Do **not** assume `request.files` always exists — null-check first.

The rest of the page still loads normally; only the unresolved item is degraded.

---

## 4. Decrypt + use (same as the detail screen)

Each item's `request.files` has its **own `token`**. The `hls.cdns.primary.url`
and every `progressive[i].url` are encrypted with a key/IV derived from that
item's token — exactly like the detail endpoint. Reuse your existing decrypt:

```ts
// Pseudocode — use the SAME decrypt you already use on the video detail screen.
function playableUrls(item: VideoListItem) {
  if (!item.request?.files) return null;            // request:null → not playable
  const { token, hls, progressive } = item.request.files;

  const hlsUrl = hls?.cdns?.primary?.url
    ? decrypt(hls.cdns.primary.url, token)          // your existing token→key/iv decrypt
    : null;

  const downloads = (progressive ?? [])
    .filter((p) => p.hasAudio && p.hasVideo)        // FE download flow requires both
    .map((p) => ({
      label: p.qualityLabel,                        // "480p"
      height: p.height,
      url: decrypt(p.url, token),
      // size estimate: bitrate (bits/s) × durationSec / 8 = bytes
      bitrate: p.bitrate,
    }));

  return { hlsUrl, allow720: hls?.cdns?.primary?.allow720 ?? true, downloads };
}
```

- **HLS** (`hls.cdns.primary.url`): use for streaming playback.
- **Progressive** (`progressive[]`): per-quality MP4s — use for the
  quality picker and **downloads**.
- **Download size**: there's no byte field; estimate as
  `bitrate × durationSec / 8` (durationSec comes from `progress.durationSec`
  once known, or the player after load), matching the existing FE behavior.
- **`allow720`**: when `false`, don't offer 720p even if it appears.

---

## 5. Performance note (so you can plan caching)

- The backend resolves all rows **in parallel** and caches resolved sources in
  Redis (**~4h** for YouTube, **~24h** for AWS). So the first load of a fresh
  category may be slightly slower; subsequent loads are fast.
- The encrypted `token`/`url` values **rotate per request** (fresh token each
  call) even though the underlying source is cached — so don't persist a
  decrypted URL across sessions; re-fetch the list (or detail) to get a fresh
  envelope. The signed source URLs themselves are valid for hours, but treat
  each list response's envelope as request-scoped.

---

## 6. Checklist for the app

- [ ] Send `Authorization: Bearer <accessToken>` (required).
- [ ] For each `data.list[i]`, read `request.files` for playback/download.
- [ ] **Null-check `request`** — it can be `null` for unresolved videos.
- [ ] Decrypt `hls.cdns.primary.url` and `progressive[i].url` using the item's
      own `token` (same decrypt as the detail screen).
- [ ] Use `progressive[]` (filtered to `hasAudio && hasVideo`) for the quality
      picker and downloads; estimate size via `bitrate × durationSec / 8`.
- [ ] Respect `allow720`.
- [ ] You can now skip the per-row detail call for playback — the detail
      endpoint still exists and returns the same `request.files` if you need it.
```
