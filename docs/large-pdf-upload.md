# Large eBook PDF uploads (up to 500 MB) — presigned direct-to-Spaces

## Why this exists

The old flow streamed the book PDF **through the API server** into DigitalOcean
Spaces (`uploadS3Mixed` multer middleware on `POST/PUT /admin/ebooks`). That
holds the HTTP request open for the entire upload, so large files time out at
the proxy/load-balancer (~60s) long before multer's size limit matters, and the
user has to sit and wait. Raising the multer limit to 500 MB makes this strictly
worse.

The fix: the **browser uploads the PDF directly to Spaces** using a short-lived
presigned URL. The bytes never pass through our server. The server only signs
the URL and later stores the resulting public file URL on the eBook record.

## Backend

- Endpoint: `POST /api/v1/admin/uploads/presign` (admin / super_admin / editor)
- Helper: [src/utils/presignUpload.ts](../src/utils/presignUpload.ts)
- Controller/routes: [src/admin/uploads/](../src/admin/uploads/)

### Request

```json
POST /api/v1/admin/uploads/presign
Authorization: Bearer <admin token>
Content-Type: application/json

{
  "kind": "ebookPdf",
  "fileName": "ncert-physics-class-12.pdf",
  "contentType": "application/pdf",
  "fileSize": 412958720
}
```

`fileSize` is in **bytes** and is required — the signed URL is pinned to that
exact `Content-Type` and `Content-Length`, so the URL can only be used to upload
that specific file. Max is **500 MB**.

### Response

```json
{
  "success": true,
  "data": {
    "uploadUrl": "https://websankul-staging.blr1.digitaloceanspaces.com/admin/ebooks/1733650000000-123456789-ncert-physics-class-12.pdf?X-Amz-Signature=...",
    "fileUrl": "https://websankul-staging.blr1.digitaloceanspaces.com/admin/ebooks/1733650000000-123456789-ncert-physics-class-12.pdf",
    "key": "admin/ebooks/1733650000000-123456789-ncert-physics-class-12.pdf",
    "expiresIn": 1800,
    "requiredHeaders": {
      "Content-Type": "application/pdf",
      "x-amz-acl": "public-read"
    }
  }
}
```

## Frontend flow

```js
// 1. Ask the server for a presigned URL
const presign = await api.post("/admin/uploads/presign", {
  kind: "ebookPdf",
  fileName: file.name,
  contentType: file.type || "application/pdf",
  fileSize: file.size,
}).then(r => r.data.data);

// 2. PUT the raw file straight to Spaces (NOT to our API).
//    Use XHR for a progress bar. Send EXACTLY the requiredHeaders.
await new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  xhr.open("PUT", presign.uploadUrl);
  Object.entries(presign.requiredHeaders).forEach(([k, v]) =>
    xhr.setRequestHeader(k, v)
  );
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
  };
  xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("Upload failed: " + xhr.status)));
  xhr.onerror = () => reject(new Error("Upload network error"));
  xhr.send(file);
});

// 3. Create/update the eBook with the resulting fileUrl as bookUrl.
//    Send the rest of the form as JSON (no multipart needed for the PDF).
await api.put(`/admin/ebooks/${id}`, {
  ...formFields,
  bookUrl: presign.fileUrl,
  bookFileName: file.name,
});
```

Notes:
- The eBook create/update endpoints already accept `bookUrl` as a plain string
  (see [ebook.validation.ts](../src/admin/ebook/ebook.validation.ts)), so no
  backend change is needed there. Keep sending `image`/`thumbnail` as multipart
  (they're small) or move them to presign later too.
- The upload runs in the background — let the admin keep filling the form and
  only block the final Save until the PUT resolves. That removes the wait.
- The `Content-Type` / `Content-Length` you send on the PUT **must** match what
  you declared at presign time, or Spaces rejects the signature.

## One-time DigitalOcean Spaces CORS config (REQUIRED)

A browser PUT to Spaces from the admin origin needs a CORS rule on the bucket,
or the request is blocked. Set this once per bucket (staging + prod) — DO control
panel → Spaces → Settings → CORS, or via `s3api`:

```bash
aws s3api put-bucket-cors \
  --endpoint-url https://blr1.digitaloceanspaces.com \
  --bucket websankul-staging \
  --cors-configuration '{
    "CORSRules": [{
      "AllowedOrigins": ["https://admin.websankul.com", "http://localhost:5173"],
      "AllowedMethods": ["PUT", "GET", "HEAD"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3600
    }]
  }'
```

Replace `AllowedOrigins` with the real admin dashboard origin(s).

## Limits & tuning

- Max size: `PRESIGN_MAX_BYTES = 500 MB` in
  [presignUpload.ts](../src/utils/presignUpload.ts). Change there.
- URL validity: `PRESIGN_EXPIRY_SECONDS = 30 min`. Enough for 500 MB on a slow
  link; bump if uploads time out on the signature.
- Allowed upload kinds are whitelisted in `KINDS` (currently only `ebookPdf`).
  Add `bookPdf`, `demoPdf`, etc. there to reuse the same endpoint for the
  `/admin/books` module or eBook demo PDFs.
```
