# Frontend Guide — Client Promocodes Listing (entity filter)

`GET /api/v1/client/promocodes`

Lists the **public, currently-active** promo codes. Optionally, you can scope the
list to a **single entity** (a specific package / course / test-series / eBook /
live-course) so the user only sees the codes that actually apply to what they're
viewing.

> Same response whether the backend serves from MySQL or MongoDB — build against
> this contract only.

---

## 1. Auth

Bearer token required (like every client route).

```
Authorization: Bearer <accessToken>
```

---

## 2. Query parameters

| Param    | Required | Type   | Default | Notes |
|----------|----------|--------|---------|-------|
| `type`   | Conditional | enum | — | Module the `id` belongs to. **Must be sent together with `id`.** |
| `id`     | Conditional | string | — | The entity id (package/course/etc). **Must be sent together with `type`.** |
| `page`   | No       | int    | `1`     | 1-based. Floored at 1. |
| `limit`  | No       | int    | `20`    | Min 1. |

### The `type` / `id` pairing rule
- Send **both** `type` and `id` → list is filtered to codes that apply to that exact entity.
- Send **neither** → returns **all** public active codes (default/legacy behaviour).
- Send **only one** of them → **422** error.

### Accepted `type` values
| Send | Means |
|------|-------|
| `package` | Package |
| `course` | Recorded course |
| `testSeries` *(or `test-series`)* | Test series |
| `ebook` *(or `e-book`)* | eBook |
| `liveCourse` *(or `live-course`)* | Live course |

> **Why `type` is required with `id`:** ids are numeric and can repeat across
> modules (package #88 and course #88 both exist), so the `type` tells the server
> which entity the id refers to. Always send the pair.

### What "filtered" returns
Only public, in-window codes whose admin-configured **appliesTo** list includes
**this specific entity** (matching type **and** id). If a code applies to other
packages but not this one, it won't appear.

---

## 3. Request examples

```http
# All public codes (no entity filter)
GET /api/v1/client/promocodes?page=1&limit=20

# Codes that apply to package #88
GET /api/v1/client/promocodes?type=package&id=88

# Codes that apply to a specific test series
GET /api/v1/client/promocodes?type=test-series&id=42

# Codes for a live course
GET /api/v1/client/promocodes?type=liveCourse&id=17
```

---

## 4. Response shape

```jsonc
{
  "success": true,
  "data": [
    {
      "_id": "1",
      "promocode": "FIRST50",
      "title": "Flat 50 Off",
      "description": "First purchase discount",
      "discountType": "flat",          // "flat" | "percentage"
      "discountValue": 50,
      "promo_start_at": "2026-04-30T00:00:00.000Z",
      "promo_expire_at": "2026-06-30T00:00:00.000Z"
    }
  ],
  "pagination": {
    "total": 1,         // total matching codes (respects the entity filter)
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

### Field notes for the UI
- **`discountType` + `discountValue`** — `"flat"` → ₹ off; `"percentage"` → % off. Render accordingly (`₹50 OFF` vs `50% OFF`).
- **`promo_start_at` / `promo_expire_at`** — the validity window. The API only returns codes that are active *right now*, so you can show `expire_at` as "valid till …".
- The list is **sorted by soonest expiry first** (`promo_expire_at` ascending) — good for an "expiring soon" nudge.
- This endpoint only **lists/advertises** codes. To actually compute the discount for a cart, use the **apply** endpoint (below).

---

## 5. Errors

| Status | When | Body |
|--------|------|------|
| `422`  | Only one of `type`/`id` sent | `{ "success": false, "message": "Provide both \`type\` and \`id\` to filter, or neither." }` |
| `422`  | `type` not a recognized module | `{ "success": false, "message": "Invalid type. Use one of: package, course, testSeries, ebook, liveCourse." }` |
| `422`  | `id` not valid for the active backend | `{ "success": false, "message": "Invalid id." }` |
| `401`  | Missing/expired token | standard auth error |
| `500`  | Unexpected server error | `{ "success": false, "message": "…" }` |

---

## 6. Recommended usage

On a product detail page (a package/course/etc.), fetch the codes scoped to that
product so the user sees only relevant offers:

```ts
type PromoModule =
  | "package" | "course" | "testSeries" | "ebook" | "liveCourse";

async function fetchPromocodesFor(module: PromoModule, entityId: string | number, page = 1) {
  const qs = new URLSearchParams({
    type: module,
    id: String(entityId),
    page: String(page),
    limit: "20",
  });

  const res = await fetch(`/api/v1/client/promocodes?${qs}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.message);
  return { codes: json.data, pagination: json.pagination };
}

// Generic offers screen (no specific product) → omit type & id:
async function fetchAllPublicPromocodes(page = 1) {
  const qs = new URLSearchParams({ page: String(page), limit: "20" });
  const res = await fetch(`/api/v1/client/promocodes?${qs}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return (await res.json());
}
```

- Always send `type` **and** `id` together, or omit both — never just one.
- Use the canonical values (`testSeries`, `liveCourse`) where possible; the kebab
  aliases are only there for convenience.
- An empty `data: []` with `total: 0` means "no applicable public codes" — show a
  neutral empty state, not an error.
- Drive paging from `pagination.totalPages`.

---

## 7. Applying a code (related endpoint)

Listing ≠ applying. To validate a code against a cart entity and get the
discounted plan prices, call:

```
POST /api/v1/client/promocodes/apply
Body: { "promocode": "FIRST50", "targetId": "88", "targetType": "package" }
```

- Works for **package / course / eBook**.
- **Live-course** and **test-series** discounts are previewed via their own
  plan-based endpoints:
  - `POST /api/v1/client/payment/apply-promo/live-course`
  - `POST /api/v1/client/payment/apply-promo/test-series`

(See the payment API docs for the apply response shape.)

---

## 8. Quick reference

| Goal | Call |
|------|------|
| All public codes | `GET /client/promocodes` |
| Codes for a package | `GET /client/promocodes?type=package&id=<pkgId>` |
| Codes for a test series | `GET /client/promocodes?type=test-series&id=<id>` |
| Next page | bump `page`, keep `type`/`id`/`limit` |
| Apply a code (pkg/course/ebook) | `POST /client/promocodes/apply` |
