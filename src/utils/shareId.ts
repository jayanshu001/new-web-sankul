import crypto from "crypto";

// Keyed 44-bit Feistel permutation (32-bit id + 12-bit resource tag), base62.
// Fixed 8 chars. A block cipher can't go under 22 chars — one block is its floor.
const ID_BITS = 2 ** 32;
const HALF = 2 ** 22;
const DOMAIN = 2 ** 44;
const ROUNDS = 4;
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const WIDTH = 8;

const SECRET = process.env.JWT_ACCESS_SECRET ?? "ws";

const prf = (resource: string, round: number, x: number): number =>
  crypto
    .createHmac("sha256", SECRET)
    .update(`share-id-v1:${resource}:${round}:${x}`)
    .digest()
    .readUIntBE(0, 3) % HALF;

const tagOf = (resource: string): number =>
  crypto
    .createHmac("sha256", SECRET)
    .update(`share-tag-v1:${resource}`)
    .digest()
    .readUIntBE(0, 2) % 4096;

const forward = (v: number, resource: string): number => {
  let l = Math.floor(v / HALF);
  let r = v % HALF;
  for (let i = 0; i < ROUNDS; i++) {
    [l, r] = [r, l ^ prf(resource, i, r)];
  }
  return l * HALF + r;
};

const inverse = (v: number, resource: string): number => {
  let l = Math.floor(v / HALF);
  let r = v % HALF;
  for (let i = ROUNDS - 1; i >= 0; i--) {
    [l, r] = [r ^ prf(resource, i, l), l];
  }
  return l * HALF + r;
};

const toBase62 = (v: number): string => {
  let out = "";
  let n = v;
  for (let i = 0; i < WIDTH; i++) {
    out = ALPHABET[n % 62] + out;
    n = Math.floor(n / 62);
  }
  return out;
};

const fromBase62 = (s: string): number | null => {
  let n = 0;
  for (const ch of s) {
    const d = ALPHABET.indexOf(ch);
    if (d < 0) return null;
    n = n * 62 + d;
  }
  return n < DOMAIN ? n : null;
};

export const encryptShareId = (resource: string, id: string): string => {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1 || n >= ID_BITS) return "";
  return toBase62(forward(tagOf(resource) * ID_BITS + n, resource));
};

export const decryptShareId = (
  cipher: string,
  resource: string
): string | null => {
  if (!cipher || cipher.length !== WIDTH) return null;
  const v = fromBase62(cipher);
  if (v === null) return null;
  const plain = inverse(v, resource);
  if (Math.floor(plain / ID_BITS) !== tagOf(resource)) return null;
  const id = plain % ID_BITS;
  return id >= 1 ? String(id) : null;
};
