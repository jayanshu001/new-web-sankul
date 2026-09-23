/*
 * Register our recording endpoint with StreamOS v1 and capture the signing secret.
 *
 * The signing secret is returned ONCE, in the response to POST /webhooks/. It is
 * never readable again — losing it means deleting the webhook and re-registering,
 * which mints a different secret. So this script prints it and does nothing else
 * clever: copy it into STREAMOS_WEBHOOK_SIGNING_SECRET and restart.
 *
 * Without that var set, verifyStreamosSignature rejects every delivery with 401,
 * StreamOS retries 6 times over ~13h, then gives up — and recordings never attach
 * to their sessions. Live classes still work, so the failure is silent.
 *
 * MUST RUN FROM A HOST WITH A PUBLIC HTTPS URL (staging or production). StreamOS
 * has to be able to reach the endpoint; localhost cannot receive deliveries.
 *
 *   STREAMOS_API_KEY=sk_live_… \
 *   WEBHOOK_BASE_URL=https://api.example.com \
 *   npx tsx scripts/register-streamos-v1-webhook.ts
 *
 * Lists existing webhooks first and refuses to create a duplicate for the same URL.
 * Pass FORCE=1 to register anyway.
 *
 * Context: docs/migration/STREAMOS_V1_QUESTIONS.md
 */

import dotenv from "dotenv";
dotenv.config();

import { streamosV1ApiKey } from "../src/config/streamos";
import {
  listWebhooks,
  registerWebhook,
  StreamosError,
  type StreamosV1Event,
} from "../src/admin/live/streamos.v1.service";

// The path is fixed by src/client/webhook/webhook.routes.ts — the same public
// endpoint the legacy callback uses. v1 deliveries are told apart by their headers.
const WEBHOOK_PATH = "/api/v1/client/webhook/recording";

// Only the events the handler actually acts on (see streamos.v1.webhook.ts:applyEvent).
// LIVESTREAM_RECORDING_READY stores the asset pointer; VIDEO_TRANSCODING_COMPLETED
// publishes the playable recording; LIVESTREAM_ENDED closes the session out.
const EVENTS: StreamosV1Event[] = [
  "LIVESTREAM_ENDED",
  "LIVESTREAM_RECORDING_READY",
  "VIDEO_TRANSCODING_COMPLETED",
];

const die = (m: string): never => {
  console.error(`\x1b[31m${m}\x1b[0m`);
  process.exit(1);
};

async function main() {
  if (!streamosV1ApiKey()) die("STREAMOS_API_KEY is not set.");

  const base = process.env.WEBHOOK_BASE_URL?.trim().replace(/\/+$/, "");
  if (!base) die("WEBHOOK_BASE_URL is not set (e.g. https://api.example.com).");
  if (!base.startsWith("https://")) die(`WEBHOOK_BASE_URL must be https — got ${base}`);

  const url = `${base}${WEBHOOK_PATH}`;
  console.log(`Registering: ${url}`);
  console.log(`Events:      ${EVENTS.join(", ")}\n`);

  const existing = await listWebhooks();
  for (const w of existing) {
    console.log(`  existing: ${w.publicId ?? "?"}  ${w.url ?? "?"}  [${w.events.join(", ")}]`);
  }
  if (existing.some((w) => w.url === url) && process.env.FORCE !== "1") {
    die(`\nAlready registered for this URL. Re-run with FORCE=1 to add another.`);
  }

  const result = await registerWebhook({
    url,
    events: EVENTS,
    description: `websankul ${process.env.STREAMOS_ENV_TAG ?? process.env.NODE_ENV ?? "unknown"}`,
  });

  if (!result.signingSecret) {
    console.error("\n\x1b[31mRegistered, but no signing_secret in the response.\x1b[0m");
    console.error("Raw response:", JSON.stringify(result.raw, null, 2));
    console.error("\nDelete this webhook and retry — without the secret it is useless.");
    process.exit(1);
  }

  console.log(`\n\x1b[32mRegistered.\x1b[0m  webhook id: ${result.publicId ?? "(none returned)"}`);
  console.log("\nAdd this to .env — it is shown ONCE and cannot be read again:\n");
  console.log(`STREAMOS_WEBHOOK_SIGNING_SECRET=${result.signingSecret}\n`);
  console.log("Then restart the API. Until it is set, every delivery is rejected 401.");
}

main().catch((e) => {
  if (e instanceof StreamosError) {
    die(`StreamOS refused: ${e.message} (upstream ${e.upstreamStatus ?? "?"})\n${JSON.stringify(e.upstreamBody)}`);
  }
  die(`Failed: ${e instanceof Error ? e.message : String(e)}`);
});
