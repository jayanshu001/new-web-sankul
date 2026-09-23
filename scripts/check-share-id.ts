// Run: npx tsx scripts/check-share-id.ts
import assert from "assert";
import { buildShareUrl, encodeShareId, decodeShareId } from "../src/deeplinking/shareRedirect";

for (const id of [1, 9, 42, 120, 4113, 999999, 4294967295]) {
  for (const res of ["courses", "ebooks", "books", "packages", "test-series"]) {
    const tok = encodeShareId(res, id);
    assert.match(tok, /^[A-Za-z0-9_-]{7}$/, `token shape ${res}/${id}: ${tok}`);
    assert.doesNotMatch(tok, /^\d+$/, `token must not look like a legacy id: ${tok}`);
    assert.strictEqual(decodeShareId(res, tok), String(id), `round-trip ${res}/${id}`);
    assert.notStrictEqual(tok, String(id));
  }
  assert.notStrictEqual(encodeShareId("courses", id), encodeShareId("ebooks", id));
}

const url = buildShareUrl("ebooks", "120", "https://websankul.com");
assert.match(url, /^https:\/\/websankul\.com\/share\/ebooks\/[A-Za-z0-9_-]{7}$/, url);
assert.ok(!url.endsWith("/120"));

// Rejected by the decoder; the route then falls back to treating it as a plain id.
for (const bad of ["", "120", "abc", "!!!!!!!", "AAAAAAAAAAA"]) {
  assert.strictEqual(decodeShareId("courses", bad), null, `should reject: ${bad}`);
}

console.log("share-id cipher OK", url);
