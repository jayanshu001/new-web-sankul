# catalog-exam — API reference

> Auto-generated from a passing `migration:api` run for **catalog-exam**.
> Each endpoint shows a real captured request (headers + params/body) and response. Bearer tokens are redacted.

**Endpoints covered:** 2

---

## GET /api/v1/client/exam-categories/not-an-id/children

### Request headers
```json
{
  "Accept": "application/json",
  "Authorization": "Bearer <token>"
}
```

### Response (`400`)
```json
{
  "success": false,
  "message": "Invalid category id."
}
```

---

## GET /api/v1/client/exam-categories/:id/children

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
  "_note": "response truncated for docs — 4368 chars",
  "preview": "{\"success\":true,\"data\":{\"parent\":{\"_id\":\"86\",\"title\":\"Lecture Test for General Batch\",\"name\":\"Lecture Test for General Batch\",\"image\":\"1665553227_5 MEGA TEST@0.3x.png\",\"parent\":0,\"order\":0,\"status\":true,\"createdAt\":\"2022-10-12T11:10:27.000+05:30\",\"updatedAt\":\"2022-10-12T11:10:27.000+05:30\"},\"list\":[{\"category\":{\"_id\":\"88\",\"title\":\"Gujarat Geography - Abhijit Sir \",\"name\":\"Gujarat Geography - Abhijit Sir \",\"image\":\"1665553426_19 GB BEG@0.3x.png\",\"parent\":86,\"order\":0,\"status\":true,\"createdAt\":\"2022-10-12T11:13:46.000+05:30\",\"updatedAt\":\"2022-10-12T11:13:46.000+05:30\",\"count\":0,\"havingChildDirectory\":false}},{\"category\":{\"_id\":\"89\",\"title\":\"English - Parul Madam \",\"name\":\"English - Parul Madam \",\"image\":\"1665553444_7 EG@0.3x.png\",\"parent\":86,\"order\":0,\"status\":true,\"createdAt\":\"2022-10-12T11:14:04.000+05:30\",\"updatedAt\":\"2022-10-12T11:14:04.000+05:30\",\"count\":0,\"havingChildDirectory\":false}},{\"category\":{\"_id\":\"90\",\"title\":\"Gujarati - Mahesh Solanki \",\"name\":\"Gujarati - Mahesh Solanki \",\"image\":\"1665553608_29 GV BEGIN@0.3x.png\",\"parent\":86,\"order\":0,\"status\":true,\"createdAt\":\"2022-10-12T11:16:48.000+05:30\",\"updatedAt\":\"2022-10-12T11:16:48.000+05:30\",\"count\":0,\"havingChildDirectory\":false}},{\"category\":{\"_id\":\"91\",\"title\":\"Computer- Akram sherasiya sir \",\"name\":\"Computer- Akram sherasiya sir \",\"image\":\"1665553469_4 COMP@0.3x.png\",\"parent\":86,\"order\":0,\"status\":true,\"createdAt\":\"2022-10-12T11:14:29.000+05:30\",\"updatedAt\":\"2022-10-12T11:14:29.000+05:30\",\"count\":0,\"havingChildDirec…"
}
```

---
