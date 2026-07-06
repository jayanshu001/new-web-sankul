# Receipt / Invoice PDF — Frontend Integration Guide

Two new client endpoints generate a PDF receipt for paid Book and Ebook orders.
The PDF is rendered server-side (EJS → Puppeteer/Chromium) and streamed back as
a raw PDF binary — **not JSON**.

---

## 1. Endpoints

| Order type | Method | URL |
|---|---|---|
| Book order  | GET | `/api/v1/client/books/orders/:id/invoice` |
| Ebook order | GET | `/api/v1/client/ebooks/orders/:orderId/invoice` |

Both require a customer Bearer token in the `Authorization` header (same auth
used by every other client API in the app — one active device, etc.).

---

## 2. Request

### Headers

```
Authorization: Bearer <customer-jwt>
```

No request body. No query params.

### Path params

- `:id` (Book) or `:orderId` (Ebook) — the MongoDB `_id` of the order the
  customer owns.

### Preconditions enforced server-side

- The order must belong to the authenticated customer (404 otherwise).
- The order must have a `razorpayPaymentId` set — i.e. payment must be
  verified (404 with message *"Order has not been paid yet."* otherwise).

---

## 3. Success response

On success the server responds with:

```
HTTP/1.1 200 OK
Content-Type: application/pdf
Content-Length: <bytes>

<raw PDF binary>
```

There is **no `Content-Disposition` header** — the browser will render the PDF
inline if the URL is opened directly.

The PDF contents include:

- WebSankul header (logo, address, GSTIN, PAN, CIN, contact, email)
- Payment method + Razorpay payment id
- Receipt number, date, and payer info (name, phone, email)
- Line items table: name, validity (`-` for books, `N months` for ebooks),
  amount
- Total, amount received, amount in words
- Two default notes (system-generated disclaimer + support email)

---

## 4. Error response

All errors are JSON, never a PDF:

```json
{ "success": false, "message": "Order not found." }
```

| Status | When |
|---|---|
| 401 | Missing/invalid Bearer token, or session evicted |
| 400 | Path id is not a valid Mongo ObjectId |
| 404 | Order doesn't exist, not owned by the caller, or not yet paid |
| 500 | PDF generation failure (Puppeteer crash, template error, etc.) |

Always check `response.headers["content-type"]`. If it isn't
`application/pdf`, parse the body as JSON to read `message`.

---

## 5. Integration patterns

### A. Open inline in a new tab (simplest)

Because the response is `application/pdf` with no attachment header, you can
just navigate to the URL — **but you need to send the Authorization header,
so a bare `<a href>` won't work**. Use `fetch` + blob URL instead:

```ts
async function openInvoice(orderId: string, token: string) {
  const res = await fetch(
    `/api/v1/client/books/orders/${orderId}/invoice`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message);
  }

  const blob = await res.blob();           // type: application/pdf
  const url  = URL.createObjectURL(blob);
  window.open(url, "_blank");              // shows the PDF inline
  // Revoke after a delay so the new tab has time to load.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
```

### B. Trigger a download

```ts
async function downloadInvoice(orderId: string, token: string) {
  const res = await fetch(
    `/api/v1/client/ebooks/orders/${orderId}/invoice`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message);
  }

  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `receipt-${orderId}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
```

### C. Axios

```ts
const res = await axios.get(
  `/api/v1/client/books/orders/${orderId}/invoice`,
  {
    responseType: "blob",                  // critical — don't let axios JSON-parse
    headers: { Authorization: `Bearer ${token}` },
  },
);

const url = URL.createObjectURL(res.data);
window.open(url, "_blank");
```

> ⚠️ With `responseType: "blob"`, axios error bodies also arrive as a Blob.
> To read the server's JSON error message you need to read the blob as text:
>
> ```ts
> try { ... } catch (e) {
>   if (e.response?.data instanceof Blob) {
>     const text = await e.response.data.text();
>     const json = JSON.parse(text);
>     showToast(json.message);
>   }
> }
> ```

### D. React Native

```ts
import RNFetchBlob from "rn-fetch-blob";

const { path } = await RNFetchBlob.config({ fileCache: true, appendExt: "pdf" })
  .fetch(
    "GET",
    `${BASE_URL}/api/v1/client/books/orders/${orderId}/invoice`,
    { Authorization: `Bearer ${token}` },
  );

// path() points to the downloaded PDF — open it with a viewer.
```

---

## 6. When to show the "Download Invoice" button

Only render the invoice action when the order is paid:

- Book order: `order.razorpayPaymentId` is set AND
  `order.status` is one of `PAID`, `SHIPPED`, `DELIVERED` (not `PENDING` / `CANCELLED`).
- Ebook order: `order.razorpayPaymentId` is set AND
  `order.status === "PAID"` / `"COMPLETED"`.

Hitting the endpoint before payment is verified returns 404.

---

## 7. Caveats

- PDF is generated on every request — no caching on the server side. If the
  user spams the button, that's many Chromium launches. Throttle/debounce on
  the client.
- Receipt content is rendered from the live order + customer record. If the
  customer updates their name/phone/email, future receipts reflect the new
  values; previously downloaded files do not.
- The "Receipt No" is `order.receiptId` for Book orders and
  `order.razorpayOrderId` (falling back to `order._id`) for Ebook orders.
- The currency is INR; "amount in words" follows the Indian numbering system
  (Crore / Lakh / Thousand).
