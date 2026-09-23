/**
 * Mock-JWT store for migration API tests.
 *
 * Before any authenticated API runs we mint an admin + customer JWT once and
 * persist them to `api-tests/.auth.json`. Every test suite then reads the same
 * stored token (via auth.ts) instead of re-minting per suite. The file is
 * git-ignored — it holds short-lived test-only tokens, never commit it.
 *
 *   yarn migration:api:auth   # (re)generate the store
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { mintAdminToken, mintCustomerToken } from "./mint-auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** api-tests/.auth.json — one level up from _lib/. */
export const AUTH_STORE_PATH = path.resolve(__dirname, "..", ".auth.json");

/** Mint a fresh token if the stored one is older than this (ms). Minted JWTs last 1h. */
const MAX_AGE_MS = 50 * 60 * 1000; // 50 min — refresh before the 1h JWT expiry

export type AuthStore = {
  admin: string;
  customer: string;
  /** epoch ms when minted */
  mintedAt: number;
};

function readStore(): AuthStore | null {
  try {
    const raw = fs.readFileSync(AUTH_STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<AuthStore>;
    if (parsed.admin && parsed.customer && typeof parsed.mintedAt === "number") {
      return parsed as AuthStore;
    }
  } catch {
    /* missing / unreadable / malformed → treat as no store */
  }
  return null;
}

function isFresh(store: AuthStore): boolean {
  return Date.now() - store.mintedAt < MAX_AGE_MS;
}

/**
 * Mint admin + customer JWTs and write them to api-tests/.auth.json.
 * Call this once before running the suites.
 */
export async function generateAuthStore(): Promise<AuthStore> {
  const [admin, customer] = await Promise.all([mintAdminToken(), mintCustomerToken()]);
  const store: AuthStore = { admin, customer, mintedAt: Date.now() };
  fs.writeFileSync(AUTH_STORE_PATH, JSON.stringify(store, null, 2) + "\n", "utf8");
  console.log(`🔑 Mock JWTs written to ${path.relative(process.cwd(), AUTH_STORE_PATH)}`);
  return store;
}

/** Return a fresh store, regenerating if missing or stale. */
export async function ensureAuthStore(): Promise<AuthStore> {
  const existing = readStore();
  if (existing && isFresh(existing)) return existing;
  return generateAuthStore();
}

/** Read the stored admin token (regenerating the store if needed). */
export async function storedAdminToken(): Promise<string> {
  return (await ensureAuthStore()).admin;
}

/** Read the stored customer token (regenerating the store if needed). */
export async function storedCustomerToken(): Promise<string> {
  return (await ensureAuthStore()).customer;
}
