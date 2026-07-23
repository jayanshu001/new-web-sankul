# Setting Up the Share Subdomain

> `<SHARE_HOST>` is a placeholder for the share subdomain, which is **not decided yet**
> (e.g. `share.<your-domain>` or `links.<your-domain>`). Replace every occurrence once the
> name is chosen — it appears in DNS, the TLS cert, the web-server config, `SHARE_BASE_URL`,
> the iOS Associated Domains entitlement and the Android intent-filter.

---

## Why we need this

When a student taps **Share** on a course, the app sends a link like:

```
https://websankul-api.4tysixapplabs.com/share/courses/123
```

That link sits on our **API domain** — the same host that serves `/api/v1/...`. We want it on its
own subdomain instead. Here's why, strongest reason first.

### 1. The apps can't open reliably without it

When someone taps a share link, the phone has to decide: *open the app, or open the browser?*

It answers that by downloading a small verification file **from the exact domain in the link** —
`apple-app-site-association` on iOS, `assetlinks.json` on Android. If that domain doesn't exist, or
doesn't serve the file properly, the phone can't confirm the app owns the link.

On iOS that isn't a minor degradation. Our share page has no fallback for iOS, so a user who
**already has the app installed** is sent to the **App Store** instead. The iOS team also cannot
test their side of the work at all until this domain is live.

### 2. Our API domain is currently registered as the apps' link domain

Both apps were claiming *every* URL on `websankul-api.4tysixapplabs.com` — including `/api/v1/...` —
as belonging to the app. We've already narrowed that in code, but the clean end-state is for the
apps to be associated with a domain that serves **only** share pages, never the API.

### 3. Public pages shouldn't live on the API host

Share links get pasted into WhatsApp and Telegram, where link-preview bots and crawlers fetch them
automatically. That traffic currently lands on the API host. On its own host we can cache and
throttle it separately, and lock the API host down harder.

### 4. It looks like a real product

`<SHARE_HOST>/share/courses/123` reads as something a person can trust.
`websankul-api.4tysixapplabs.com/share/courses/123` reads as plumbing, and costs clicks.

---

## What this actually involves

Less than it sounds. **One new subdomain pointing at the server we already run:**

1. A **DNS record** so the name resolves to the existing server
2. An **SSL certificate** for it
3. A **routing rule** so the name serves only the share pages and the two verification files

**No new server. No new deployment. No code change.** It's the same backend answering on a second
name — roughly a 30-minute job.

| Who | What |
|---|---|
| **Infra / sysadmin** | Everything below |
| **Backend** | Already done in code — nothing further until the cutover |
| **iOS team** | Blocked until this is live (`docs/client/SHARE_DEEPLINK_FRONTEND.md`) |
| **Android team** | Optional work, also blocked until live |

**If we don't do it:** nothing breaks. Share links keep working on the API domain exactly as today.
We simply keep the wildcard coupling, the unbranded links, and the crawler traffic on the API host.
This is planned hardening, not an outage fix — schedule it normally.

---

# Setup

The app listens on **`127.0.0.1:4001`** (`PORT=4001`). The share host proxies to that same backend.

## Step 1 — DNS

| Type | Name | Value |
|---|---|---|
| A (+ AAAA if used) | `<SHARE_HOST>` | same IP the API host resolves to |

A `CNAME` to the API host works too. Confirm before continuing:

```bash
dig +short <SHARE_HOST>
```

## Step 2 — TLS certificate

```bash
sudo certbot certonly --webroot -w /var/www/certbot -d <SHARE_HOST>
```

The certificate must be valid with a complete chain. Phones fail link verification **silently** on a
bad certificate — no error message anywhere.

## Step 3 — Web server

`/etc/nginx/sites-available/<SHARE_HOST>` → symlink into `sites-enabled/`:

