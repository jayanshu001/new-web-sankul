# Profile Completion Flag (`isProfileCompleted`)

Frontend guide for deciding when to show the **"Complete Your Profile"** screen
after OTP login.

## Background

Earlier, email was mandatory and the app used `isNewUser` (derived from the
`verified` flag) to route a user to the profile screen. Email is now **optional**,
so `isNewUser`/`verified` is no longer a reliable signal — a user can verify OTP
(`verified = true`, so `isNewUser = false`) while still having an empty profile.

To fix this, the user object now carries a dedicated boolean: **`isProfileCompleted`**.
Use this flag — not `isNewUser` — to decide routing.

## The two flags, side by side

| Field               | Meaning                                                        | Use it for                          |
| ------------------- | -------------------------------------------------------------- | ----------------------------------- |
| `isNewUser`         | `true` if this is the user's first-ever OTP verification.      | First-login analytics / greeting.   |
| `isProfileCompleted`| `true` once the user has filled the required profile fields.   | **Routing to Complete-Your-Profile.** |

A user can be `isNewUser: false` (logged in before) but still
`isProfileCompleted: false` (never finished the profile) — in that case you
**still** show the profile screen.

## Where the flag appears

`isProfileCompleted` is returned on the `user` object in every auth/profile response:

- `POST /api/v1/auth/otp/validate` — OTP login (`response.data.user.isProfileCompleted`)
- `POST /api/v1/auth/otp/refresh` — token refresh (`response.data.customer.isProfileCompleted`)
- `GET  /api/v1/customer/profile` — fetch profile
- `PUT  /api/v1/customer/profile` — update profile (returns the recomputed flag)

### Example: OTP validate response

```jsonc
{
  "status": true,
  "message": "Login successful.",
  "data": {
    "user": {
      "id": "665f...",
      "firstName": "",
      "lastName": "",
      "phoneNumber": "9876543210",
      "emailAddress": "",
      // ...other profile fields...
      "isNewUser": true,
      "isProfileCompleted": false   // 👈 show "Complete Your Profile"
    },
    "accessToken": "eyJ...",
    "refreshToken": "eyJ...",
    "isNewUser": true
  }
}
```

## Frontend logic

After a successful OTP validation:

```ts
const { user } = response.data;

if (!user.isProfileCompleted) {
  navigateTo("CompleteYourProfile");
} else {
  navigateTo("Home");
}
```

> Do **not** branch on `isNewUser` for this decision. A returning user who never
> completed their profile must still land on the profile screen.

## When does `isProfileCompleted` become `true`?

The backend marks the profile complete once the **required fields are filled**:
currently **`firstName` and `lastName`** are both present (email is optional and
does not affect this). The flag is recomputed and persisted whenever the user
submits `PUT /api/v1/customer/profile`.

So the typical flow is:

1. User logs in → `isProfileCompleted: false` → app shows the profile screen.
2. User submits `firstName` + `lastName` (and optionally email, etc.) via
   `PUT /api/v1/customer/profile`.
3. The update response returns `isProfileCompleted: true`.
4. Store this on the client; on subsequent logins the flag stays `true` and the
   profile screen is skipped.

```ts
// After submitting the profile form
const { data } = await api.put("/api/v1/customer/profile", form);
if (data.data.isProfileCompleted) {
  navigateTo("Home");
}
```

## Existing (old) users

Users who already existed before this change are treated as **completed**
(`isProfileCompleted: true`) — they are never re-routed to the profile screen.
No action needed on the frontend for them.

## TL;DR

- Read `user.isProfileCompleted` from any auth/profile response.
- `false` → show **Complete Your Profile**; `true` → go **Home**.
- It flips to `true` once `firstName` + `lastName` are saved via the profile update endpoint.
- Ignore `isNewUser` for this routing decision.
