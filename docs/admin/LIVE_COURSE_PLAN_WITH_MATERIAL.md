# Admin Frontend — Live Course Plans: "With Material / Without Material"

What the **admin plan form** must add so Live Courses support material/no-material
plans, exactly like Courses & Packages.

> Scope: this is about the **per-plan** form (the pricing plans you add under a live
> course), NOT the course-level `withMaterial`/`withoutMaterial` label text fields
> (those already exist on the live-course form and are unchanged).

---

## New fields to add to the Plan form

| Field | UI control | Type | Required | Default | Notes |
|---|---|---|---|---|---|
| `withMaterial` | Toggle / checkbox ("Includes physical material") | boolean | No | `false` | Marks this plan as the "with material" variant. |
| `materialPrice` | Number input ("Material price ₹") | number ≥ 0 | No | `null` | Informational material portion of the price. Show only when `withMaterial = true`. |

**Suggested UX**
- Render `materialPrice` only when the `withMaterial` toggle is ON (hide/disable otherwise).
- `materialPrice` is informational (it does **not** change what's charged — `price` is
  the amount charged). Label it clearly, e.g. "of which material = ₹X".
- A live course typically has BOTH kinds of plans (e.g. "6 months — with material"
  and "6 months — without material"). Admin creates them as separate plan rows, each
  with the toggle set appropriately.

Existing plan fields are unchanged: `name`, `duration` (days), `price`,
`originalPrice`, `isDefault`, `status`.

---

## Endpoints

| Action | Method & URL |
|---|---|
| Create plan | `POST /api/v1/admin/live-courses/:id/plans` |
| Update plan | `PUT  /api/v1/admin/live-courses/plans/:planId` |
| List plans | `GET  /api/v1/admin/live-courses/:id/plans` |
| Get one plan | `GET  /api/v1/admin/live-courses/plans/:planId` |

All require the admin Bearer token (same as today).

---

## Updated request payloads

### Create plan — `POST /api/v1/admin/live-courses/:id/plans`
```json
{
  "name": "6 Months — With Material",
  "duration": 180,
  "price": 5999,
  "originalPrice": 7999,
  "withMaterial": true,
  "materialPrice": 800,
  "isDefault": false,
  "status": true
}
```

A "without material" plan simply omits/zeros the material fields:
```json
{
  "name": "6 Months — Digital Only",
  "duration": 180,
  "price": 4999,
  "originalPrice": 6999,
  "withMaterial": false,
  "isDefault": true,
  "status": true
}
```

### Update plan — `PUT /api/v1/admin/live-courses/plans/:planId`
Partial — send only changed fields. Examples:
```json
{ "withMaterial": true, "materialPrice": 800 }
```
```json
{ "withMaterial": false, "materialPrice": 0 }
```

### Validation rules (server, 422 on failure)
- `withMaterial` — boolean (optional; defaults to `false`).
- `materialPrice` — number, **≥ 0** (optional).
- Unknown/extra keys are rejected (strict schema) — only send the documented fields.
- `duration` is a positive integer (DAYS). `price`/`originalPrice` ≥ 0.

---

## Response shape (plan DTO)

`create` / `update` / `get` / `list` all return the plan in this shape — note the two
new keys:
```json
{
  "_id": "12",
  "liveCourseId": "5",
  "name": "6 Months — With Material",
  "duration": 180,
  "price": 5999,
  "originalPrice": 7999,
  "withMaterial": true,
  "materialPrice": 800,
  "isDefault": false,
  "status": true,
  "createdAt": "2026-06-27T10:00:00.000Z",
  "updatedAt": "2026-06-27T10:00:00.000Z"
}
```
- `create` → `{ data: { plan: <PlanDTO> }, message: "Plan created." }` (201)
- `list`   → `{ data: { plans: [<PlanDTO>...], total }, ... }`

---

## How it flows to the client (FYI for the admin dev)

- The **client** apply-promo / detail responses split plans into
  `plans: { withMaterial: [...], withoutMaterial: [...] }` based on the per-plan
  `withMaterial` flag. So if admin never sets `withMaterial = true` on any plan, the
  `withMaterial` bucket stays empty and everything shows as "without material".
- At checkout the customer picks a plan; **the plan's `withMaterial` decides** whether
  the order ships material (the client app sends the delivery address; `withMaterial`
  is no longer taken from the request body). So the admin toggle is the single source
  of truth for which plans are "with material".

---

## Admin FE checklist

- [ ] Add `withMaterial` toggle to the plan create/edit form.
- [ ] Add `materialPrice` number input, shown only when `withMaterial` is ON.
- [ ] Include `withMaterial` (+ `materialPrice` when applicable) in the create/update payloads.
- [ ] Render the two new fields in any plan list/detail view.
- [ ] (Optional) Group/label plan rows by `withMaterial` so admins see the two variants clearly.
