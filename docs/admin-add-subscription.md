# Admin → Add Subscription for Customer

Backend spec for the Subscription Page UI (Admin Panel). Mirrors the three screens: Add Subscription form, Pricing/Address fields, and the Add-Customer-Address modal.

**Base URL:** `/api/v1/admin/subscriptions`
**Auth:** All routes require `Authorization: Bearer <admin_jwt>`. Role must be `admin` or `super_admin`.
**Response envelope:** `{ success: boolean, data?, pagination?, message?, errors? }`

---

## 1. Form data flow

| Form Field | Source endpoint | Notes |
|---|---|---|
| Customer | `GET /api/v1/admin/customers?search=...` | Existing. Search by name/phone/email. |
| Package / Course (radio) | UI-only | Drives which target dropdown is shown. |
| Select Package | `GET /api/v1/admin/packages?status=true` | Existing. |
| Select Course | `GET /api/v1/admin/courses?status=true` | Existing. |
| Subscription Type (Active / Inactive) | UI-only | Maps to `status` boolean in submit payload. |
| Select With/Without Material | UI-only | Maps to `withMaterial` boolean. |
| Select Pricing Plan | `GET /api/v1/admin/subscriptions/plans?courseId=...` **or** `?packageId=...` | NEW. Returns plans for chosen target. |
| Payment Method | static enum (see below) | |
| Amount | Auto-fill from selected plan; admin can override. | |
| Duration (In Days) | Optional override. If empty, server uses plan `duration` (months). | |
| Customer Address | `GET /api/v1/admin/subscriptions/customer-addresses/:customerId` | NEW. Filters by selected customer. |
| `+` button (Add Address modal) | `POST /api/v1/admin/subscriptions/customer-addresses` | NEW. |
| Remark | free text, max 1000 chars | |
| Status toggle | maps to `status` in payload | |
| Submit | `POST /api/v1/admin/subscriptions` | Existing, enhanced. |

---

## 2. Endpoints

### 2.1 List plans for a course or package
`GET /api/v1/admin/subscriptions/plans`

**Query params (exactly one required):**
- `courseId` — ObjectId
- `packageId` — ObjectId

**200 Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f...",
      "courseId": "65a...",
      "packageId": null,
      "name": "3 Months",
      "duration": 3,
      "price": 1499,
      "withMaterial": false,
      "materialPrice": 0,
      "isDefault": true,
      "status": true
    }
  ]
}
```

**UI dropdown label suggestion:** `"{name || duration + ' months'} — ₹{price}{withMaterial ? ' (with material)' : ''}"`

---

### 2.2 List a customer's addresses
`GET /api/v1/admin/subscriptions/customer-addresses/:customerId`

**200 Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "65f...",
      "name": "Gautam Parmar",
      "phone": "9876543210",
      "address": "12, Park Lane",
      "address2": "",
      "cityId": { "_id": "...", "name": "Ahmedabad" },
      "stateId": { "_id": "...", "name": "Gujarat" },
      "pincode": "380001",
      "label": "home",
      "isDefault": false,
      "status": true
    }
  ]
}
```

---

### 2.3 Create address for a customer (admin) — for the `+` modal
`POST /api/v1/admin/subscriptions/customer-addresses`

**Body:**
```json
{
  "customerId": "65f...",
  "name": "Gautam Parmar",
  "phone": "9876543210",
  "alternatePhone": null,
  "email": null,
  "address": "12, Park Lane",
  "address2": "",
  "cityId": "65...",
  "stateId": "65...",
  "pincode": "380001",
  "label": "home",
  "status": true
}
```

**Required:** `customerId`, `name`, `address`, `pincode`.
**201 Response:** `{ success: true, data: <address doc> }`
**400:** `{ success: false, errors: [...] }` (Zod issues)
**404:** customer not found

---

### 2.4 Create subscription
`POST /api/v1/admin/subscriptions`

