import { createCipheriv } from "crypto";

// Staging (websankul-api-staging) alphabets; video-URL decrypt on the client
// depends on this exact scheme: each digit 0..9 of the 16-digit numeric token
// selects one character from each alphabet.
const KEY_ALPHABET = "!*@#)($^%1fgv&C3";
const VECTOR_ALPHABET = "?\\:><{}@#Vjekl44";

/**
 * Returns a numeric string with exactly `digits` digits (matches staging's
 * Math.floor(10^(n-1) + random*(10^n - 10^(n-1) - 1))).
 */
export function generateToken(digits: number): string {
  const lo = Math.pow(10, digits - 1);
  const hi = Math.pow(10, digits) - Math.pow(10, digits - 1) - 1;
  return String(Math.floor(lo + Math.random() * hi));
}

export function generateKey(token: string): Buffer {
  let key = "";
  for (const ch of token) {
    key += KEY_ALPHABET.charAt(Number(ch));
  }
  return Buffer.from(key, "utf8");
}

export function generateVector(token: string): Buffer {
  let iv = "";
  for (const ch of token) {
    iv += VECTOR_ALPHABET.charAt(Number(ch));
  }
  return Buffer.from(iv, "utf8");
}

/**
 * AES-128-CBC with PKCS7 padding, base64-encoded ciphertext. Byte-identical to
 * CryptoJS.AES.encrypt(plain, Utf8.parse(key), { iv: Utf8.parse(iv) }).toString()
 * as used in websankul-api-staging.
 */
export function encrypt(plain: string, key: Buffer, vector: Buffer): string {
  const cipher = createCipheriv("aes-128-cbc", key, vector);
  const encrypted = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  return encrypted.toString("base64");
}
