# catalog-ebook — API reference

> Auto-generated from a passing `migration:api` run for **catalog-ebook**.
> Each endpoint shows a real captured request (headers + params/body) and response. Bearer tokens are redacted.

**Endpoints covered:** 2

---

## GET /api/v1/client/ebooks

### Request headers
```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <token>"
}
```

### Response (`200`)
```json
{
  "_note": "response truncated for docs — 30488 chars",
  "preview": "{\"success\":true,\"data\":{\"ebooks\":[{\"_id\":\"49\",\"name\":\"EBook Two\",\"thumbnail\":\"\",\"image\":\"\",\"description\":\"<p>Descripiton</p>\",\"termsAndConditions\":\"\",\"author\":\"Author One\",\"publisher\":\"Author 2\",\"language\":\"English\",\"order\":0,\"demoMediaToken\":null,\"bookMediaToken\":null,\"link\":\"https://www.jod.me\",\"status\":true,\"isTrending\":false,\"createdAt\":\"2026-07-21T14:03:19.000+05:30\",\"updatedAt\":\"2026-07-21T16:18:43.000+05:30\",\"plans\":[{\"_id\":\"1450\",\"ebookId\":\"49\",\"name\":null,\"duration\":30,\"price\":399,\"isDefault\":false,\"status\":true,\"isMostPopular\":false,\"createdAt\":\"2026-07-21T14:03:19.000+05:30\",\"updatedAt\":\"2026-07-21T14:18:50.000+05:30\"},{\"_id\":\"901\",\"ebookId\":\"49\",\"name\":\"3 month\",\"duration\":90,\"price\":50,\"isDefault\":true,\"status\":true,\"isMostPopular\":false,\"createdAt\":\"2023-03-10T23:27:20.000+05:30\",\"updatedAt\":\"2026-07-21T14:18:50.000+05:30\"},{\"_id\":\"902\",\"ebookId\":\"49\",\"name\":\"6 month\",\"duration\":180,\"price\":100,\"isDefault\":false,\"status\":true,\"isMostPopular\":false,\"createdAt\":\"2023-03-10T23:27:29.000+05:30\",\"updatedAt\":\"2026-07-21T14:18:50.000+05:30\"}],\"details\":[{\"id\":1,\"mainText\":\"Language\",\"subText\":\"English\"},{\"id\":2,\"mainText\":\"Author\",\"subText\":\"Author One\"},{\"id\":3,\"mainText\":\"Publisher\",\"subText\":\"Author 2\"}],\"isPaid\":true,\"isPurchased\":false,\"isNew\":true,\"subscriptionEndAt\":null,\"daysLeft\":null,\"shareableLink\":\"https://websankul-api.4tysixapplabs.com/share/ebooks/49\"},{\"_id\":\"48\",\"name\":\"EBook One\",\"thumbnail\":\"\",\"image\":\"\",\"description\":\"<p>Description</p>\",\"termsAndCo…"
}
```

_(2 calls captured for this endpoint; first shown.)_

---

## GET /api/v1/client/ebooks?language=English

### Request headers
```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <token>"
}
```

### Response (`200`)
```json
{
  "_note": "response truncated for docs — 28958 chars",
  "preview": "{\"success\":true,\"data\":{\"ebooks\":[{\"_id\":\"49\",\"name\":\"EBook Two\",\"thumbnail\":\"\",\"image\":\"\",\"description\":\"<p>Descripiton</p>\",\"termsAndConditions\":\"\",\"author\":\"Author One\",\"publisher\":\"Author 2\",\"language\":\"English\",\"order\":0,\"demoMediaToken\":null,\"bookMediaToken\":null,\"link\":\"https://www.jod.me\",\"status\":true,\"isTrending\":false,\"createdAt\":\"2026-07-21T14:03:19.000+05:30\",\"updatedAt\":\"2026-07-21T16:18:43.000+05:30\",\"plans\":[{\"_id\":\"1450\",\"ebookId\":\"49\",\"name\":null,\"duration\":30,\"price\":399,\"isDefault\":false,\"status\":true,\"isMostPopular\":false,\"createdAt\":\"2026-07-21T14:03:19.000+05:30\",\"updatedAt\":\"2026-07-21T14:18:50.000+05:30\"},{\"_id\":\"901\",\"ebookId\":\"49\",\"name\":\"3 month\",\"duration\":90,\"price\":50,\"isDefault\":true,\"status\":true,\"isMostPopular\":false,\"createdAt\":\"2023-03-10T23:27:20.000+05:30\",\"updatedAt\":\"2026-07-21T14:18:50.000+05:30\"},{\"_id\":\"902\",\"ebookId\":\"49\",\"name\":\"6 month\",\"duration\":180,\"price\":100,\"isDefault\":false,\"status\":true,\"isMostPopular\":false,\"createdAt\":\"2023-03-10T23:27:29.000+05:30\",\"updatedAt\":\"2026-07-21T14:18:50.000+05:30\"}],\"details\":[{\"id\":1,\"mainText\":\"Language\",\"subText\":\"English\"},{\"id\":2,\"mainText\":\"Author\",\"subText\":\"Author One\"},{\"id\":3,\"mainText\":\"Publisher\",\"subText\":\"Author 2\"}],\"isPaid\":true,\"isPurchased\":false,\"isNew\":true,\"subscriptionEndAt\":null,\"daysLeft\":null,\"shareableLink\":\"https://websankul-api.4tysixapplabs.com/share/ebooks/49\"},{\"_id\":\"48\",\"name\":\"EBook One\",\"thumbnail\":\"\",\"image\":\"\",\"description\":\"<p>Description</p>\",\"termsAndCo…"
}
```

---
