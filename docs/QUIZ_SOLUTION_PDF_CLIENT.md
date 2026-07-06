# Quiz Result PDF Download — Frontend Integration Guide

This endpoint generates a downloadable PDF of a customer's quiz/exam attempt
result — the same Question/Answer breakdown shown on the "View Result" screen,
plus the score summary panel.

The PDF is rendered server-side (EJS → Puppeteer/Chromium) and streamed back as
a raw PDF binary — **not JSON**. Same pattern as the existing Receipt download.

---

## 1. Endpoint

| Method | URL |
|---|---|
| GET | `/api/v1/client/quizzes/:examId/solution/download?attemptId=<attemptId>` |

Requires a customer Bearer token (same auth as every other client API).

---

## 2. Request

### Headers

```
Authorization: Bearer <customer-jwt>
```

No request body.

### Path params

- `:examId` — MongoDB `_id` of the exam/quiz.

### Query params

- `attemptId` *(optional)* — MongoDB `_id` of the specific attempt to print.
  If omitted, the server picks the customer's **latest submitted** attempt
  for this exam.

### Preconditions enforced server-side

- The attempt must belong to the authenticated customer (404 otherwise).
- The attempt must be `status: true` i.e. submitted (404 otherwise).
- `examId` / `attemptId` must be valid ObjectIds (400 otherwise).

---

## 3. Response

### Success — `200 OK`

Binary PDF stream.

Headers:

```
Content-Type: application/pdf
Content-Length: <bytes>
Content-Disposition: attachment; filename="<exam-title>_attempt<N>.pdf"
```

The filename is generated from the exam title (non-alphanumerics replaced with
`_`, max 40 chars) plus the attempt number. Example:
`General_Studies_Mock_1_attempt2.pdf`.

### Errors

| Status | Body | When |
|---|---|---|
| 400 | `{ success: false, message: "Please select valid exam!!" }` | `:examId` not an ObjectId |
| 400 | `{ success: false, message: "Invalid attempt id." }` | `attemptId` not an ObjectId |
| 401 | `{ success: false, message: "Unauthorized." }` | Missing/invalid token |
| 404 | `{ success: false, message: "No submitted attempt found." }` | No matching submitted attempt for this customer |
| 500 | `{ success: false, message: "..." }` | Render/Puppeteer failure |

---

## 4. PDF contents

The generated PDF mirrors the on-screen result view:

- **Header** — WebSankul branding, generation timestamp.
- **Meta table** — Exam title, attempt number, candidate name/email/phone,
  submission time.
- **Summary table** — Score / total marks, correct, incorrect, skipped,
  attempted/total, accuracy %, rank (e.g. `685/781`), time taken (`MM:SS`).
- **Questions & Answers** — One card per question:
  - Status badge: **Correct (+N)**, **Incorrect (−N)**, or **Skipped**.
  - All options listed; the correct option is highlighted green, the user's
    wrong pick (if any) is highlighted red.
  - Tags on each option: `Your Answer`, `Correct`.
  - Footer line per question shows `Correct Answer:` and `Your Answer:`.

---

## 5. Frontend implementation

This endpoint streams a binary — do **not** parse it as JSON. Use the
`responseType: 'blob'` pattern.

### Trigger from the "Generate PDF" button on the Score screen

You already have `examId` and `attemptId` in scope on the result screen (the
same IDs you passed to `/solution` and `/solution/analytics`).

### Axios example

```ts
import axios from "axios";

async function downloadQuizResultPdf(examId: string, attemptId: string) {
  const res = await axios.get(
    `/api/v1/client/quizzes/${examId}/solution/download`,
    {
      params: { attemptId },
      responseType: "blob",
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  // Pull filename out of Content-Disposition if present, else fall back.
  const cd = res.headers["content-disposition"] || "";
  const match = /filename="?([^"]+)"?/i.exec(cd);
  const fileName = match?.[1] || `quiz_result_${attemptId}.pdf`;

  const blob = new Blob([res.data], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
```

### Fetch example

```ts
const res = await fetch(
  `/api/v1/client/quizzes/${examId}/solution/download?attemptId=${attemptId}`,
  { headers: { Authorization: `Bearer ${token}` } },
);

if (!res.ok) {
  // Server returns JSON on error — parse it for the message.
  const err = await res.json().catch(() => ({ message: "Download failed" }));
  throw new Error(err.message);
}

const blob = await res.blob();
// …same blob-to-download flow as above
```

### React Native (Expo) example

```ts
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";

async function downloadQuizResultPdf(examId: string, attemptId: string) {
  const fileUri = `${FileSystem.cacheDirectory}quiz_${attemptId}.pdf`;
  const { uri } = await FileSystem.downloadAsync(
    `${API_BASE}/api/v1/client/quizzes/${examId}/solution/download?attemptId=${attemptId}`,
    fileUri,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  await Sharing.shareAsync(uri, { mimeType: "application/pdf" });
}
```

### Error handling tip

Because the success response is a Blob but error responses are JSON, when using
`responseType: 'blob'` with Axios you may need to read the error blob as text:

```ts
try {
  await downloadQuizResultPdf(examId, attemptId);
} catch (e: any) {
  if (e.response?.data instanceof Blob) {
    const text = await e.response.data.text();
    const { message } = JSON.parse(text);
    showToast(message);
  } else {
    showToast(e.message);
  }
}
```

---

## 6. UI wiring (matches the attached mock)

On the "Your Score" screen:

- **View Result** → existing screen using `GET /solution` + `/solution/analytics`.
- **Generate PDF** → call `downloadQuizResultPdf(examId, attemptId)` above.
  Show a spinner while the request is in flight; PDF generation is server-side
  Puppeteer so it typically takes 1–3 seconds.

No additional state, store, or context is needed — the PDF is fully built on
the server from `examId` + `attemptId`.
