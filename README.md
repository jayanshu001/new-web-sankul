# WebSankul API

A comprehensive REST API for the WebSankul online education platform, providing services for course management, e-learning content delivery, live classes, examination systems, e-commerce functionality, and student management. Built on Node.js + TypeScript with Express 5, Mongoose, Socket.IO, Redis (BullMQ), and AWS S3.

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Database Setup](#database-setup)
- [Running the Application](#running-the-application)
- [API Documentation](#api-documentation)
- [Authentication](#authentication)
- [Project Structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)

## Features

- **Course Management**: Courses, subjects, lectures, videos, materials, and folders
- **Live Classes**: Live courses, live sessions, live chat, live polls, live reminders (Socket.IO + HLS)
- **Digital Content**: E-books, lecture notes, lecture audio notes, downloadable materials
- **Physical Products**: Book ordering, shipping, and tracking
- **Examination System**: Quizzes, test series, exam countdowns, and analytics
- **Package System**: Bundled course/ebook/test offerings with plans
- **Payment Integration**: Razorpay payments and payout webhooks
- **User Management**: Students, educators, promoters, administrators with role-based access
- **Notifications**: Push notifications via Firebase Admin + image notifications
- **Referral Program**: Student referral, rewards, and bank-account payouts
- **Deep Linking**: iOS Universal Links / Android App Links + share URL generation
- **Search**: Unified search across courses, ebooks, materials, and exams
- **Security**: JWT auth, Helmet, CORS allowlist, rate limiting (global + admin + auth tiers)
- **Caching & Queues**: Redis caching, BullMQ background workers, Socket.IO Redis adapter
- **Observability**: Winston logging (daily rotate), Prometheus `/metrics`, crash reporter with Redis-throttled emails
- **File Storage**: AWS S3 via multer-s3 (uploads), PDFKit for invoices, Puppeteer for rendering

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js**: >= 18.x (recommended 20+)
- **npm**: >= 9.x
- **MongoDB**: >= 6.x
- **Redis**: >= 6.x (required for rate-limiting, BullMQ, Socket.IO adapter, crash throttle)
- **Git**: For version control

## Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
cd new-web-sankul
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Build TypeScript (optional for prod)

```bash
npm run build
```

## Configuration

### Environment Variables

Create a `.env` file in the root directory.

#### Required Environment Variables:

```bash
# Node Environment
NODE_ENV=development
PORT=2206

# Database
MONGODB_URI=mongodb://127.0.0.1:27017/websankul

# JWT
JWT_SECRET=your_jwt_secret
JWT_REFRESH_SECRET=your_jwt_refresh_secret
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d

# CORS (CSV of allowed origins — REQUIRED in production)
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_USERNAME=
REDIS_PASSWORD=

# AWS S3 (file uploads)
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_S3_BUCKET=your_bucket_name

# Razorpay
RAZORPAY_KEY_ID=your_key_id
RAZORPAY_KEY_SECRET=your_key_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret

# Firebase Admin (push notifications)
FIREBASE_SERVICE_ACCOUNT_PATH=./secrets/firebase-service-account.json

# Mail (SMTP)
MAIL_HOST=smtp.example.com
MAIL_PORT=587
MAIL_USER=your_email@example.com
MAIL_PASSWORD=your_email_password

# 2Factor OTP
TWO_FACTOR_API_KEY=your_2factor_api_key

# Metrics (Prometheus scrape token)
METRICS_TOKEN=long_random_string

# Deep Linking
APP_SCHEME=websankul
APP_UNIVERSAL_DOMAIN=https://your-domain.com
```

## Database Setup

### 1. Start MongoDB

```bash
mongod --dbpath /your/data/path
```

### 2. (Optional) Run Migrations / Backfills

One-off scripts live in `scripts/`. Example:

```bash
npx tsx scripts/backfill-lecture-progress-scope.ts
```

## Running the Application

### Development Mode

```bash
npm run dev
```

The server starts on `http://localhost:2206/api` (or your configured PORT). `tsx watch` provides auto-reload.

### Type Check

```bash
npm run typecheck
```

### Production Mode (PM2)

```bash
npm run build
npm start
```

Uses `ecosystem.config.cjs` to launch via PM2 in cluster mode.

### CPU / Auto-scale Monitors

```bash
npm run monitor:cpu
npm run monitor:scale
```

## Redis Setup

Redis is required for rate-limiting, BullMQ workers, Socket.IO multi-pod adapter, and the crash-reporter throttle. A sample `redis.conf` ships at the repo root.

Quick start (macOS):

```bash
brew install redis
redis-server redis.conf
```

Verify:

```bash
redis-cli ping
# Should return: PONG
```

## API Documentation

### Base URL

```
Development: http://localhost:2206/api/v1
Staging:     https://staging.your-domain.com/api/v1
Production:  https://api.your-domain.com/api/v1
```

### API Surfaces

The API is split by **caller portal**, not by version. All routes live under `/api/v1`:

- **`/api/v1/client/*`**   Mobile App / Student Web Portal
- **`/api/v1/admin/*`**    Admin React Dashboard
- **`/api/v1/educator/*`** Educator Portal
- **`/api/v1/promoter/*`** Promoter Portal
- **`/api/v1/webhooks/*`** HMAC-verified inbound webhooks
- **`/share/*`**           Public deep-link / share URLs (no auth)

---

## Authentication

All protected endpoints require a valid JWT in the Authorization header:

```
Authorization: Bearer <your_jwt_token>
```

A refresh token is sent via the `x-refresh-token` header on rotation endpoints.

### Authentication Flow (Client)

1. **Generate OTP**: `POST /api/v1/client/auth/otp/generate`
2. **Validate OTP**: `POST /api/v1/client/auth/otp/validate`
3. **Receive JWT + Refresh Token**
4. **Refresh**: `POST /api/v1/client/auth/refresh`

### Authentication Flow (Admin / Educator / Promoter)

1. **Login**: `POST /api/v1/{admin|educator|promoter}/auth/login`
2. **Refresh**: `POST /api/v1/{admin|educator|promoter}/auth/refresh`
3. **Logout**: `POST /api/v1/{admin|educator|promoter}/auth/logout`

> **Auth contract:** Every route under `/api/v1/admin/*` (except `/auth/login` and `/auth/refresh`) requires a Bearer token — enforced by a master `authenticate` middleware mounted in [admin.routes.ts](src/admin/admin.routes.ts). Per-domain routers additionally apply `requireRole(...)` for finer authorization.

---

## API Endpoints

### Public Endpoints (No Authentication)

```
GET  /api                                           # API health check
GET  /healthz                                       # Liveness probe
GET  /readyz                                        # Readiness probe
GET  /metrics                                       # Prometheus (token-gated)

GET  /.well-known/apple-app-site-association        # iOS Universal Links
GET  /.well-known/assetlinks.json                   # Android App Links

GET  /share/*                                       # Deep-link share URLs
POST /api/v1/webhooks/razorpay-payout               # HMAC-verified payout webhook

POST /api/v1/client/auth/otp/generate               # Generate OTP
POST /api/v1/client/auth/otp/validate               # Validate OTP -> JWT
POST /api/v1/{admin|educator|promoter}/auth/login   # Portal login
POST /api/v1/{admin|educator|promoter}/auth/refresh # Refresh JWT
```

---

### Client Routes (`/api/v1/client/*`)

Mounted in [client.routes.ts](src/client/client.routes.ts).

##### **Auth & Profile**
```
POST   /api/v1/client/auth/*                # OTP, login, refresh, logout
GET    /api/v1/client/profile               # Get current user profile
PUT    /api/v1/client/profile               # Update profile
```

##### **Dashboard**
```
GET    /api/v1/client/dashboard             # Home dashboard (resume + recommendations)
GET    /api/v1/client/free-dashboard        # Free-tier dashboard
```

##### **Goals**
```
GET    /api/v1/client/goals                 # List goals (exams the user is preparing for)
```

##### **Courses & Learning**
```
GET    /api/v1/client/courses               # List purchasable courses
GET    /api/v1/client/courses/:id           # Course details + syllabus
GET    /api/v1/client/learning/*            # Unified Resume-Learning feed + progress
```

##### **Live Classes**
```
GET    /api/v1/client/live-courses/*        # Live-course catalog + enrolment
GET    /api/v1/client/live-sessions/:id     # Join a live stream
GET    /api/v1/client/live-chat/:liveClassId/history
GET    /api/v1/client/live-polls/:liveClassId/active
POST   /api/v1/client/live-reminders/*      # Reminders for upcoming sessions
```

##### **Lectures, Notes & Materials**
```
GET    /api/v1/client/lecture-notes/*       # Lecture text notes
GET    /api/v1/client/lecture-audio-notes/* # Audio notes
GET    /api/v1/client/materials/*           # Study materials (grouped by lecture)
GET    /api/v1/client/material-folders/*    # Folder browsing
GET    /api/v1/client/video-folders/*       # Video folder browsing
```

##### **E-Books & Books**
```
GET    /api/v1/client/ebooks/*              # E-book catalog + reader
GET    /api/v1/client/books/*               # Physical books + cart + orders
```

##### **Quizzes & Test Series**
```
GET    /api/v1/client/quizzes/*             # Quizzes (single exams)
GET    /api/v1/client/test-series/*         # Test series (bundles)
GET    /api/v1/client/exam-countdowns/*     # Countdown widgets
```

##### **Packages & Plans**
```
GET    /api/v1/client/packages/*            # Bundled offerings
```

##### **Cart, Payment & Orders**
```
GET    /api/v1/client/cart/*                # Unified cart
POST   /api/v1/client/payment/*             # Razorpay order create / verify
GET    /api/v1/client/orders/*              # Order history + invoices
GET    /api/v1/client/purchase-history/*    # Detailed purchase ledger
GET    /api/v1/client/my-subscriptions      # Active subscriptions
POST   /api/v1/client/webhook/*             # Payment webhooks (client-side)
GET    /api/v1/client/tracking              # Shipment tracking
```

##### **Address**
```
GET    /api/v1/client/address               # List addresses
POST   /api/v1/client/address               # Add address
PUT    /api/v1/client/address/:id           # Update
DELETE /api/v1/client/address/:id           # Delete
```

##### **Promocodes**
```
POST   /api/v1/client/promocodes/validate   # Validate a code
POST   /api/v1/client/promocodes/apply      # Apply to cart
```

##### **Referral**
```
GET    /api/v1/client/referral              # Program details + earnings
GET    /api/v1/client/referral/transactions
POST   /api/v1/client/referral/withdraw     # Payout to bank account
```

##### **Wishlist & Save**
```
GET    /api/v1/client/wishlist/*            # Wishlist items
POST   /api/v1/client/save/answers          # Saved exam answers (legacy compat)
```

##### **Search & Categories**
```
GET    /api/v1/client/search                # Unified search
GET    /api/v1/client/video-categories/:id/videos
GET    /api/v1/client/material-categories/:id/materials
GET    /api/v1/client/exam-categories/:id/exams
```

##### **Educators & Free Content**
```
GET    /api/v1/client/educators/*           # Educator profiles + their courses
GET    /api/v1/client/free-tests            # Free quizzes
GET    /api/v1/client/free-materials        # Free materials
GET    /api/v1/client/free-videos           # Free videos
```

##### **Offline Centers, Inquiry & Notifications**
```
GET    /api/v1/client/offline/*             # Offline study centers
POST   /api/v1/client/inquiry               # Submit inquiry
POST   /api/v1/client/contactus             # Contact form
GET    /api/v1/client/notifications         # User notifications
GET    /api/v1/client/image-notifications   # Image banners
```

##### **CMS**
```
GET    /api/v1/client/faqs                  # FAQs
GET    /api/v1/client/popup                 # Active popup
GET    /api/v1/client/banners               # Home banners
GET    /api/v1/client/testimonials          # Student testimonials
GET    /api/v1/client/terms                 # Terms & conditions
GET    /api/v1/client/version               # App version + force-update gate
GET    /api/v1/client/upgrade               # Upgrade prompts
```

---

### Admin Routes (`/api/v1/admin/*`)

Mounted in [admin.routes.ts](src/admin/admin.routes.ts). All routes (except `/auth/login` and `/auth/refresh`) require Bearer auth and are metered by the admin rate-limiter.

##### **Auth, Administrators, Roles & Permissions**
```
POST   /api/v1/admin/auth/login
POST   /api/v1/admin/auth/refresh
POST   /api/v1/admin/auth/logout
GET    /api/v1/admin/administrators/*       # Admin user CRUD
GET    /api/v1/admin/roles/*                # Role CRUD
GET    /api/v1/admin/permissions/*          # Permission CRUD
GET    /api/v1/admin/permission-categories/*
GET    /api/v1/admin/guards                 # Permission catalog
```

##### **Catalog**
```
GET    /api/v1/admin/goals/*
GET    /api/v1/admin/courses/*
GET    /api/v1/admin/videos/*
GET    /api/v1/admin/video-categories/*
GET    /api/v1/admin/ebooks/*
GET    /api/v1/admin/books/*
GET    /api/v1/admin/materials/*
GET    /api/v1/admin/quizzes/*              # Exams
GET    /api/v1/admin/test-series/*
GET    /api/v1/admin/packages/*
GET    /api/v1/admin/plans/*                # Pricing plans (duration in months)
GET    /api/v1/admin/master/*               # State / city / misc masters
```

##### **Live Classes**
```
GET    /api/v1/admin/live-sessions/*
GET    /api/v1/admin/live-courses/*
GET    /api/v1/admin/live-chat/*
GET    /api/v1/admin/live-polls/*
GET    /api/v1/admin/exam-countdowns/*
```

##### **Customers, Subscriptions & Referrals**
```
GET    /api/v1/admin/customers/*
GET    /api/v1/admin/customer-masters/*     # Bulk customer master ops
GET    /api/v1/admin/subscriptions/*
GET    /api/v1/admin/referrals/*
GET    /api/v1/admin/promoters/*
```

##### **Marketing & Operations**
```
GET    /api/v1/admin/promocodes/*
GET    /api/v1/admin/cms/*                  # FAQs, banners, popups, testimonials, terms
GET    /api/v1/admin/inquiries
GET    /api/v1/admin/departments
GET    /api/v1/admin/notifications/*
GET    /api/v1/admin/offline/*
GET    /api/v1/admin/tracking/*
GET    /api/v1/admin/dashboard              # KPI dashboard
GET    /api/v1/admin/address/states/*
GET    /api/v1/admin/address/cities/*
```

---

### Educator Routes (`/api/v1/educator/*`)

Mounted in [educator.routes.ts](src/educator/educator.routes.ts).

```
POST   /api/v1/educator/auth/login
GET    /api/v1/educator/dashboard           # Educator KPIs
GET    /api/v1/educator/courses/*           # Their courses + lectures + uploads
GET    /api/v1/educator/package/*           # Packages they belong to
```

---

### Promoter Routes (`/api/v1/promoter/*`)

Mounted in [promoter.routes.ts](src/promoter/promoter.routes.ts).

```
POST   /api/v1/promoter/auth/login
GET    /api/v1/promoter/dashboard           # Earnings + referrals
GET    /api/v1/promoter/customer/*          # Customers they brought in
GET    /api/v1/promoter/promocode/*         # Their assigned codes
GET    /api/v1/promoter/subscription/*      # Subscriptions tied to their codes
```

---

### Deep Linking & Share (`/share/*`)

Public, unauthenticated, rate-limit-light. Generates share URLs that resolve to the app via Universal Links / App Links. See [docs/DEEPLINKING_SHARE.md](docs/DEEPLINKING_SHARE.md) and [deeplinking.routes.ts](src/deeplinking/deeplinking.routes.ts).

---

## Project Structure

```
new-web-sankul/
├── prisma/                          # (none — this project uses Mongoose)
├── src/
│   ├── index.ts                     # Application entry point
│   ├── app.ts                       # Express app, middleware & route mounting
│   ├── client/                      # Client (mobile/web) API surface
│   │   ├── client.routes.ts         # Master client router
│   │   ├── auth/  profile/  dashboard/  course/  learning/
│   │   ├── live/  live-course/  livechat/  livepoll/  live-reminder/
│   │   ├── lecture-note/  lecture-audio-note/  material/  folder/
│   │   ├── ebook/  book/  package/  testSeries/  exam/
│   │   ├── cart/  payment/  orders/  purchase-history/  my-subscriptions/
│   │   ├── address/  promocode/  referral/  save/  wishlist/
│   │   ├── search/  categories/  educator/  free/
│   │   ├── cms/  inquiry/  notification/  offline/  tracking/  webhook/
│   │   ├── goal/  examCountdown/
│   │   └── ... (40+ feature modules)
│   ├── admin/                       # Admin dashboard API surface
│   │   ├── admin.routes.ts          # Master admin router (enforces auth globally)
│   │   ├── auth/  administrator/  role/  permission/  permissionCategory/  guards/
│   │   ├── course/  video/  videoCategory/  ebook/  book/  material/
│   │   ├── exam/  testSeries/  package/  plan/  promocode/
│   │   ├── live/  live-course/  livechat/  livepoll/  examCountdown/
│   │   ├── customer/  customer-master/  subscription/  referral/  promoter/
│   │   ├── cms/  inquiry/  notification/  offline/  tracking/  dashboard/
│   │   ├── address/  master/  goal/
│   │   └── ... (35+ feature modules)
│   ├── educator/                    # Educator portal API
│   │   └── auth/  course/  dashboard/  package/
│   ├── promoter/                    # Promoter portal API
│   │   └── auth/  customer/  dashboard/  promocode/  subscription/
│   ├── deeplinking/                 # Public share / deep-link routes
│   ├── webhooks/                    # HMAC-verified inbound webhooks (Razorpay payout, ...)
│   ├── socket/                      # Socket.IO server (live chat / polls / streaming)
│   ├── models/                      # Mongoose schemas
│   │   ├── customer/  course/  ebook/  book/  exam/  testSeries/
│   │   ├── educator/  promoter/  admin/  referral/  offline/  system/
│   │   ├── examCountdown/  Goal.model.ts  enums.ts
│   ├── middlewares/                 # authenticate, requireRole, errorHandler,
│   │                                # notFound, metricsMiddleware, requestContext,
│   │                                # health, validation
│   ├── config/                      # rateLimiter, redis, mongo, s3, mail, etc.
│   ├── libs/                        # Reusable libs (constants, helpers, validators)
│   ├── utils/                       # logger, crashReporter, metrics, requestLogger,
│   │                                # requestContext (AsyncLocalStorage)
│   └── migrations/                  # Schema/data migration scripts
├── scripts/                         # One-off backfills (e.g. backfill-lecture-progress-scope.ts)
├── docs/                            # Internal docs (deeplinking, frontend specs, demos)
├── public/                          # .well-known files (AASA, assetlinks.json)
├── secrets/                         # Firebase service account, etc. (gitignored)
├── logs/                            # Winston daily-rotate log files
├── dist/                            # Compiled JS output (after `npm run build`)
├── ecosystem.config.cjs             # PM2 cluster config (production)
├── docker-compose.yml               # Local Mongo + Redis stack
├── redis.conf                       # Local Redis config
├── tsconfig.json
├── package.json
└── README.md
```

## Middleware

### Authentication

**`authenticate`** ([middlewares/authenticate.ts](src/middlewares/authenticate.ts)): Verifies the JWT Bearer token and attaches the user to `req`.

```typescript
router.use(authenticate, adminLimiter);
router.get("/protected", authenticate, controller.handler);
```

> **Auth required on all APIs** — every route (admin + client + educator + promoter) must require a Bearer token; routes are never public by default. Public exceptions (`/auth/login`, `/auth/refresh`, OTP generate/validate, webhooks, `/share`, `/healthz`) are explicit.

### Authorization

**`requireRole([roles])`**: Checks that the authenticated user holds the required role / permission. Used per-domain after `authenticate`.

### Validation

**`validate(schema)`**: Validates `req.body` / `req.query` / `req.params` against a Zod schema.

### Rate Limiting

Three tiers in [config/rateLimiter.ts](src/config/rateLimiter.ts):

- **`globalLimiter`** — applied app-wide
- **`adminLimiter`** — per-admin-id when authenticated, per-IP otherwise
- **`authLimiter`** — stricter limits on login / OTP routes

Redis-backed via `rate-limit-redis` so limits hold across PM2 / pod instances.

### Observability

- **`requestLogger`** — seeds a per-request `traceId`
- **`requestContextMiddleware`** — AsyncLocalStorage scope so downstream code sees the same context
- **`metricsMiddleware`** — Prometheus counters/histograms
- **`captureCrashContextMiddleware`** — feeds the Redis-throttled crash reporter

## Data Models (Mongoose)

Key collections include:

- **Customer** — student accounts (`customer/`)
- **Course / CourseSubject / Lecture / LectureProgress** — course catalog + progress
- **Video / VideoCategory / Material / Folder** — content + organization
- **LiveCourse / LiveSession / LiveChat / LivePoll** — live classes
- **Ebook / Book** — digital and physical book inventory
- **Exam / TestSeries / ExamCountdown / ExamResult** — assessments
- **Package / Plan** — bundles and pricing (`duration` is in **months**)
- **Order / Payment / Subscription / PurchaseHistory** — commerce
- **Address / Tracking** — shipping
- **Promocode / Referral / BankAccount** — marketing & payouts
- **Notification / ImageNotification / Popup / Banner / FAQ / Testimonial** — CMS & comms
- **Administrator / Role / Permission / PermissionCategory** — RBAC
- **Educator / Promoter** — portal users
- **Goal / OfflineCenter / Inquiry** — misc domains

## Real-time (Socket.IO)

Socket.IO server lives in [src/socket/](src/socket/) and uses the Redis adapter so events fan out across PM2 cluster workers and pods. Used by:

- Live chat (`/live-chat` namespace)
- Live polls (`/live-polls`)
- Live streaming (`/live-sessions` — HLS signaling + viewer counts)

## Health, Metrics & Crash Reporting

- `GET /healthz` — liveness (always 200 if process is up)
- `GET /readyz` — readiness (checks Mongo + Redis)
- `GET /metrics` — Prometheus exposition; requires `Authorization: Bearer $METRICS_TOKEN`
- Crash reporter emails on unhandled errors, throttled via Redis to avoid email storms across pods

## Testing

Run the type checker:

```bash
npm run typecheck
```

> No automated test suite is configured yet — UI / behavior changes should be manually verified per the project's `/verify` workflow.

## Troubleshooting

### Port Already in Use

```bash
lsof -ti:2206 | xargs kill -9
```

### MongoDB Connection Failed

1. Check MongoDB is running: `mongosh`
2. Verify `MONGODB_URI` in `.env`
3. Confirm the database name in the connection string

### Redis Connection Failed

1. Check Redis is running: `redis-cli ping` (expect `PONG`)
2. Verify `REDIS_HOST` / `REDIS_PORT` / `REDIS_USERNAME` / `REDIS_PASSWORD`
3. If running locally without auth, leave `REDIS_USERNAME` / `REDIS_PASSWORD` empty

### CORS Blocked in Production

`ALLOWED_ORIGINS` is **required** in production — the process exits at boot if it's unset. Add the exact origin (including scheme + port) to the CSV.

### S3 Upload Errors

1. Verify `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_S3_BUCKET`
2. Confirm the IAM user has `s3:PutObject` on the bucket
3. Confirm `AWS_REGION` matches the bucket's region

### OTP Not Sending

1. Verify `TWO_FACTOR_API_KEY`
2. Check 2Factor account balance / template approval
3. Review `logs/` for upstream errors

### Payment Gateway Issues

1. Verify Razorpay key id + secret
2. Confirm webhook URL + secret in the Razorpay dashboard match `RAZORPAY_WEBHOOK_SECRET`
3. The payout webhook verifies HMAC against the raw body — body parsers preserve `req.rawBody`

### Force-Update / Version Endpoint

Mobile apps read `/api/v1/client/version` for force-update gates. Update the CMS `version` document — do not bump it via code.

## Security Best Practices

- Never commit `.env` or `secrets/` to version control
- Regularly run `npm audit fix`
- Rotate JWT secrets if exposed; refresh tokens have a separate secret
- Keep `METRICS_TOKEN` long, random, and out of logs
- Always set `ALLOWED_ORIGINS` in production (boot will fail otherwise)
- Never disable Helmet globally — relax CSP per-route as done for `/demo`
- Webhook endpoints must verify HMAC against `req.rawBody` — never trust signature claims in JSON
- Monitor `/metrics` + `logs/` for anomalies

## Environment-Specific Configuration

### Development
- `.env`, `npm run dev` (tsx watch), detailed logging, demo routes (`/demo/live-chat`, `/demo/live-course`) enabled

### Staging
- PM2 via `ecosystem.config.cjs`, moderate logging, real third-party endpoints with test credentials

### Production
- PM2 cluster mode, structured logging, Prometheus scraping, `ALLOWED_ORIGINS` enforced, demo routes disabled

## Deployment

### Using PM2

```bash
npm run build
npm start                          # = pm2 start ecosystem.config.cjs
```

### PM2 Commands

```bash
pm2 logs                           # tail logs
pm2 restart all
pm2 stop all
pm2 monit
```

### Docker (local stack)

```bash
docker compose up -d               # brings up Mongo + Redis
```

## License

ISC License — Copyright (c) WebSankul Developers

## Authors

**WebSankul Developers**

## Support

For support and questions, please contact the development team or create an issue in the repository.

---

**Built for education**
