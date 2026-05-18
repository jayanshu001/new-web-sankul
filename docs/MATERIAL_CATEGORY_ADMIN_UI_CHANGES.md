# "Add / Edit Material Category" Modal — UI Change Spec

This doc describes the **UI changes** required in the Admin Dashboard modal so an admin can attach **multiple child categories** to a material category from a single screen.

> **Status:** *Backend implemented.* `POST /api/v1/admin/materials/categories` and `PUT /api/v1/admin/materials/categories/:id` now accept the optional `childCategoryIds` field. Frontend can integrate.

## Why this is different from Video Categories

Material Categories use a **classic parent-pointer tree** (`parent` + `ancestors[]`) — unlike Video Categories which now store `childCategoryIds[]` directly on the parent. So we are **not** changing the schema. Instead, we are adding a convenience field on the modal: the admin picks one or more existing categories, and the backend re-parents each of them to the category being created/edited.

| Current state                                                       | After this change                                                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| To make Category B a child of A, you edit B and set `parent = A`.   | You can open A's modal, multi-pick `[B, C, D]`, and the backend sets their `parent = A` in bulk. |
| One child at a time.                                                | Many at once.                                                                                    |
| Existing `parent` field still works for the reverse direction.      | `parent` field on the modal is unchanged — keep it as today.                                     |

## What the backend will accept

New optional field on:

```
POST /api/v1/admin/materials/categories
PUT  /api/v1/admin/materials/categories/:id
```

| Field              | Type        | Required | Description                                                                                                  |
| ------------------ | ----------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `childCategoryIds` | ObjectId[]  | no       | List of existing `MaterialCategory` ids whose `parent` will be set to this category (and ancestors rebuilt). |

### Encodings accepted (same as Video Categories)

```http
# JSON
{ "childCategoryIds": ["66f...01", "66f...02"] }

# multipart / urlencoded — repeated keys
childCategoryIds=66f...01
childCategoryIds=66f...02

# bracket keys
childCategoryIds[]=66f...01
childCategoryIds[]=66f...02

# comma-separated
childCategoryIds=66f...01,66f...02
```

### Server-side rules (informational for FE error mapping)

- Every id must be a valid 24-char ObjectId and must exist.
- A category cannot be its own child.
- A category's **ancestor** cannot be selected as a child (would create a cycle).
- Duplicates are de-duplicated.
- On update, the field **replaces** the explicit "attach these now" set; it does **not** unparent the category's other existing children. To remove a child from this parent, edit that child and clear/change its `parent` (existing flow).

## Modal changes

### 1. Add a new "Child Categories" multi-select

Place it directly below the existing **Parent** dropdown.

```
┌──────────────────────────────────────────────────────┐
│  Add / Edit Material Category                     ✕  │
├──────────────────────────────────────────────────────┤
│  Title          [ Notes - Class 10                ]  │
│  Slug           [ notes-class-10                  ]  │
│  Image          [ choose file…   ]  ▢ preview        │
│                                                      │
│  Parent         [ (none) ▾ ]                         │
│                                                      │
│  Child Categories                            (NEW)   │
│  ┌──────────────────────────────────────────────┐    │
│  │ ✕ Maths Notes   ✕ Science Notes   ✕ Hindi   │ ▾  │
│  └──────────────────────────────────────────────┘    │
│  These categories will be moved under this one.      │
│                                                      │
│  Order          [ 0    ]                             │
│  Status         (●) Active   ( ) Inactive            │
│                                                      │
│                        [ Cancel ]   [ Save ]         │
└──────────────────────────────────────────────────────┘
```

- **Label:** "Child Categories"
- **Helper:** "Select one or more existing categories to move under this one. Their parent will be updated on save."
- **Placeholder:** "Search and select categories…"
- Component: multi-select with search + removable chips.

### 2. Option source

Use the existing list endpoint (tree mode is fine):

```
GET /api/v1/admin/materials/categories?limit=200
```

Map options as `{ id, title }`.

