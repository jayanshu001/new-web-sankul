# "Add / Edit Video Category" Modal — UI Change Spec

This doc describes the **UI changes** required in the Admin Dashboard modal because the backend now supports **multiple child categories** per video category.

## TL;DR

Replace the single **"Child Category"** dropdown with a **multi-select** that lets the user pick zero, one, or many child categories. Submit the value as `childCategoryIds` (array). Everything else in the modal stays the same.

## What changed on the backend

| Old (single)                                   | New (multiple)                                       |
| ---------------------------------------------- | ---------------------------------------------------- |
| Field: `childCategoryId` (string or null)      | Field: `childCategoryIds` (array of strings)         |
| Response: `data.child_category: { id, name }`  | Response: `data.child_categories: [{ id, name }]`    |

The endpoints are unchanged:
- `POST /api/v1/admin/video-categories`
- `PUT  /api/v1/admin/video-categories/:id`
- `GET  /api/v1/admin/video-categories` (returns `child_categories: []`)
- `GET  /api/v1/admin/video-categories/pre-requisites` (returns the option list for the dropdown — unchanged)

See full API contract in [VIDEO_CATEGORY_ADMIN.md](VIDEO_CATEGORY_ADMIN.md).

## Modal changes

### 1. Replace the dropdown component

**Before** — single-select dropdown labelled "Child Category":

```
[ Child Category ▾ ]   (one value or "None")
```

**After** — multi-select with chips:

```
[ Child Categories ▾ ]
  ┌────────────────────────────────────────────────┐
  │  ✕ Algebra   ✕ Geometry   ✕ Trigonometry      │
  └────────────────────────────────────────────────┘
  + Add more...
```

Recommended component: a multi-select with search and removable chips (e.g. `react-select` with `isMulti`, MUI `Autocomplete multiple`, Ant Design `Select mode="multiple"`).

### 2. Field label and helper text

- Label: **"Child Categories"** (plural)
- Helper: *"Select one or more sub-categories that belong under this category. Leave empty for none."*
- Placeholder: *"Search and select child categories…"*

### 3. Option source

Unchanged — still call:

```
GET /api/v1/admin/video-categories/pre-requisites
→ data.categories: [{ id, name }, ...]
```

When **editing** an existing category, **exclude the current category's own id** from the option list (you cannot make a category a child of itself).

### 4. Pre-filling on edit

The detail/list response now returns `child_categories` as an array. Map it to the selected values:

```ts
// Before
form.childCategoryId = data.child_category?.id ?? null;

// After
form.childCategoryIds = (data.child_categories ?? []).map((c) => c.id);
```

### 5. Submitting the form

The backend accepts any of these encodings — pick whichever fits your form library:

```ts
// JSON body (preferred if you're not uploading a file in the same request)
{ childCategoryIds: ["66f...01", "66f...02"] }
```

```ts
// multipart/form-data (when the image file is also being uploaded)
formData.append("childCategoryIds", "66f...01");
formData.append("childCategoryIds", "66f...02");

// OR bracket-style — also accepted:
formData.append("childCategoryIds[]", "66f...01");
formData.append("childCategoryIds[]", "66f...02");

// OR a single comma-separated string — also accepted:
formData.append("childCategoryIds", "66f...01,66f...02");
```

To **clear** all child categories on update, send an empty array (or omit the field entirely — the form library convention is up to you, but the backend treats "undefined" as "no change" and `[]` as "replace with empty").

### 6. Validation messages

The backend may respond with `422` and an `errors` map. New cases to handle on the form:

| Backend message                                          | Show under field          |
| -------------------------------------------------------- | ------------------------- |
| `errors.childCategoryIds: "Invalid id"`                  | "Invalid child category." |
| `"One or more childCategoryIds are invalid"`             | "One or more selected child categories no longer exist. Refresh and try again." |
| `"childCategoryIds cannot include the category itself"`  | "A category cannot be its own child." (defensive — also prevent in UI) |

### 7. List/table column update

In the list view, the column previously showing a **single** child category should now render a **comma-joined list** (or chip group) from `child_categories`:

```tsx
<td>
  {row.child_categories.length === 0
    ? "—"
    : row.child_categories.map((c) => c.name).join(", ")}
</td>
```

### 8. List filter (optional)

The query param `childCategoryId=<id>` still exists and now matches *"any category whose `child_categories` includes this id"*. No change required on the filter UI — keep it as a single-select if that's what it was.

## Quick checklist for the frontend

- [ ] Swap single-select → multi-select component
- [ ] Update label to **"Child Categories"** (plural)
- [ ] On edit, prefill from `data.child_categories[].id`
- [ ] Submit `childCategoryIds` as an array (multipart or JSON)
- [ ] Exclude the current category's own id from options when editing
- [ ] Update list/table cell to render multiple
- [ ] Update form-error mapping for new messages

## Mockup (ASCII)

```
┌─────────────────────────────────────────────────────┐
│  Add / Edit Video Category                       ✕  │
├─────────────────────────────────────────────────────┤
│  Name           [ Maths                          ]  │
│  Slug           [ maths                          ]  │
│  Image          [ choose file…   ]  ▢ preview       │
│  Educator       [ Select educator              ▾ ]  │
│                                                     │
│  Child Categories                                   │
│  ┌─────────────────────────────────────────────┐    │
│  │ ✕ Algebra   ✕ Geometry   ✕ Trigonometry    │ ▾  │
│  └─────────────────────────────────────────────┘    │
│  Select one or more sub-categories.                 │
│                                                     │
│  Order          [ 0    ]                            │
│  Status         (●) Active   ( ) Inactive           │
│                                                     │
│                       [ Cancel ]   [ Save ]         │
└─────────────────────────────────────────────────────┘
```
