# Change summary — eBook book PDF uploads: 50 MB → 500 MB without the wait

**Date:** 2026-06-08
**Module:** eBook (`/admin/ebooks`) — book PDF (`bookUrl`) uploads
**Related deep-dive:** [large-pdf-upload.md](./large-pdf-upload.md) (frontend contract + CORS)

---

## The ask

> "We currently allow max 50 MB for the book PDF in the eBook module, and even
> that times out when the upload takes a while. We want to allow up to 500 MB,
> without making the user wait."

## The real problem (why we couldn't just raise the limit)

The old upload path streamed the PDF **through our API server**:

```
Browser  ──(multipart, 50 MB)──►  Express + multer  ──►  DigitalOcean Spaces
                                   (request held open the whole time)
```

That design has a hard ceiling that has nothing to do with multer's
`fileSize` setting:

- The HTTP request stays open for the **entire** upload-to-Spaces duration.
- The proxy / load balancer (and most reverse proxies) cut idle requests at
  ~60 seconds, so large files **time out regardless of the multer limit**.
- The user sits and waits because the form save *is* the upload.
- All that bandwidth and memory pressure lands on our server.

So bumping `50 MB → 500 MB` in multer would have made the wait **10× longer**
and the timeout **more** likely — not fixed it. The fix had to be architectural.

## What we did

We switched the book PDF to a **presigned direct-to-Spaces upload**. The
browser now uploads the file **straight to DigitalOcean Spaces**; the bytes
never pass through our server.

```
                ┌──(1) ask for signed URL──►  Express  ──► returns presigned PUT URL
Browser  ───────┤
                └──(2) PUT file (≤500 MB)  ─────────────►  DigitalOcean Spaces
                                                              (direct, no server)

         (3) save eBook with bookUrl = the resulting public file URL
```

1. **Frontend → API:** `POST /api/v1/admin/uploads/presign` with the file name,
   content type, and size. Server returns a short-lived signed `uploadUrl` plus
   the final public `fileUrl`.
2. **Frontend → Spaces:** browser `PUT`s the raw file directly to `uploadUrl`
   (with an XHR progress bar). No API involvement, no request held on our side.
3. **Frontend → API:** create/update the eBook with `bookUrl = fileUrl`. The
   eBook endpoints already accept `bookUrl` as a plain string, so nothing
   changed there.

### Why this solves all three pain points

| Pain point            | How it's fixed                                                       |
| --------------------- | ------------------------------------------------------------------- |
| Times out on big files| Upload no longer touches our server, so the proxy timeout is moot.  |
| 50 MB → 500 MB        | Size cap is now ours to set (500 MB); Spaces handles the transfer.  |
| User has to wait      | Upload runs in the background while the admin fills the form.       |
| Server load           | All upload bandwidth/memory moves off our server onto Spaces.       |

### Safety guardrails we kept

- The signed URL is **pinned to the exact `Content-Type` and `Content-Length`**
  the client declared, so a URL can only ever upload that one specific file.
- Upload "kinds" are **whitelisted** (currently only `ebookPdf` — PDF only,
  500 MB cap). The endpoint can't be used to write arbitrary keys or types.
- The presign endpoint requires a valid admin Bearer token and
  `requireRole("admin", "super_admin", "editor")` — consistent with our
  "auth on every route" rule.
- The signed URL expires after 30 minutes.

## Files changed

| File | What |
| ---- | ---- |
| `src/utils/presignUpload.ts` | **New.** Builds the presigned PUT URL; whitelisted kinds, size/type validation, pinned Content-Type/Length. |
| `src/admin/uploads/uploads.controller.ts` | **New.** Validates the request and returns the signed URL. |
| `src/admin/uploads/uploads.routes.ts` | **New.** `POST /presign`, role-gated. |
| `src/admin/admin.routes.ts` | Registered the `/uploads` subtree. |
| `src/middlewares/upload.ts` | Exported `s3Config` + `DO_BUCKET` so the presigner reuses the existing Spaces client. |
| `docs/large-pdf-upload.md` | **New.** Frontend contract, sample code, required Spaces CORS rule. |
| `package.json` | Added `@aws-sdk/s3-request-presigner` (pinned to match `@aws-sdk/client-s3`). |

The old multer proxy path (`uploadS3Mixed`) still exists and is still used for
the small files in the same form — image, thumbnail, demo PDF.

## Still required to go live

1. **Spaces CORS rule** (staging + prod): a browser PUT to Spaces from the admin
   origin is blocked without it. Exact command is in
   [large-pdf-upload.md](./large-pdf-upload.md#one-time-digitalocean-spaces-cors-config-required).
2. **Frontend change:** switch the book-PDF field from "multipart to our API" to
   the 3-step presign flow. Sample XHR code (with progress bar) is in the same
   doc.

## Possible follow-ups

- Reuse the same endpoint for the `/admin/books` module and the eBook *demo*
  PDF by adding more entries to the `KINDS` whitelist in `presignUpload.ts`.
- Consider S3 multipart (chunked, resumable) upload only if admins are on very
  flaky connections — overkill for 500 MB otherwise.
