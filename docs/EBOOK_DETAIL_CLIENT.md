# Ebook Detail — Client API

Returns full ebook metadata plus tiered subscription plans and any active public promocodes that apply to it. This is the response that powers the multi-tier pricing card (1 / 3 / 6 / 12 months, "Best Value" highlight, "Save ₹X" copy).

**Auth:** Bearer token, role `customer`.
**Endpoint:** `GET /api/v1/client/ebooks/:id`

## Response 200
```json
{
  "success": true,
  "data": {
    "ebook": {
      "_id": "...",
      "name": "...",
      "author": "...",
      "publisher": "...",
      "language": "Gujarati",
      "description": "...",
      "thumbnail": "...",
      "image": "...",
      "demoUrl": "...",
      "ebookUrl": "...",
      "isTrending": false,
      "status": true,
      "createdAt": "...",
      "updatedAt": "...",
      "plans": [
        {
          "_id": "...",
          "ebookId": "...",
          "name": "1 Month",
          "duration": 1,
          "price": 999,
          "withMaterial": false,
          "materialPrice": 0,
          "isDefault": false,
          "status": true
        },
        {
          "_id": "...",
          "name": "3 Months",
          "duration": 3,
          "price": 2697,
          "isDefault": false,
          "status": true
        },
        {
          "_id": "...",
          "name": "6 Months",
          "duration": 6,
          "price": 4794,
          "isDefault": true,
          "status": true
        },
        {
          "_id": "...",
          "name": "12 Months",
          "duration": 12,
          "price": 8388,
          "isDefault": false,
          "status": true
        }
      ]
    },
    "availablePromoCode": [
      { "title": "Welcome", "promocode": "WELCOME10", "description": "10% off" }
    ]
  }
}
```

## Pricing UI mapping (per the tier card)

For each entry in `ebook.plans`:

| UI element | How to derive |
|---|---|
| Tier label (e.g. "1 Month", "6 Months") | `plan.name` if present, else `${plan.duration} Month${plan.duration > 1 ? "s" : ""}` |
| Per-month price (e.g. `₹999 /month`) | `plan.price / plan.duration` (round to nearest rupee) |
| Total (right side, e.g. `₹4794 Total`) | `plan.price` — this **is** the total for the tier, not a monthly value |
| `Save ₹X` | `oneMonth.price * plan.duration - plan.price`, where `oneMonth` = the plan with `duration: 1`. Hide for the 1-month plan or when result is `<= 0` |
| "Best Value" badge / pre-selected radio | `plan.isDefault === true` |

Plans are returned sorted by `duration` ascending, so the array order already matches the card stack top-to-bottom.

## Available promocodes
`data.availablePromoCode` lists active, public promocodes that the customer can try at checkout for this ebook. Apply them via `POST /api/v1/client/promocodes/apply` to preview the discounted plan prices (see [PROMOCODE_DISCOUNT_CLIENT.md](PROMOCODE_DISCOUNT_CLIENT.md)).

## Errors
- `400` invalid id.
- `404` ebook not found or `status: false`.

---

# Viewing the eBook (PDF viewer)

The detail response never hands you a directly-openable file URL. `demoUrl` / `ebookUrl`
are internal references — to actually open the PDF you exchange a short-lived **media
token** for a signed URL via `POST /client/media/resolve`, then render that in a PDF
viewer. This section is the end-to-end recipe (client uses `react-native-pdf`).

## Flow at a glance

```
eBook detail / listing
   → gives a mediaToken  (kind = "ebookDemo" for the preview, "ebook" for the full book)
        │
        ▼
POST /client/media/resolve  { token }
        │  returns { kind, media: { url } }  ← signed PDF URL, valid ~5 min
        ▼
Download the PDF bytes to a LOCAL file  (within the URL's lifetime)
        │
        ▼
Render the LOCAL file path in react-native-pdf
```

> **Golden rule:** resolve → download-to-local-file → render the **local path**. Do NOT
> hand the remote signed URL straight to the viewer and hope it downloads in time. The
> signed URL expires (~5 min); a local file never does.

## Step 1 — Get the signed URL

```
POST /api/v1/client/media/resolve
Authorization: Bearer <access token>
Content-Type: application/json

{ "token": "<mediaToken>" }
```

