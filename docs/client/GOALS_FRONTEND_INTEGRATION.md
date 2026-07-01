# Goals — Frontend Integration Guide

**Status:** Backend ready (staging). **Last updated:** 2026-07-01

This describes how the client app should **read** selectable goals, **write** the
customer's selection, and **read back** what they selected — after the backend change
that lets a goal carry optional **labels** and lets the customer pick a goal *plus*
specific labels within it.

> All endpoints require a **Bearer token** (`Authorization: Bearer <client_token>`).
> Base path: `/api/v1/client`.

---

## The model in one picture

- A **goal** = a target goal (e.g. `GPSC Class 1/2`, `Dy.So`). It has an `_id`, `title`,
  `image`.
- A goal **may or may not** have **labels** (e.g. `Prelims`, `Mains`). Each label has its
  own `_id` (unique *within that goal*, starting at 1) and `name`.
- A customer selects **one or more goals**, and for each goal, **zero or more of its
  labels**. A goal with no labels is selected with an empty label list.

---

## 1. Fetch the selectable goals (build the selection screen)

`GET /api/v1/client/goals`

**Response `data`:**

```json
[
  {
    "_id": "1",
    "title": "GPSC Class 1/2",
    "image": "https://.../history.png",
    "labels": [
      { "_id": "1", "name": "Prelims" },
      { "_id": "2", "name": "Mains" }
    ]
  },
  {
    "_id": "2",
    "title": "Dy.So",
    "image": "https://.../history.png",
    "labels": []
  }
]
```

- Render each goal; if `labels` is non-empty, show them as sub-options (checkboxes/chips)
  under the goal.
- A goal with `labels: []` is just a selectable goal with no sub-options.

---

## 2. Save the customer's selection ✅ (this is what changed)

There are **two interchangeable write endpoints** — both accept the same `goals` payload,
validate it against the backend, and persist the identical selection. Use whichever fits
your flow:

- `PUT /api/v1/client/profile/update` — the normal profile save (send `goals` alongside
  other profile fields).
- `PUT /api/v1/client/goals` — a dedicated goals-only save (body is just `{ goals }`).

Send a `goals` array where **each entry is an object**: the goal id plus the label ids
chosen within it.

```json
{
  "goals": [
    { "goalId": "1", "labelIds": ["1"] },
    { "goalId": "2", "labelIds": [] }
  ]
}
```

Rules / semantics:

| Field | Type | Notes |
|---|---|---|
| `goalId` | string or number | The goal's `_id` from `GET /client/goals`. Required per entry. |
| `labelIds` | array of string/number | The selected labels' `_id`s **within that goal**. Omit or send `[]` when the goal has no labels or none are chosen. |

- Unknown `goalId`s and `labelId`s that don't belong to the goal are **silently dropped**
  by the backend (defensive) — send clean data.
- `goals` **replaces** the whole selection (it is not a partial merge). Send the full
  desired list every time.
- You may send `goals` **together with other profile fields** in the same call
  (`firstName`, `email`, etc.) — that's the `profile/update` body. The `PUT /client/goals`
  body is just `{ goals }`.
- `PUT /client/goals` returns `data: { goals: [{ goalId, labelIds }] }` (the normalized
  selection that was stored); `profile/update` returns the full profile object.

> ⚠️ **Deprecated payload:** the old flat form `"goals": ["1","2","3"]` is still *read*
> for backward compatibility, but it **cannot carry labels**. Always send the new
> `[{ goalId, labelIds }]` form going forward.

---

## 3. Read back the current selection

You have two options; both return the selection with **only the labels the customer
picked**.

### a) Dedicated endpoint

`GET /api/v1/client/goals/my-goals`

**Response `data`** (same item shape as `GET /client/goals`, but labels are filtered to
the selected ones):

```json
[
  {
    "_id": "1",
    "title": "GPSC Class 1/2",
    "image": "https://.../history.png",
    "labels": [ { "_id": "1", "name": "Prelims" } ]
  },
  {
    "_id": "2",
    "title": "Dy.So",
    "image": "https://.../history.png",
    "labels": []
  }
]
```

- Only selected goals are returned.
- Each goal shows **only its selected labels**. A selected goal with no labels appears
  with `labels: []` (it is **not** dropped).

### b) On the profile object

`GET /api/v1/client/profile` → `data.goals`:

```json
"goals": [
  { "_id": "1", "name": "GPSC Class 1/2", "labels": [ { "_id": "1", "name": "Prelims" } ] },
  { "_id": "2", "name": "Dy.So", "labels": [] }
]
```

- Same information; note the profile uses `name` (not `title`) for the goal, and does not
  include `image`. It now also carries `labels` (new, additive field).

---

## Quick reference

| Action | Method & path | Body / result |
|---|---|---|
| List selectable goals | `GET /client/goals` | `[{ _id, title, image, labels:[{_id,name}] }]` |
| **Save selection** (profile) | `PUT /client/profile/update` | `{ goals: [{ goalId, labelIds }], ...profile }` |
| **Save selection** (goals-only) | `PUT /client/goals` | `{ goals: [{ goalId, labelIds }] }` |
| Read selection | `GET /client/goals/my-goals` | selected goals + selected labels only |
| Read selection (profile) | `GET /client/profile` | `data.goals: [{ _id, name, labels }]` |

## Round-trip example

1. `GET /client/goals` → user sees `GPSC Class 1/2` (labels Prelims, Mains) and `Dy.So`.
2. User picks GPSC → Prelims only, and Dy.So.
3. `PUT /client/profile/update` with
   `{ "goals": [ { "goalId": "1", "labelIds": ["1"] }, { "goalId": "2", "labelIds": [] } ] }`.
4. `GET /client/goals/my-goals` → GPSC with `labels:[Prelims]`, Dy.So with `labels:[]`.

Envelope for every response is the standard
`{ success, code, data, message, messages }`.
