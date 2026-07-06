# Ebook Downloads — Client Integration

Lets a customer "download" a purchased ebook PDF for offline reading inside
the app, see all their downloaded ebooks in the **Downloads → My E-Book** tab,
and remove individual entries via the trash icon.

All endpoints live under `/api/v1/client/ebooks`. Every endpoint requires
`Authorization: Bearer <accessToken>`.

## How it works

- Backend stores per-user download rows in `ws_ebook_downloads`
  (`{ customerId, ebookId, downloadedAt }`). The PDF file itself is **not**
  stored or proxied by the backend — the client downloads it directly from the
  ebook's `bookUrl`. The backend only authorizes and tracks.
- An active `EbookSubscription` (i.e. `status: true` and `endAt > now`) is
  required to download or to see an ebook in the downloads list. Once a
  subscription expires the row is hidden from the list (matches the in-app
  copy *"Downloads are removed when your subscription ends."*).
- Re-tapping Download on the same ebook is a no-op — the existing row's
  `downloadedAt` is refreshed, no duplicates.

## Endpoints

### 1. Tap "Download" — `POST /:id/download`

Call this when the user taps the **Download** button on the ebook detail
screen (the one in the first screenshot).

```http
POST /api/v1/client/ebooks/:id/download
Authorization: Bearer <accessToken>
```

**200**
```json
{
  "success": true,
  "message": "Download recorded.",
  "data": {
    "ebookId": "65f...",
    "bookUrl": "https://cdn.example.com/ebooks/vartman-march-2026.pdf"
  }
}
```

The client should then fetch `bookUrl` directly (e.g. via `react-native-fs`,
`Dio`, etc.) and persist the PDF locally for the in-app viewer.

**Errors**
- `400 Invalid ebook id.` — bad `:id`.
- `401 Unauthorized.` — missing/invalid token.
- `403 Active subscription required to download.` — user hasn't purchased this ebook or the subscription has expired.
- `404 Ebook not found.` — ebook id doesn't exist or is disabled.
- `404 This ebook has no downloadable PDF.` — ebook has no `bookUrl` set.

### 2. List my downloads — `GET /downloads`

Powers the **My E-Book** tab on the Downloads screen.

```http
GET /api/v1/client/ebooks/downloads
Authorization: Bearer <accessToken>
```

**200**
```json
{
  "success": true,
  "data": [
    {
      "_id": "<downloadRowId>",
      "ebookId": "65f...",
      "name": "Vartman Vishesh March 2026",
      "author": "Vikas Patel",
      "image": "https://.../cover.jpg",
      "thumbnail": "https://.../thumb.jpg",
      "language": "GUJARATI",
      "bookUrl": "https://.../book.pdf",
      "downloadedAt": "2026-05-12T10:00:00.000Z"
    }
  ]
}
```

Returned newest-first. Entries whose subscription is no longer active are
filtered out server-side. If the user later re-subscribes to the same ebook,
the row reappears automatically — no re-download needed (the DB row is kept).

### 3. Remove from downloads — `DELETE /downloads/:ebookId`

Wired to the trash icon in the screenshot. Removes the row from
`ws_ebook_downloads`. The client should also delete the locally cached PDF.

```http
DELETE /api/v1/client/ebooks/downloads/:ebookId
Authorization: Bearer <accessToken>
```

**200**
```json
{ "success": true, "message": "Removed from downloads." }
```

**Errors**
- `400 Invalid ebook id.`
- `404 Download not found.` — nothing to delete for this user + ebook.

## Suggested client flow

1. On **Download** tap (ebook detail screen):
   - `POST /api/v1/client/ebooks/:id/download`.
   - On 200, take `data.bookUrl` and fetch the PDF to local storage.
   - On 403, show a "Subscribe to download" CTA.
2. **Downloads → My E-Book** tab on open:
   - `GET /api/v1/client/ebooks/downloads`.
   - Render the rows. Open the in-app PDF viewer with the locally cached file
     (or fall back to streaming `bookUrl` if the local copy was wiped).
3. **Trash icon** tap:
   - `DELETE /api/v1/client/ebooks/downloads/:ebookId`.
   - Delete the local PDF cache for that ebook.
4. **On app launch / pull-to-refresh** — re-call `GET /downloads`; if a row
   the client has cached locally no longer appears (subscription expired or
   user deleted on another device), purge the local PDF.

## Notes

- Order of route registration matters: `/downloads` and `/downloads/:ebookId`
  are registered **before** the existing `/:id` catch-all, so the path
  segment "downloads" is never interpreted as an ebook id.
- The `bookUrl` is the same CDN URL exposed on `GET /ebooks/:id`. No signed
  URLs are issued at this stage; if a stricter model is needed later, the
  download endpoint is the place to swap in a short-lived signed URL.
