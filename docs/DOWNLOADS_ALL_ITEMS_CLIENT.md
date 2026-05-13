# Downloads — Aggregated Folder Listing (Client)

The Downloads screen needs every saved video / material in a single call, grouped by folder. Per-folder fetch (`GET /{video|material}-folders/:id`) is still available, but for the Downloads tabs use:

- `GET /api/v1/client/video-folders/all-items`
- `GET /api/v1/client/material-folders/all-items`

Both require a Bearer token. They return all folders the customer owns for that type (including the default folder), with items + joined refs nested inside each folder. Items whose underlying Material/Video has been deleted are filtered out, so the total item count across all folders matches the `downloads` badge on `GET /api/v1/client/profile/dashboard`.

---

## `GET /api/v1/client/video-folders/all-items`

### Response

```json
{
  "success": true,
  "data": [
    {
      "folder": {
        "_id": "6a02da8f4e55c69dd3f63e3c",
        "customerId": "69e08c3c6274d94803f26c90",
        "type": "video",
        "isDefaultFolder": true,
        "name": "My Videos",
        "createdAt": "2026-05-12T07:45:19.340Z",
        "updatedAt": "2026-05-13T11:04:43.681Z"
      },
      "list": [
        {
          "_id": "6a04553178e364a990ab18c5",
          "kind": "video",
          "refId": "69ef2e6cdebc01c16b45be7b",
          "addedAt": "2026-05-13T10:40:49.384Z",
          "ref": {
            "_id": "69ef2e6cdebc01c16b45be7b",
            "videoCategoryId": "69e8ba2fa323f50f4fc0e29a",
            "title": "Day 03 વર્ગ - વર્ગમૂળ અને ઘન - ઘનમૂળ Part 01",
            "topic": "",
            "slug": "day-03----------part-01",
            "platform": "youtube",
            "priceType": "free",
            "order": 0,
            "status": true,
            "youtube_id": "5f0Na384Mck",
            "createdAt": "2026-04-27T09:37:48.730Z",
            "updatedAt": "2026-05-12T07:17:07.667Z"
          }
        }
      ]
    },
    {
      "folder": {
        "_id": "6a045ac0594a45f7f1628f78",
        "customerId": "69e08c3c6274d94803f26c90",
        "type": "video",
        "isDefaultFolder": false,
        "name": "1",
        "createdAt": "2026-05-13T11:04:32.476Z",
        "updatedAt": "2026-05-13T11:04:32.476Z"
      },
      "list": [
        {
          "_id": "6a045ac2594a45f7f1628f7d",
          "kind": "video",
          "refId": "6a01aba02ff0f2e9c3f0b509",
          "addedAt": "2026-05-13T11:04:34.397Z",
          "ref": {
            "_id": "6a01aba02ff0f2e9c3f0b509",
            "videoCategoryId": "69e8ba2fa323f50f4fc0e29a",
            "title": "Tablet Tutorial",
            "topic": "",
            "slug": "tablet",
            "platform": "youtube",
            "priceType": "free",
            "youtube_id": "5f0Na384Mck",
            "order": 0,
            "status": true,
            "createdAt": "2026-05-11T10:12:48.672Z",
            "updatedAt": "2026-05-12T07:17:03.591Z"
          }
        }
      ]
    }
  ]
}
```

---

## `GET /api/v1/client/material-folders/all-items`

### Response

```json
{
  "success": true,
  "data": [
    {
      "folder": {
        "_id": "6a02da8f4e55c69dd3f63e3d",
        "customerId": "69e08c3c6274d94803f26c90",
        "type": "material",
        "isDefaultFolder": true,
        "name": "My Materials",
        "createdAt": "2026-05-12T07:45:19.396Z",
        "updatedAt": "2026-05-13T11:06:18.249Z"
      },
      "list": []
    },
    {
      "folder": {
        "_id": "6a045b20594a45f7f1628faa",
        "customerId": "69e08c3c6274d94803f26c90",
        "type": "material",
        "isDefaultFolder": false,
        "name": "2",
        "createdAt": "2026-05-13T11:06:08.668Z",
        "updatedAt": "2026-05-13T11:06:08.668Z"
      },
      "list": [
        {
          "_id": "6a045b22594a45f7f1628faf",
          "kind": "material",
          "refId": "69e9fb44914b85310ace2e81",
          "addedAt": "2026-05-13T11:06:10.376Z",
          "ref": {
            "_id": "69e9fb44914b85310ace2e81",
            "title": "Esse eos inventore eveniet perspiciatis...",
            "description": "<p>Adipisci&nbsp;in&nbsp;accusant.</p>",
            "materialCategoryId": "69e9fb31914b85310ace2e78",
            "file": "Voluptatem ab esse",
            "directLink": "Consequatur Distinc",
            "thumbnail": "Fuga Proident nost",
            "fileSize": 16,
            "fileMime": "Non officia repellen",
            "language": "Optio amet animi",
            "isPreview": false,
            "downloadCount": 0,
            "order": 2,
            "status": true,
            "createdAt": "2026-04-23T10:58:12.415Z",
            "updatedAt": "2026-04-28T08:09:55.993Z"
          }
        }
      ]
    }
  ]
}
```

---

## Notes

- Default folder is always first (sorted by `isDefaultFolder: -1, createdAt: -1`).
- Empty folders are returned with `list: []` — the client decides whether to render them.
- Items are ordered by `addedAt` desc within each folder.
- Items whose `ref` (Material/Video) was deleted upstream are dropped from `list`, so:

  ```
  downloads (dashboard) = (sum of all list[] in video all-items)
                       + (sum of all list[] in material all-items)
                       + (ebook downloads array length from GET /ebooks/downloads)
  ```

- No pagination — the typical Downloads screen is small. If a customer grows past a few hundred items per type, add `?page` / `?limit` later.
- Auth: standard Bearer token, same middleware as the rest of `/{video|material}-folders/*`.
