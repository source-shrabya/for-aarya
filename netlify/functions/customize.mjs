// The bot's server. Everything needs one of the two passwords, which also says who is asking.
//   GET  /api/settings        -> current settings, and who is asking
//   POST /api/chat {message, history} -> asks Claude, saves the result, returns {reply, settings}
//   POST /api/undo, /api/reset
//   GET  /api/letters         -> the letters we have written each other, newest first
//   POST /api/letters {text, photo} -> adds a letter (photo is a base64 JPEG)
//   GET  /api/letters/<id>/photo    -> that letter's photo
//   POST /api/letters/<id>/delete   -> removes a letter, only by the one who wrote it
import Anthropic from "@anthropic-ai/sdk";
import { getStore } from "@netlify/blobs";
import { createHash, timingSafeEqual } from "node:crypto";
import { DEFAULT_SETTINGS, RESPONSE_SCHEMA, SYSTEM_PROMPT, applyChanges, sanitize } from "../lib/settings.mjs";

const ALLOWED_ORIGINS = ["https://source-shrabya.github.io"];
const HISTORY_LIMIT = 20;   // versions kept for undo
const MAX_TEXT = 20000;     // characters in a typed letter
const MAX_PHOTO = 4 << 20;  // bytes in a letter photo
const client = new Anthropic(); // reads ANTHROPIC_API_KEY

const cors = origin => ({
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) || /^http:\/\/localhost:\d+$/.test(origin ?? "") ? origin : ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-letter-password",
  "Vary": "Origin",
});

const sha = s => createHash("sha256").update(s).digest();
// SITE_PASSWORD is the one Aarya has always used. SHRABYA_PASSWORD is mine.
const PASSWORDS = { Aarya: "SITE_PASSWORD", Shrabya: "SHRABYA_PASSWORD" };
function whoIs(given) {
  if (typeof given !== "string") return null;
  for (const [name, env] of Object.entries(PASSWORDS)) {
    const real = process.env[env];
    if (real && timingSafeEqual(sha(given.trim()), sha(real))) return name;
  }
  return null;
}

async function load(store) {
  const saved = await store.get("settings", { type: "json" });
  return saved ? sanitize(saved) : DEFAULT_SETTINGS;
}
async function save(store, current, next) {
  const history = (await store.get("history", { type: "json" })) ?? [];
  history.push(current);
  await store.setJSON("history", history.slice(-HISTORY_LIMIT));
  await store.setJSON("settings", next);
}
async function undo(store) {
  const history = (await store.get("history", { type: "json" })) ?? [];
  const previous = history.pop();
  if (!previous) return null;
  await store.setJSON("history", history);
  await store.setJSON("settings", previous);
  return sanitize(previous);
}

// Letters: one list with the text and details, and each photo stored on its own.
const lettersIn = async store => (await store.get("letters", { type: "json" })) ?? [];

async function addLetter(store, from, { text, photo }) {
  text = typeof text === "string" ? text.trim().slice(0, MAX_TEXT) : "";
  let bytes = null;
  if (typeof photo === "string" && photo) {
    bytes = Buffer.from(photo, "base64");
    // JPEG files start FF D8 FF
    if (bytes.length > MAX_PHOTO || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  }
  if (!text && !bytes) return null;
  const letter = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), from, date: new Date().toISOString(), text, photo: Boolean(bytes) };
  if (bytes) await store.set(`photo-${letter.id}`, bytes);
  await store.setJSON("letters", [letter, ...await lettersIn(store)]);
  return letter;
}

// Earlier turns are sent as plain text so Claude knows what "make it bigger" refers to.
function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  const turns = history
    .filter(t => t && (t.role === "user" || t.role === "assistant") && typeof t.text === "string" && t.text.trim())
    .slice(-12)
    .map(t => ({ role: t.role, content: t.text.slice(0, 1000) }));
  while (turns.length && turns[0].role !== "user") turns.shift();
  // the API wants user and assistant to take turns
  return turns.filter((t, i) => i === 0 || t.role !== turns[i - 1].role);
}

