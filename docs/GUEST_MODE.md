# Guest mode

## What we did

- Added "Login as Guest". A person can browse the app without an account: home, courses,
  packages, books, ebooks, free content, live course listings, test series, search.
- When the app asks for it, the server gives one fixed guest token. The app sends that token
  with every request, the same way it sends a login token.
- A Guest sees every item as "not purchased".
- Profile, orders, cart, payments, video playback, downloads and every save or change still
  need a real login.
- Logged-in users and admins are not affected.
- The guest token never expires on its own. It works only while guest mode is on.
- No database change. No setting in the server's `.env` file.

## How to enable

In the Firebase console, Realtime Database, node `maintain`, set:

```
env = "staging"
```

Takes effect within seconds. No restart, no server access needed.

## How to disable

In the same Firebase node, set:

```
env = "production"
```

Takes effect within seconds. From then on:

- "Login as Guest" is refused.
- The guest token stops working on every screen.
- Everything else works as usual.

## Guest token lifetime

The guest token never expires by time. It is one fixed token, the same for every user, but it
is only usable while guest mode is on.

| Situation | Guest token |
|---|---|
| Firebase `env` is `"staging"` | Works |
| Firebase `env` is `"production"` | Stops working everywhere |
| `env` set back to `"staging"` later | The same old token works again |
| The server's signing key is changed | Old token is dead for good; the app gets a new one from "Login as Guest" |
| Token used on a different server with a different signing key | Rejected; each server gives its own token |

## Check the current state

```bash
curl -s -X POST -o /dev/null -w "%{http_code}\n" https://<server>/api/v1/client/auth/guest
```

`200` = on. `403` = off.

## Things to know

- **All servers follow the same Firebase value, production included.** While `env` is
  `"staging"`, guest login also works on production.
- **If the server cannot reach Firebase, guest mode is off.**
- **Anyone who can edit the Firebase `maintain` node controls guest mode.** Keep it
  write-protected from app users.
- **One guest cannot be blocked alone.** The token is shared by all Guests. Turning guest mode
  off blocks all of them.
