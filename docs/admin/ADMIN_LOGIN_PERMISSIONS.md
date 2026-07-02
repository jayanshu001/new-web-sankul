# Admin Login — Effective Permissions in the Response (Frontend Contract)

**Status:** Implemented. Applies to `POST /api/v1/admin/auth/login`,
`POST /api/v1/admin/auth/refresh`, and `PUT /api/v1/admin/auth/profile` — all
return the same `admin` object.

---

## 1. Response shape

```jsonc
{
  "success": true,
  "data": {
    "token": "...",
    "refreshToken": "...",
    "admin": {
      "id": "52",
      "firstName": "...",
      "lastName": "...",
      "email": "editor@websankul.com",
      "role": "editor",                        // primary role (string)
      "roles": ["editor"],                     // all assigned role names (string[])
      "permissions": ["books.create", "books.edit", "courses.view"],
      // ^ effective, de-duplicated permission KEYS (role grants + direct grants)
      "image": "",
      "isDark": false
    }
  }
}
```

- `roles` — **flat `string[]`** of assigned role names.
- `permissions` — **flat `string[]`** of the **effective, resolved** permission
  keys: everything granted through the user's role(s) (merged from
  `ws_role_has_permissions`) plus any directly-assigned per-user permissions,
  de-duplicated and sorted. Same dotted keys as the Permissions catalog, so
  `permissions.includes("books.edit")` matches exactly.
- `permissions` is **always present**. `[]` means "no permissions" (never omitted).

## 2. Super-admin

Super-admins return the wildcard:

```jsonc
"role": "super_admin",
"roles": ["super-admin"],
"permissions": ["*"]
```

Recommended client check:

```ts
const can = (key: string) =>
  admin.permissions.includes("*") || admin.permissions.includes(key);
```

> Why a wildcard: the **API enforces roles, not permission keys** — permission
> keys exist for the catalog + the panel UI only. Super-admin bypasses
> per-permission gating, so `["*"]` keeps the payload small and stable as the
> catalog grows. (If you ever need the full explicit list instead, ask backend —
> it's a one-line switch.)

## 3. Notes / changes from before

- **Breaking shape change (intended):** `roles` and `permissions` used to be
  arrays of objects (`{_id,name,...}`). They are now flat string arrays as
  specified. Only the **auth** responses changed; the administrator-management
  endpoints (`GET/POST /admin/administrators`, roles/permissions CRUD) keep their
  existing object shapes.
- **Effective set fix:** previously `permissions` only contained *directly*
  assigned perms, so role-based admins often saw `[]`. It now includes
  role-derived permissions.
- There is **no `GET /admin/auth/me`** — the `admin` object is returned only on
  login, refresh, and profile-update. If the panel needs to re-fetch permissions
  without re-login (e.g. after a role change elsewhere), ask backend to add one.

## 4. Where it's built (backend reference)

| File | Role |
|---|---|
| `src/admin/auth/admin.auth.service.ts` → `buildSqlAdminDto()` | Unions role + direct perms into the effective set |
| `src/modules/admin-auth/admin-auth.repository.ts` → `findRolePermissions()` | Resolves role → permission via `ws_role_has_permissions` |
| `src/modules/admin-auth/admin-auth.transformer.ts` → `toAdminDto()` | Flattens to string keys; super-admin → `["*"]` |
