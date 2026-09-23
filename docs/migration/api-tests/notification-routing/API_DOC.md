# notification-routing — API reference

> Auto-generated from a passing `migration:api` run for **notification-routing**.
> Each endpoint shows a real captured request (headers + params/body) and response. Bearer tokens are redacted.

**Endpoints covered:** 1

---

## GET /api/v1/client/notifications

### Request headers
```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <token>"
}
```

### Query parameters
```json
{
  "page": 1,
  "limit": 50
}
```

### Response (`200`)
```json
{
  "success": true,
  "data": [
    {
      "_id": "101",
      "title": "API-TEST-ROUTING PLAIN",
      "titleHtml": null,
      "body": "b",
      "bodyHtml": null,
      "image": null,
      "type": "general",
      "isRead": false,
      "createdAt": "2026-07-28T07:59:49.000+05:30"
    },
    {
      "_id": "100",
      "title": "API-TEST-ROUTING LIVE",
      "titleHtml": null,
      "body": "b",
      "bodyHtml": null,
      "image": null,
      "type": "general",
      "isRead": false,
      "createdAt": "2026-07-28T07:59:49.000+05:30",
      "deepLink": "com.gpscvideo.gpsc://live-course/15",
      "liveCourseId": 15,
      "sessionId": 9001,
      "streamId": "stream_xyz"
    }
  ],
  "unreadCount": 21,
  "pagination": {
    "total": 61,
    "page": 1,
    "limit": 50,
    "totalPages": 2
  },
  "_note": "array truncated for docs — 50 items total; first 2 shown"
}
```

---
