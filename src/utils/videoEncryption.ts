// Video URL encryption: AES token scheme the client uses to decrypt video URLs.
import { createCipheriv, createDecipheriv } from "crypto";

// Client video-URL decryption depends on this exact scheme: each digit of the
// 16-digit numeric token selects one character from each alphabet.
const KEY_ALPHABET = "!*@#)($^%1fgv&C3";
const VECTOR_ALPHABET = "?\\:><{}@#Vjekl44";

/** Numeric string with exactly `digits` digits. */
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
 * AES-128-CBC/PKCS7, base64 output. Byte-identical to
 * CryptoJS.AES.encrypt(plain, Utf8.parse(key), { iv: Utf8.parse(iv) }).toString().
 */
export function encrypt(plain: string, key: Buffer, vector: Buffer): string {
  const cipher = createCipheriv("aes-128-cbc", key, vector);
  const encrypted = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  return encrypted.toString("base64");
}

/**
 * Inverse of `encrypt`. Used to unwrap VideoCrypt's per-quality MP4 URLs
 * (encrypted with their own data.token) before re-encrypting with ours.
 */
export function decrypt(ciphertextBase64: string, key: Buffer, vector: Buffer): string {
  const decipher = createDecipheriv("aes-128-cbc", key, vector);
  const decrypted = Buffer.concat([
    decipher.update(ciphertextBase64, "base64"),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/**
 * Per-response crypto context: one 16-digit `token` plus an `enc()` using the key+IV
 * derived from it. Ship `token` with the ciphertexts so the client can decrypt.
 * Nullish/empty input encrypts to "". Use wherever a response would otherwise
 * leak a raw playable URL, to stay on the `/v1/lecture` {token, ciphertext} contract.
 */
export function newEncryptor(): {
  token: string;
  enc: (value: string | null | undefined) => string;
} {
  const token = generateToken(16);
  const key = generateKey(token);
  const vector = generateVector(token);
  return {
    token,
    enc: (value) => (value ? encrypt(value, key, vector) : ""),
  };
}