Success `200`:
```json
{
  "success": true,
  "code": 200,
  "data": {
    "kind": "ebookDemo",                       // or "ebook"
    "media": { "url": "https://…spaces…/file.pdf?X-Amz-…" }
  },
  "message": "Media resolved."
}
```

- `ebookDemo` → the preview PDF (anyone can view).
- `ebook` → the full book; the server enforces an **active eBook subscription**. No
  entitlement ⇒ `403` (show a purchase CTA, do not retry).
- The `media.url` is valid for a short window (currently ~5 minutes,
  `X-Amz-Expires` in the query string). Treat it as single-use and time-boxed.

### Resolve error handling
| Status | Meaning | Client action |
|---|---|---|
| `403` | Not entitled / token issued to another account | Show "buy to read" / re-login |
| `410` | `mediaToken` expired | Re-fetch the token from the eBook detail/listing, resolve again |
| `401` | Invalid token | Re-fetch token, retry |
| `404` | eBook has no PDF | Show "not available" |

## Step 2 — Download to a local file, then render

Fetching the bytes yourself (instead of letting the viewer fetch the remote URL) is what
prevents the **"Load pdf failed"** error — that error means the viewer downloaded a
Spaces **error response** (an `AccessDenied` / `Request has expired` XML) and saved it as
the `.pdf`. Downloading yourself lets you validate the bytes first.

```tsx
import Pdf from "react-native-pdf";
import RNFetchBlob from "rn-fetch-blob"; // or expo-file-system

async function openEbook(mediaToken: string) {
  // 1) resolve
  const res = await api.post("/client/media/resolve", { token: mediaToken });
  const url = res.data.data.media.url;

  // 2) download to a local file (unique name per open — avoids stale cache reuse)
  const dest = `${RNFetchBlob.fs.dirs.CacheDir}/ebook-${Date.now()}.pdf`;
  const dl = await RNFetchBlob.config({ path: dest }).fetch("GET", url);

  // 3) validate: it must be a real PDF, not an XML error body
  const status = dl.respInfo.status;                     // expect 200
  const head = (await dl.readFile("utf8")).slice(0, 8);  // expect it to start with "%PDF"
  if (status !== 200 || !head.startsWith("%PDF")) {
    // URL expired / access denied → re-resolve once and retry
    throw new Error("Signed URL did not return a PDF (expired?). Re-resolve.");
  }

  // 4) render the LOCAL path
  return `file://${dest}`;
}
```

```tsx
<Pdf
  source={{ uri: localFileUri, cache: false }}   // local file → no expiry, no stale cache
  trustAllCerts={false}
  onError={(err) => {
    // On any load error: delete the cached file + re-run openEbook() for a fresh URL.
  }}
  style={{ flex: 1 }}
/>
```

## Why "Load pdf failed" happens (and how each fix maps)

The library saved a non-PDF response as the cache file. Root causes, in order of
likelihood:

1. **Signed URL expired before the download finished** (~5-min window; large PDFs on
   slow mobile links). → Download to a local file immediately after resolve; validate the
   `%PDF` header; re-resolve on failure.
2. **react-native-pdf reused a previously-failed cache file** (it keys the cache by URL
   hash — note the `…/Caches/<hash>.pdf` path in the error). → Use a **unique local
   filename per open** (as above) or `cache={false}`; clear the file in `onError`.
3. **Not entitled / wrong token** → handled by the resolve status codes above.

Quick isolation test: paste a **fresh** resolved `media.url` into a browser. If it
downloads the PDF, the URL is fine and it's a viewer/cache issue (#2). If it shows XML
(`<Error>…`), it's expiry/entitlement (#1/#3).

## Platform notes
- **react-native-pdf (iOS/Android):** render a `file://` local path (recommended above).
  If you must render the remote URL directly, keep `cache={false}` and a unique
  `cacheFileName`.
- **iOS native:** `PDFKit` (`PDFView`) or QuickLook.
- **Android native:** `PdfRenderer` or AndroidPdfViewer.
- **Web:** `pdf.js` (in-app viewer) or `<iframe src={url}>`.

## Security note
The signed URL grants direct file access for its lifetime, so prefer an in-app viewer
over opening the system browser if you want to discourage sharing. (This is time-limited
signing, not full DRM.)
