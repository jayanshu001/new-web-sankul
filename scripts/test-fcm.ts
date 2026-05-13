/**
 * One-off smoke test for FCM wiring.
 *
 * Usage:
 *   npx tsx scripts/test-fcm.ts               # init only (no send)
 *   npx tsx scripts/test-fcm.ts <fcm-token>   # dry-run send to that token
 */
import "dotenv/config";
import admin from "firebase-admin";

async function main() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    console.error("FIREBASE_SERVICE_ACCOUNT missing");
    process.exit(1);
  }
  const serviceAccount = JSON.parse(raw);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  console.log("[ok] Admin SDK initialized for project:", serviceAccount.project_id);

  const token = process.argv[2];
  if (!token) {
    console.log("[done] No token supplied — skipping send. Pass a device FCM token as arg to test delivery.");
    return;
  }

  const messaging = admin.messaging();

  // Step 1: dry-run (validates token + payload with Google but does NOT deliver)
  const dryRunId = await messaging.send(
    {
      token,
      notification: { title: "Backend FCM test", body: "Dry-run from server." },
      data: { deepLink: "/test" },
    },
    true /* dryRun */
  );
  console.log("[ok] Dry-run succeeded. Message id:", dryRunId);

  // Step 2: real send
  const realId = await messaging.send({
    token,
    notification: { title: "Backend FCM test", body: "Real send from server." },
    data: { deepLink: "/test" },
  });
  console.log("[ok] Real send succeeded. Message id:", realId);
  console.log("[done] Check the device — notification should appear within a few seconds.");
}

main().catch((err) => {
  console.error("[fail]", err.code ?? "", err.message);
  process.exit(1);
});