**Body:**
```json
{
  "customerId": "65f...",
  "courseId": "65a...",          // OR packageId — exactly one
  "packageId": "65b...",         // (the target Package _id, not the plan)
  "planId": "65c...",            // PackageCourseEbookPrice _id (selected pricing plan)
  "withMaterial": false,
  "paymentMethod": "cash",       // see enum below
  "amount": 1499,                // optional — defaults to plan.price (+ materialPrice if withMaterial)
  "durationDays": null,          // optional — overrides plan duration; otherwise plan.duration (months) is used
  "startAt": "2026-05-14",       // optional — defaults to now
  "customerShippingId": "65d...",// required when withMaterial=true
  "remark": "Paid in cash at center",
  "status": true
}
```

**Server behavior:**
1. Validates customer, plan exist.
2. If `courseId` provided, plan's `courseId` must match.
   If `packageId` provided, plan's `packageId` must match.
3. If `withMaterial=true`, `customerShippingId` is required and must belong to `customerId`.
4. **endAt computation:**
   - If `durationDays` is provided → `endAt = startAt + durationDays days`.
   - Otherwise → `endAt = startAt + plan.duration months` (calendar-month using `setMonth`).
5. **Amount:** uses request `amount` if provided; otherwise `plan.price + (withMaterial ? plan.materialPrice : 0)`.
6. Creates subscription with `paymentStatus = "verified"` and `paidAt = now` (admin-created = pre-verified).

**201 Response:**
```json
{
  "success": true,
  "data": {
    "_id": "...",
    "customerId": "...",
    "courseId": "..." | null,
    "targetPackageId": "..." | null,
    "packageId": "...",         // plan row _id (legacy field name)
    "customerShippingId": "..." | null,
    "startAt": "2026-05-14T00:00:00.000Z",
    "endAt":   "2026-08-14T00:00:00.000Z",
    "status": true,
    "paidAmount": 1499,
    "paymentStatus": "verified",
    "paymentMethod": "cash",
    "withMaterial": false,
    "remark": "Paid in cash at center",
    "paidAt": "2026-05-14T10:12:33.000Z",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

**Error responses:**
- `400` — Zod errors (`errors` array), or business-rule violations (`message`).
- `404` — Customer or plan not found.

---

### 2.5 (Existing) List / detail / update / delete

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/admin/subscriptions` | filters: `customerId`, `courseId`, `packageId`, `status`, `fromDate`, `toDate`, `page`, `limit` |
| GET | `/api/v1/admin/subscriptions/:id` | populated detail |
| PUT | `/api/v1/admin/subscriptions/:id` | partial: `startAt`, `endAt`, `status`, `customerShippingId`, `trackingId`, `remark` |
| DELETE | `/api/v1/admin/subscriptions/:id` | hard delete |

---

## 3. Enums

**Payment Method** (`paymentMethod`):
```
"Backend" | "razorpay" | "bank" | "cash" | "free" | "Paykun" | "Paytm"
```
UI form dropdown should display: Cash, Bank Transfer, UPI / Razorpay, Paytm, Paykun, Backend, Free. Default = `"cash"`.

**Subscription Type** (`status` boolean): `true` = Active, `false` = Inactive.

**Address label**: `"home" | "work" | "other"`.

---

## 4. UI ↔ payload mapping (cheat sheet)

| UI Field | Payload key | Type |
|---|---|---|
| Customer | `customerId` | ObjectId |
| Package radio + Select Package | `packageId` | ObjectId |
| Course radio + Select Course | `courseId` | ObjectId |
| Subscription Type | `status` | boolean |
| With/Without Material | `withMaterial` | boolean |
| Pricing Plan | `planId` | ObjectId |
| Payment Method | `paymentMethod` | enum |
| Amount | `amount` | number |
| Duration (In Days) | `durationDays` | number (optional) |
| Customer Address | `customerShippingId` | ObjectId |
| Remark | `remark` | string |
| Status (bottom toggle) | `status` | boolean (same as Subscription Type) |

---

## 5. Notes for FE dev

- Send Bearer token on every call. No public route here.
- When user switches Package ↔ Course radio, clear `planId` and re-fetch `/plans`.
- When the Pricing Plan changes, auto-populate `amount` from the plan response and leave `durationDays` empty (server will use plan.duration in months).
- When `withMaterial = true`, force the Customer Address dropdown to be required.
- The `+` button opens the Add-Customer-Address modal; on submit, POST to `/customer-addresses`, then refresh the address dropdown and auto-select the newly-created `_id`.
- All dates are ISO strings; server parses with `new Date(...)`.
