# Video Playback — Backend Implementation Guide

## Goal

Given a `Video` document (YouTube or DigitalOcean Spaces / AWS S3), return a
unified JSON response that the React Native player can consume directly:
one `qualities[]` array per video, each entry a directly-playable URL.

No YouTube embed. No iframe. The RN player just hits a URL and plays bytes.

---

## Endpoint

```
GET /api/v1/client/video-categories/:id/videos
GET /api/v1/client/video-categories/:id/videos?page=1&limit=20&search=...
```

- Auth: Bearer token required (existing `authenticate` middleware).
- Paging: `page` (default 1), `limit` (default 20), `search` (matches `title`).

---

## Unified Response Shape

```json
{
  "success": true,
  "data": {
    "category": { /* VideoCategory doc */ },
    "list": [
      {
        "_id": "...",
        "videoCategoryId": "...",
        "title": "...",
        "topic": "...",
        "slug": "...",
        "platform": "youtube" | "aws",
        "priceType": "free" | "paid",
        "order": 0,
        "status": true,
        "createdAt": "...",
        "updatedAt": "...",
        "qualities": [
          { "label": "1080p", "height": 1080, "url": "https://..." },
          { "label": "720p",  "height": 720,  "url": "https://..." },
          { "label": "360p",  "height": 360,  "url": "https://..." }
        ],
        "default": "720p"
      }
    ]
  },
  "pagination": { "total": 3, "page": 1, "limit": 20, "totalPages": 1 }
}
```

Hard rules so the frontend never branches on `platform` for playback:

1. **Every item has `qualities[]`** with at least one entry. Order:
   highest resolution → lowest.
2. **Every `url` is directly playable** by the RN native player. No iframe,
   no embed, no further decryption needed.
3. **`default`** points at the recommended quality `label` (always defined).
4. Plaintext IDs (`youtube_id`, `aws_id`, `vimeo_id`) are stripped from
   the response.

---

## Per-Platform Logic

### `platform === "youtube"`

YouTube CDN URLs are IP-locked to the requesting machine. The RN app cannot
hit them directly — YouTube returns `403 Forbidden`. So we **proxy** the
stream through this server.

Flow at list time:

1. `youtubei.js` (`Innertube.create()` cached for process lifetime).
2. Try InnerTube clients in order `IOS → ANDROID → WEB_EMBEDDED → TV → WEB`
   — first one that returns a `streaming_data` block wins.
3. For each video format (1080p, 720p, ...), mint an HMAC-signed token
   `{ youtube_id, itag, exp: now+6h }` and build a proxy URL:
   `${PUBLIC_BASE_URL}/api/v1/client/yt-proxy?t=<token>`.
4. Return one `qualities[]` entry per advertised quality. The URLs are
   server URLs, not googlevideo URLs — RN player hits *us*.

Flow at playback time (`GET /api/v1/client/yt-proxy?t=<token>`):

1. Verify HMAC (rejects forgeries; rejects tokens older than 6h).
2. Re-call `Innertube.getInfo(youtube_id)` and locate the format matching
   `itag`. Fresh URL — never stale.
3. `fetch()` the googlevideo URL with the client's `Range` header forwarded.
4. Pipe the response body back to the RN player, copying `Content-Type`,
   `Content-Length`, `Content-Range`, `Accept-Ranges`, etc.

Critical wiring detail — `/yt-proxy` must NOT run `authenticate`:
- Native players (AVPlayer / ExoPlayer) don't send Bearer headers.
- Auth comes from the HMAC token in the URL instead.
- The route must be registered **before** any sibling sub-router that calls
  `router.use(authenticate)`, otherwise Express's middleware order fires
  auth first. In this codebase that means registering it at the top of
  `src/client/client.routes.ts`, BEFORE the sub-routers mounted at `/`.

If `getInfo` fails (private video, region block, library breakage), the
item falls back to a single-entry `qualities[]` with the encrypted
`youtube_id` so the app can at least know the item exists. Log the error.

### `platform === "aws"` (DigitalOcean Spaces / S3 master HLS)

Each `Video.aws_id` points to a master `.m3u8` playlist stored on DO Spaces
under the configured bucket. Bucket ACL is `public-read` — no presigning.

The master playlist already contains every quality variant. The RN player
(react-native-video with HLS support, or any HLS-capable player) handles
quality switching internally.

So for AWS items we return ONE entry in `qualities[]`:

```json
"qualities": [
  { "label": "auto", "height": 0, "url": "https://<spaces-cdn>/<aws_id>" }
]
```

The frontend treats `label === "auto"` as "the player picks". No quality
switcher is shown for AWS items (HLS handles it under the hood). If you
want a quality switcher for HLS later, the player can read the master
playlist and surface variants itself — no backend change.

If `aws_id` is already a full `https://` URL, return as-is. If it's a key
(e.g. `videos/foo/master.m3u8`), prefix with the CDN base
(`https://${DO_BUCKET}.${DO_REGION}.digitaloceanspaces.com/`).

---

## Files / Where Things Live

| Concern | File |
|---|---|
| List handler | `src/client/categories/categories.controller.ts` → `listVideosByCategory` |
| YT extraction + per-item shape | same file → `buildYoutubeItem` |
| AWS HLS URL builder | same file → `buildAwsItem` |
| Proxy handler + HMAC | `src/client/categories/yt-proxy.controller.ts` |
| Proxy route registration | `src/client/client.routes.ts` (top — before sub-routers) |
| List route registration | `src/client/categories/categories.routes.ts` |
| Video model | `src/models/course/Video.model.ts` |
| DO Spaces client | `src/middlewares/upload.ts` (reusable for URL building) |

---

## Required Env

| Var | Purpose | Required? |
|---|---|---|
| `PUBLIC_BASE_URL` | Absolute base URL used in proxy URLs (e.g. `https://api.yourdomain.com`). Falls back to `req.protocol://req.get("host")` if unset. | Recommended in prod; required when serving phones over LAN. |
| `DO_BUCKET`, `DO_ENDPOINT`, `DO_DEFAULT_REGION` | Spaces config. Already used by uploads — same values. | Yes |
| (none for HMAC) | Secret is generated per-process automatically. Tokens invalidate on restart by design. | — |

---

## Caveats / Operational Notes

1. **YouTube proxy bandwidth.** Every byte of YouTube playback goes through
   this server. Plan accordingly. Add a CDN in front if scale demands.
2. **`youtubei.js` breakage.** When YouTube changes their InnerTube response,
   `youtubei.js` may need an update. Health-check by hitting a known public
   video periodically and alerting when extraction fails.
3. **Quality availability.** Without cookies, YouTube often returns only
   itag 18 (360p muxed) with a direct URL. Higher qualities come back
   without URLs and the proxy will 502 those itags. Solutions:
   - Plug a cookie jar into `Innertube.create({ cookie: "..." })`.
   - Or, in `qualities[]`, only include entries the proxy can resolve.
     (We currently include all advertised — frontend should gracefully
     fall back if one 502s.)
4. **HLS on iOS.** Native AVPlayer supports HLS out of the box. On Android,
   react-native-video uses ExoPlayer which also supports HLS — confirm
   your build includes the HLS extension.
5. **Range requests.** The proxy forwards `Range` headers; seeking works.
6. **HMAC scope.** Each token is bound to one `(youtube_id, itag)`. Stolen
   tokens can only stream that one quality of that one video for 6h.
