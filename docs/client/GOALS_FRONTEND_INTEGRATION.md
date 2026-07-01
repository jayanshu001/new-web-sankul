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

## 4. Show packages for the selected goals (labels vs. no labels)

Once you know the customer's selection (from §3), fetch the packages to display with:

`GET /api/v1/client/packages/goal`

This endpoint takes **two independent, comma-separated query params** — and *which one you
use depends on whether the goal has labels*:

| The selected goal… | …means | Call with | You get back |
|---|---|---|---|
| **has labels** (`labels` non-empty in `my-goals`) | packages hang off each **label** | `?labelIds=<goalId>:<labelId>,…` | `{ "label": { … } }` groups |
| **has no labels** (`labels: []` in `my-goals`) | packages hang off the **goal itself** | `?goalIds=<goal _id>` | `{ "goal": { … } }` groups |

> **Key rule 1 — label ids are per-goal.** Every goal numbers its labels from `1`, so the
> same label id exists under many goals. Send each label **goal-scoped** as
> `goalId:labelId` (e.g. `19:1`), never a bare label id. A bare id still works for
> backward compatibility but is **ambiguous** across goals — don't rely on it.
>
> **Key rule 2 — a label-less goal is never sent via `labelIds`.** It has no label ids to
> send. Use its goal `_id` via `goalIds` instead. An empty `labelIds` returns nothing for it.

### How the frontend decides (per selected goal)

After `GET /client/goals/my-goals`, loop the returned goals and bucket them:

```js
const labelIds = [];
const goalIds  = [];

for (const goal of myGoals) {
  if (goal.labels.length > 0) {
    // goal WITH labels → collect each label goal-scoped as goalId:labelId
    labelIds.push(...goal.labels.map(l => `${goal._id}:${l._id}`));
  } else {
    // goal WITHOUT labels → use the goal id itself
    goalIds.push(goal._id);
  }
}
```

Then make **one** call with whichever buckets are non-empty (both may be sent together):

```
GET /client/packages/goal?labelIds=19:1&goalIds=2
```

- At least one of `labelIds` / `goalIds` is **required** — sending neither returns `400`.
- Omit a param entirely when its bucket is empty (don't send `labelIds=`).

### Response shape

The `data` array mixes two item types — **distinguish them by the wrapper key**
(`label` vs `goal`):

```json
{
  "success": true,
  "data": [
    { "label": { "_id": "1", "name": "Prelims", "goalId": "1", "goalTitle": "GPSC Class 1/2", "packages": [ /* … */ ] } },
    { "label": { "_id": "2", "name": "Mains",   "goalId": "1", "goalTitle": "GPSC Class 1/2", "packages": [ /* … */ ] } },
    { "goal":  { "_id": "2", "title": "Dy.So", "packages": [ /* … */ ] } }
  ]
}
```

Render on the client:

- `item.label` groups → show under the label's `goalTitle`, headed by the label `name`.
- `item.goal` groups (the **label-less** goals) → show as a standalone goal section headed
  by `goal.title`.

> **Empty `packages: []`?** The group is still returned (with the correct `name`/`title`),
> there just aren't any active packages tagged to that label/goal yet. That's a
> content/data state to show as "no packages", **not** an error.

### End-to-end example

1. `GET /client/goals/my-goals` →
   `[ { "_id":"19","title":"Defence","labels":[{"_id":"1","name":"Teaching"}] },
      { "_id":"2","title":"Dy.So","labels":[] } ]`
2. Bucket → `labelIds = ["19:1"]` (Defence › Teaching), `goalIds = ["2"]` (Dy.So has no labels).
3. `GET /client/packages/goal?labelIds=19:1&goalIds=2`.
4. Render the `{label:…}` group under *Defence › Teaching*, and the `{goal:…}` group
   as the *Dy.So* section.

---

## Quick reference

| Action | Method & path | Body / result |
|---|---|---|
| List selectable goals | `GET /client/goals` | `[{ _id, title, image, labels:[{_id,name}] }]` |
| **Save selection** (profile) | `PUT /client/profile/update` | `{ goals: [{ goalId, labelIds }], ...profile }` |
| **Save selection** (goals-only) | `PUT /client/goals` | `{ goals: [{ goalId, labelIds }] }` |
| Read selection | `GET /client/goals/my-goals` | selected goals + selected labels only |
| Read selection (profile) | `GET /client/profile` | `data.goals: [{ _id, name, labels }]` |
| **Packages — goal WITH labels** | `GET /client/packages/goal?labelIds=<goalId>:<labelId>,…` | `[{ label: { _id, name, goalId, goalTitle, packages } }]` |
| **Packages — goal WITHOUT labels** | `GET /client/packages/goal?goalIds=…` | `[{ goal: { _id, title, packages } }]` |

## Round-trip example

1. `GET /client/goals` → user sees `GPSC Class 1/2` (labels Prelims, Mains) and `Dy.So`.
2. User picks GPSC → Prelims only, and Dy.So.
3. `PUT /client/profile/update` with
   `{ "goals": [ { "goalId": "1", "labelIds": ["1"] }, { "goalId": "2", "labelIds": [] } ] }`.
4. `GET /client/goals/my-goals` → GPSC with `labels:[Prelims]`, Dy.So with `labels:[]`.

Envelope for every response is the standard
`{ success, code, data, message, messages }`.
