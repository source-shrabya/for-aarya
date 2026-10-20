// Encrypts letter.jpg so any of the given passwords opens it, and writes letter.js.
// Usage: node lock.mjs "Aarya's password" "Shrabya's password"
import { readFileSync, writeFileSync } from "node:fs";

const passwords = process.argv.slice(2);
if (!passwords.length) {
  console.error('Usage: node lock.mjs "Aarya\'s password" "Shrabya\'s password"');
  process.exit(1);
}

// Same clean-up as the page does: stray spaces are ignored, case is not.
const normalise = s => s.trim();

const image = readFileSync(new URL("./letter.jpg", import.meta.url));
const iterations = 250000;
const b64 = bytes => Buffer.from(bytes).toString("base64");

// The photo is locked once with a random key. That key is then locked again with each password.
const photoKey = crypto.getRandomValues(new Uint8Array(32));
const iv = crypto.getRandomValues(new Uint8Array(12));
const key = await crypto.subtle.importKey("raw", photoKey, "AES-GCM", false, ["encrypt"]);
const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, image));

const keys = [];
for (const password of passwords) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyIv = crypto.getRandomValues(new Uint8Array(12));
  const baseKey = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(normalise(password)), "PBKDF2", false, ["deriveKey"]
  );
  const passKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    baseKey, { name: "AES-GCM", length: 256 }, false, ["encrypt"]
  );
  const locked = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: keyIv }, passKey, photoKey));
  keys.push({ salt: b64(salt), iv: b64(keyIv), key: b64(locked) });
}

const out = `window.LETTER = ${JSON.stringify({
  type: "image/jpeg", iv: b64(iv), data: b64(data), iterations, keys,
})};\n`;

writeFileSync(new URL("./letter.js", import.meta.url), out);
console.log(`Locked for ${passwords.length} password${passwords.length > 1 ? "s" : ""}. letter.js is ready.`);