### 3. Options to exclude from the picker

When opening the modal, hide these from the dropdown so the admin can't pick invalid candidates:

- **The category itself** (only relevant when editing).
- **Any ancestor of the category** (would create a cycle).
- **The category's current parent**, if you want to be strict (optional; the backend will accept it as a no-op since `parent` is already this category — but excluding keeps the UI clean).

If your list endpoint returns `ancestors[]`, computing this client-side is trivial. Otherwise fetch the category's `ancestors` via `GET /api/v1/admin/materials/categories/:id`.

### 4. Pre-filling on edit

Two reasonable UX choices — **pick one** and be consistent:

| UX choice                                       | Behaviour                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **A. Always start empty (Recommended)**         | The field is a "what to attach now" action, not a snapshot. Existing children stay; modal doesn't list them. Avoids the user accidentally detaching a child by removing its chip. |
| B. Prefill with current direct children         | Fetch `GET /api/v1/admin/materials/categories?parent=<id>&limit=200`. Removing a chip would require the FE to send a separate "detach" call (backend does **not** unparent on this field). |

Going with **A** keeps the contract clean: the field is *additive*.

### 5. Submitting

Use whichever encoding fits the form library; if uploading an image in the same request, use multipart with repeated keys. Examples:

```ts
// JSON (no file upload in same request)
{ title, parent, order, status, childCategoryIds: ["66f...01", "66f...02"] }
```

```ts
// multipart (with image file)
formData.append("title", title);
formData.append("childCategoryIds", "66f...01");
formData.append("childCategoryIds", "66f...02");
```

### 6. Error mapping

| Backend response                                                               | Show under field                                                            |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `errors.childCategoryIds: "Invalid id"`                                        | "Invalid child category selection."                                         |
| `"One or more childCategoryIds are invalid"` (422)                             | "One or more selected categories no longer exist. Refresh and try again."   |
| `"A category cannot be its own child"` (422)                                   | "Cannot select this category." (defensive — also prevent in UI)             |
| `"Cycle detected: <title> is an ancestor of this category"` (422)              | "<title> is already a parent of this category and can't be made a child."   |

### 7. Confirmation copy on save (recommended)

Because picking a child here **re-parents** it (a side-effect on other rows), show a confirmation dialog before submit when `childCategoryIds.length > 0`:

```
You are about to move 3 categories under "Notes - Class 10":
  • Maths Notes
  • Science Notes
  • Hindi
Their previous parent will be replaced. Continue?
[ Cancel ]   [ Move and Save ]
```

### 8. List/table view

No change needed. The existing list/tree view already reflects parent → child relationships and will refresh after save.

## Quick checklist for the frontend

- [ ] Add a multi-select labelled **"Child Categories"** below the Parent field
- [ ] Helper text explains the re-parent side-effect
- [ ] Exclude self + ancestors from the option list
- [ ] Start empty on edit (UX choice A)
- [ ] Submit `childCategoryIds` (array, any accepted encoding)
- [ ] Confirmation dialog when the field is non-empty
- [ ] Map the new error messages

## Backend follow-up (out of scope for FE, listed for completeness)

When the backend lands, it will:

1. Validate every id in `childCategoryIds` (exists, not self, not an ancestor).
2. For each id, set `parent = <this category's _id>` and recompute `ancestors`.
3. Recursively rewrite `ancestors` on each moved category's descendants (since their ancestry path changes).
4. Wrap the whole thing in a transaction.

Source files involved (for future implementation):

- Model: [src/models/course/MaterialCategory.model.ts](../src/models/course/MaterialCategory.model.ts)
- Controller: [src/admin/material/material.controller.ts](../src/admin/material/material.controller.ts) — extend `createCategory` and `updateCategory`
- Validation: [src/admin/material/material.validation.ts](../src/admin/material/material.validation.ts) — add `childCategoryIds` field
- Routes: [src/admin/material/material.routes.ts](../src/admin/material/material.routes.ts) — no change needed
