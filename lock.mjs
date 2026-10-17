// Encrypts letter.jpg with a password and writes letter.js.
// Usage: node lock.mjs "the password"
import { readFileSync, writeFileSync } from "node:fs";

const password = process.argv[2];
if (!password) {
  console.error('Usage: node lock.mjs "the password"');
  process.exit(1);
}

// Same clean-up as the page does, so "aarya" and " Aarya " both work.
const normalise = s => s.trim().toLowerCase();

const image = readFileSync(new URL("./letter.jpg", import.meta.url));
const iterations = 250000;
const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));

const baseKey = await crypto.subtle.importKey(
  "raw", new TextEncoder().encode(normalise(password)), "PBKDF2", false, ["deriveKey"]
);
const key = await crypto.subtle.deriveKey(
  { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
  baseKey, { name: "AES-GCM", length: 256 }, false, ["encrypt"]
);
const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, image));

const b64 = bytes => Buffer.from(bytes).toString("base64");
const out = `window.LETTER = ${JSON.stringify({
  type: "image/jpeg", salt: b64(salt), iv: b64(iv), data: b64(data), iterations,
})};\n`;

writeFileSync(new URL("./letter.js", import.meta.url), out);
console.log("Locked. letter.js is ready.");
