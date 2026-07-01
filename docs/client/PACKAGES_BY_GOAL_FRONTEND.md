# Display Packages by Goal — Frontend Guide

**Status:** Backend ready (staging). **Last updated:** 2026-07-01

How the client app shows **packages for the customer's selected goals** — whether a goal
**has labels** (e.g. `Prelims`, `Mains`) or **has no labels** at all. One endpoint handles
both; you just pick the right query param per goal.

> Requires a **Bearer token** (`Authorization: Bearer <client_token>`).
> Base path: `/api/v1/client`.

---

## The one rule to remember

A goal's packages hang off **different things** depending on whether it has labels:

| The goal… | Packages belong to | Call with | You get back |
|---|---|---|---|
| **has labels** | each **label** inside it | `?labelIds=<goalId>:<labelId>,…` | `{ "label": { … } }` groups |
| **has NO labels** | the **goal itself** | `?goalIds=<goal _id>,…` | `{ "goal": { … } }` groups |

> ⚠️ **Label ids are per-goal** — every goal numbers its labels from `1`, so the same
> label id (e.g. `1`) exists under many goals. You **must** send each label goal-scoped as
> **`goalId:labelId`** (e.g. `19:1`), otherwise the server can't tell which goal's label
> you mean and may return packages from a different goal.
>
> A bare `labelId` (e.g. `1`) is still accepted for backward compatibility, but it is
> **ambiguous** — don't use it. Always send `goalId:labelId`.

> ⚠️ A **label-less goal is NEVER sent via `labelIds`** — it has no label ids. Send its
> goal `_id` via `goalIds` instead. Sending an empty `labelIds` returns nothing for it.

---

## Step 1 — Know each goal's labels

Read the customer's selection first:

`GET /api/v1/client/goals/my-goals`

```json
[
  { "_id": "1", "title": "GPSC Class 1/2", "labels": [ { "_id": "1", "name": "Prelims" } ] },
  { "_id": "2", "title": "Dy.So", "labels": [] }
]
```

- `labels` non-empty → goal **with** labels.
- `labels: []` → goal **without** labels.

---

## Step 2 — Bucket the ids

```js
const labelIds = [];
const goalIds  = [];

for (const goal of myGoals) {
  if (goal.labels.length > 0) {
    // goal WITH labels → send each as goalId:labelId (per-goal ids!)
    labelIds.push(...goal.labels.map(l => `${goal._id}:${l._id}`));
  } else {
    goalIds.push(goal._id);                          // goal WITHOUT labels
  }
}
```

---

## Step 3 — One call for the packages

`GET /api/v1/client/packages/goal`

Send whichever buckets are non-empty (both may go together):

```
GET /client/packages/goal?labelIds=19:1&goalIds=2
```

- **At least one** of `labelIds` / `goalIds` is required — sending neither returns `400`.
- Omit a param entirely when its bucket is empty (don't send `labelIds=`).
- Both are comma-separated lists of ids.

---

## Step 4 — Render the response

The `data` array mixes two item types. **Tell them apart by the wrapper key** (`label`
vs `goal`):

```json
{
  "success": true,
  "data": [
    { "label": { "_id": "1", "name": "Prelims", "goalId": "1", "goalTitle": "GPSC Class 1/2", "packages": [ /* … */ ] } },
    { "goal":  { "_id": "2", "title": "Dy.So", "packages": [ /* … */ ] } }
  ]
}
```

- `item.label` → render under the label's `goalTitle`, headed by the label `name`.
- `item.goal` → render as a standalone goal section headed by `goal.title` (this is the
  **label-less** goal).

```js
for (const item of res.data) {
  if (item.label) {
    // Section: item.label.goalTitle  ›  item.label.name  →  item.label.packages
  } else if (item.goal) {
    // Section: item.goal.title  →  item.goal.packages
  }
}
```

> **Empty `packages: []`?** The group is still returned with the correct `name`/`title` —
> there just aren't any active packages tagged to it yet. Show "no packages", **not** an
> error.

---

## End-to-end example

1. `GET /client/goals/my-goals` →
   `Defence` (`_id 19`) with `labels:[{_id:1,Teaching}]`, and `Dy.So` (`_id 2`) with `labels:[]`.
2. Bucket → `labelIds = ["19:1"]`, `goalIds = ["2"]`.
3. `GET /client/packages/goal?labelIds=19:1&goalIds=2`.
4. Render the `{label:…}` group under *Defence › Teaching*, and the `{goal:…}`
   group as the *Dy.So* section.

---

## Quick reference

| Case | Call | Response item shape |
|---|---|---|
| Goal **with** labels | `GET /client/packages/goal?labelIds=<goalId>:<labelId>,…` | `{ label: { _id, name, goalId, goalTitle, packages } }` |
| Goal **without** labels | `GET /client/packages/goal?goalIds=…` | `{ goal: { _id, title, packages } }` |
| Mixed selection | `GET /client/packages/goal?labelIds=19:1&goalIds=2` | both of the above in one `data` array |

Envelope for every response is the standard
`{ success, code, data, message, messages }`.

See also: [`GOALS_FRONTEND_INTEGRATION.md`](./GOALS_FRONTEND_INTEGRATION.md) for reading/
writing the goal selection itself.
