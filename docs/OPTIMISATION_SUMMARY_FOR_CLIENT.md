# WebSankul Backend: Optimisation Summary

**Date:** 9 October 2026

## In short

We optimised the WebSankul backend for speed, reliability and maintainability. The app,
website, admin panel and promoter panel work exactly as before: same screens, same data,
no app update and no database changes. The one exception is a correction in the admin
Test Series list, described below.

## What improved

**Speed:** fewer database requests per page
- **Package list:** purchase status, plans and subscriber counts are loaded for the whole
  page at once instead of package by package.
- **Package details, course and package content tabs, study material folders:** folder
  counts are combined. For example, a material folder with 20 sub-folders went from about
  100 database requests to 4.
- **Trending eBooks:** only the eBooks on the current page are loaded.
- **Free section packages:** plans and subscriber counts are loaded together.
- **Promoter customer details, admin Live sessions list, admin Promo code tabs:** load
  far less data per request.

**Reliability**
- PDF receipts and solution sheets are generated on the background server, so the main
  server stays responsive. If the background server is down, the main server generates
  them itself, as before.
- Scheduled notifications reload safely after a server restart, and now retry
  automatically (3 times) if the push service is briefly down. Notifications that still
  fail are recorded for review instead of being silently lost.
- **Correction:** with a category filter, the admin Test Series list now shows full pages
  and the correct total.

**Maintainability**
- Large files split, repeated code merged (checkout, payment confirmation, receipts),
  unused code removed, and an automatic check added so common mistakes can't return.
- Code comments reviewed for readability: outdated comments corrected, a short "what
  this file is responsible for" note added to each reorganised file, and brief
  explanations added where the logic is not obvious.

## How we tested

- On a full staging copy (about 1 million customers), the changed package, course,
  material, test and eBook screens returned the same results as before: 412 of 412
  checks passed.
- Checkout and payment confirmation for all 5 product types: 42 of 42 checks passed,
  with the same results as the previous version.
- On test data, purchase history and receipts produced exactly the same output as
  before.

## Before going live

Final checks on staging are scheduled before release. They cover every feature whose
code changed:

**Mobile app / website**
- Login with OTP.
- Package list (all filters), package details and "My packages".
- Course and package content tabs (videos, materials, tests) and folder drill-down.
- Study material folders (counts and "new" badge).
- Trending eBooks (free and paid) and the Free section.
- Search.
- Resume Learning.
- Purchase history, receipts and receipt PDF download.
- Checkout and payment for each product type (course, package, eBook, live course, test
  series), with a promo code, wallet coins and a delivery address.
- Live courses: list, details, sessions, schedule, recordings, live chat, polls, session
  reminders and the 3-minute preview.
- Recently Added and package category screens.
- Video and live-stream playback.
- Guest mode browsing (when enabled).

**Admin panel**
- Live courses: course details, plans, subscriptions (grant, move, extend, deactivate),
  schedule, recordings and videos, live chat and polls.
- Live sessions: list, create, start (go live), end and recording health.
- Promo code tabs on package, course and eBook pages.
- Test Series list with a category filter.
- Subscription and order reports, with CSV/Excel export and background exports.
- Promoters: overview dashboard.
- Referrals: Referrers (adjust rewards), Report (mark paid, reject, CSV) and
  Transactions.
- Customer, exam, educator, notification, tracking, package, course and eBook lists
  (paging).
- Notifications: schedule, cancel and delivery.

**Promoter panel**
- Customer list and customer details.

**Background**
- Live session recordings are saved after a session ends.
- Receipt and solution PDFs are generated on the background server.
- Scheduled notifications are delivered, and retried if the push service is briefly down.