```nginx
server {
    listen 80;
    server_name <SHARE_HOST>;

    # ACME challenge must be served from disk, ahead of the catch-all redirect.
    location ^~ /.well-known/acme-challenge/ { root /var/www/certbot; }

    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl;
    http2 on;
    server_name <SHARE_HOST>;

    ssl_certificate     /etc/letsencrypt/live/<SHARE_HOST>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<SHARE_HOST>/privkey.pem;

    # ─────────────────────────────────────────────────────────────────────────
    # CRITICAL: pass the original Host header through.
    #
    # The backend decides "did this request arrive on the share host?" by reading
    # req.hostname (src/utils/shareBase.ts + the /share gate in src/app.ts). If
    # nginx rewrites Host to 127.0.0.1, the backend concludes the request came in
    # on the wrong host and 301-redirects it to the share host — which comes
    # straight back here. That is an infinite redirect loop. Do not remove this.
    # ─────────────────────────────────────────────────────────────────────────
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;

    # The two files the phones fetch to verify the app owns this domain.
    # MUST return 200 + application/json with NO redirect — any 3xx and both
    # iOS and Android silently refuse to verify.
    location = /.well-known/apple-app-site-association { proxy_pass http://127.0.0.1:4001; }
    location = /.well-known/assetlinks.json            { proxy_pass http://127.0.0.1:4001; }

    # The share pages themselves.
    location /share/ { proxy_pass http://127.0.0.1:4001; }

    # This host serves nothing else. In particular it is NOT an API endpoint —
    # exposing /api/v1 here would defeat the whole point of the split.
    location / { return 404; }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

**The API host's existing config needs no change.** It keeps serving `/share/*`, and the backend
redirects those to the share host once the env var below is switched.

## Step 4 — Backend env var

In the **production** `.env` (not `ecosystem.config.cjs` — that only carries PM2 topology flags):

```bash
# Now — deploy-safe, reproduces today's behaviour exactly:
SHARE_BASE_URL=https://websankul-api.4tysixapplabs.com

# Later, at cutover — only after the iOS release has shipped and users have updated:
SHARE_BASE_URL=https://<SHARE_HOST>
```

> ⚠ **This variable is required in production.** It is in `REQUIRED_IN_PROD`, and
> `validateEnvOrExit()` calls `process.exit(1)` when a required variable is missing — **the service
> will refuse to start without it.** Set it before or together with the first deploy of this change.

Restart: `pm2 reload ecosystem.config.cjs --env production`

## Step 5 — Verify

```bash
# verification files: 200, application/json, and NO redirect
curl -sI https://<SHARE_HOST>/.well-known/apple-app-site-association
curl -sI https://<SHARE_HOST>/.well-known/assetlinks.json

# share page renders
curl -s -o /dev/null -w "%{http_code}\n" https://<SHARE_HOST>/share/courses/1      # 200

# the share host must NOT be an API
curl -s -o /dev/null -w "%{http_code}\n" https://<SHARE_HOST>/api/v1/client/ebooks # 404

# no redirect loop (the Host-header mistake shows up here as a long 301 chain)
curl -sIL --max-redirs 5 https://<SHARE_HOST>/share/courses/1 | grep -c "^HTTP"     # 1

# after cutover: old links redirect to the share host
curl -sI https://websankul-api.4tysixapplabs.com/share/courses/1 | grep -i "^HTTP\|^location"
```

---

## If you're not on nginx

- **DigitalOcean Load Balancer / App Platform** — add the hostname and certificate, forward the same
  paths, and confirm the original `Host` header is preserved (it is by default on DO LB).
- **Cloudflare in front** — add the DNS record (proxied is fine), and make sure `/.well-known/*` is
  not cached, redirected, or caught by "Always Use HTTPS" in a way that adds a 3xx to that path.

Whatever the proxy, the two non-negotiables are: **preserve the `Host` header**, and **no redirect
on `/.well-known/*`**.

---

**Related:** [`../SHARE_DOMAIN_SEPARATION.md`](../SHARE_DOMAIN_SEPARATION.md) (full backend plan) ·
[`../client/SHARE_DEEPLINK_FRONTEND.md`](../client/SHARE_DEEPLINK_FRONTEND.md) (app integration)
