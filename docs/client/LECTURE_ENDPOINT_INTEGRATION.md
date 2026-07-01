# Lecture Playback — Frontend Integration Guide

**Endpoint:** `GET /api/v1/client/courses/lecture`
**Auth:** Bearer token required (`Authorization: Bearer <client_token>`).
**Last updated:** 2026-07-01

Fetches a single playable lecture (video) for a course or package, returning the
encrypted video source. This is the canonical video-URL endpoint — the response
`token` + `videoURL` scheme must be used as-is by the player.

---

## Query parameters

| Param | Required | Value | Notes |
|---|---|---|---|
| `id` | ✅ always | video id | The lecture's video id. **Numeric MySQL id** (e.g. `33141`) or a 24-hex id. |
| `type` | ✅ always | `course` \| `package` | Which context the lecture is being opened in. |
| `course` | ✅ when `type=course` | course id | The course the video belongs to. Numeric MySQL id or 24-hex. |
| `package` | ✅ when `type=package` | package id | The package the video belongs to. Numeric MySQL id or 24-hex. |

> **Important:** `id` **alone is not enough**. You must always send `type`, and the
> matching `course` or `package` id. Sending only `?id=…` fails with `"Required"` (missing `type`).

### Examples

```
GET /api/v1/client/courses/lecture?id=33141&type=course&course=88
GET /api/v1/client/courses/lecture?id=33141&type=package&package=42
```

---

## Success response — `200`

Standard envelope; `data` carries the lecture:

```json
{
  "success": true,
  "code": 200,
  "data": {
    "_id": "33141",
    "title": "Introduction",
    "platform": "videocrypt",
    "token": "…",
    "videoURL": "…"
  },
  "message": "Lecture fetched successfully.",
  "messages": {}
}
```

- Pass `token` + `videoURL` straight to the player as the encryption scheme expects.
  Do not transform them.
- `platform` tells the player which delivery/DRM handler to use.

---

## Error responses

All errors use the standard envelope `{ success:false, code, data:{}, message, messages:{} }`.
Show `message` to the user / log it. Key cases:

| HTTP | `message` | Cause / fix |
|---|---|---|
| 400 | `Invalid video ID` | `id` isn't a valid id (not numeric / not 24-hex). |
| 400 | `Invalid course ID` / `Invalid package ID` | `course` / `package` isn't a valid id. |
| 400 | `Required` | `type` is missing. Always send `type`. |
| 400 | `course param is required when type is course` | Add the `course` param. |
| 400 | `package param is required when type is package` | Add the `package` param. |
| 403 | `Lecture is not available` | The video is disabled (status off). |
| 403 | `Lecture does not belong to this course` | Wrong `course` for this `id`. |
| 403 | `Active subscription required to access this lecture` | Paid lecture, user has no active subscription for that course/package. Route them to purchase. |
| 404 | `Lecture not found` | No such video (or bad id). |

---

## Access rules (how the backend decides)

1. Validates the query params (table above).
2. Loads the video; if missing → `404`, if disabled → `403 Lecture is not available`.
3. If `type=course`, verifies the video actually belongs to that course → else `403`.
4. **Free lectures** (`priceType = "free"`) → returned immediately, no subscription needed.
5. **Paid lectures** → require an **active subscription** on the given `course`/`package`,
   else `403 Active subscription required…`.

So for paid content, make sure the user has purchased the course/package before opening
the player; otherwise expect the `403` and send them to the purchase flow.

---

## Migration note (why numeric ids now work)

This endpoint runs on MySQL; ids like `33141` are `ws_video` integer ids. The validator was
updated to accept **either** a numeric MySQL id **or** a 24-hex ObjectId, so the frontend can
send the numeric ids returned by the catalog/course APIs directly. No change needed on the
client beyond sending the required `type` + `course`/`package` params.