async function askClaude(current, message, history) {
  const past = cleanHistory(history);
  if (past.length && past[past.length - 1].role === "user") past.pop();
  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: RESPONSE_SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [
      ...past,
      { role: "user", content: `Current settings:\n${JSON.stringify(current)}\n\nHer request:\n${message}` },
    ],
  });
  if (response.stop_reason === "refusal") return { reply: "I can't help with that one.", action: "none", changes: {} };
  if (response.stop_reason === "max_tokens") throw new Error("answer was cut off");
  const textBlock = response.content.find(b => b.type === "text");
  if (!textBlock) throw new Error("no answer");
  return JSON.parse(textBlock.text);
}

export default async (req) => {
  const origin = req.headers.get("origin");
  const headers = { ...cors(origin), "Content-Type": "application/json", "Cache-Control": "no-store" };
  const send = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  const me = whoIs(req.headers.get("x-letter-password"));
  if (!me) return send({ error: "wrong password" }, 401);

  const store = getStore("love-letter");
  const route = new URL(req.url).pathname.replace(/^\/api\//, "");
  const [, letterId, letterAction] = route.match(/^letters\/([a-z0-9]+)\/(photo|delete)$/) ?? [];

  try {
    if (req.method === "GET" && route === "settings") return send({ settings: await load(store), me });

    if (req.method === "GET" && route === "letters") return send({ letters: await lettersIn(store) });
    if (req.method === "GET" && letterAction === "photo") {
      const bytes = await store.get(`photo-${letterId}`, { type: "arrayBuffer" });
      if (!bytes) return send({ error: "not found" }, 404);
      return new Response(bytes, { headers: { ...cors(origin), "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000" } });
    }
    if (req.method !== "POST") return send({ error: "not found" }, 404);

    if (route === "letters") {
      const letter = await addLetter(store, me, await req.json());
      if (!letter) return send({ error: "Write something or add a photo first." }, 400);
      return send({ letter });
    }
    if (letterAction === "delete") {
      const letters = await lettersIn(store);
      const letter = letters.find(l => l.id === letterId);
      if (!letter) return send({ error: "That letter is already gone." }, 404);
      if (letter.from !== me) return send({ error: "Only the one who wrote it can remove it." }, 403);
      await store.setJSON("letters", letters.filter(l => l.id !== letterId));
      if (letter.photo) await store.delete(`photo-${letterId}`);
      return send({ ok: true });
    }

    if (route === "undo") {
      const previous = await undo(store);
      return send({ reply: previous ? "Undone." : "There is nothing to undo.", settings: previous ?? await load(store) });
    }
    if (route === "reset") {
      const current = await load(store);
      await save(store, current, DEFAULT_SETTINGS);
      return send({ reply: "Back to how Shrabya made it.", settings: DEFAULT_SETTINGS });
    }
    if (route !== "chat") return send({ error: "not found" }, 404);

    const { message, history } = await req.json();
    if (typeof message !== "string" || !message.trim()) return send({ error: "empty message" }, 400);

    const current = await load(store);
    const answer = await askClaude(current, message.slice(0, 1000), history);
    const reply = typeof answer.reply === "string" ? answer.reply.slice(0, 600) : "Done.";

    if (answer.action === "undo") {
      const previous = await undo(store);
      return send({ reply: previous ? reply : "There is nothing to undo.", settings: previous ?? current });
    }
    if (answer.action === "reset") {
      await save(store, current, DEFAULT_SETTINGS);
      return send({ reply, settings: DEFAULT_SETTINGS });
    }
    if (answer.action === "change") {
      const next = applyChanges(current, answer.changes);
      if (JSON.stringify(next) !== JSON.stringify(current)) await save(store, current, next);
      return send({ reply, settings: next });
    }
    return send({ reply, settings: current });
  } catch (err) {
    console.error(err);
    if (err instanceof Anthropic.RateLimitError) return send({ error: "The bot is busy. Try again in a minute." }, 503);
    if (err instanceof Anthropic.AuthenticationError) return send({ error: "The bot's API key is not set up right." }, 500);
    if (err instanceof Anthropic.APIConnectionError) return send({ error: "Couldn't reach the bot. Try again." }, 502);
    return send({ error: "Something went wrong. Try again." }, 500);
  }
};

export const config = { path: "/api/*" };
