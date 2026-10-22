// The bot's server. Everything needs one of the two passwords, which also says who is asking.
//   GET  /api/settings        -> current settings, and who is asking
//   POST /api/chat {message, history} -> asks Claude, saves the result, returns {reply, settings}
//   POST /api/undo, /api/reset
//   GET  /api/letters         -> the letters we have written each other, newest first, and the reactions on them
//   POST /api/reactions {letter, emoji} -> adds or takes back the asker's reaction ("first" is the first letter)
//   POST /api/letters {text, photo} -> adds a letter (photo is a base64 JPEG)
//   GET  /api/letters/<id>/photo    -> that letter's photo
//   POST /api/letters/<id>/delete   -> removes a letter, only by the one who wrote it
//   GET  /api/movies          -> our movie list: what we have watched and what we want to
//   GET  /api/movies/search?q=      -> movies matching a name, with year and poster (from IMDb's search box)
//   POST /api/movies {title, list, year, poster, imdb} -> adds a movie to "watched" or "bucket"
//   POST /api/movies/<id>/watched   -> moves a bucket-list movie to watched
//   POST /api/movies/<id>/delete    -> removes a movie
//   GET  /api/pictures        -> our pictures, newest taken first
//   POST /api/pictures {photo, thumb, caption, taken} -> adds a picture (both base64 JPEGs)
//   GET  /api/pictures/<id>/photo, /api/pictures/<id>/thumb -> the picture, or its small copy
//   POST /api/pictures/<id>/delete  -> removes a picture, only by the one who added it
import Anthropic from "@anthropic-ai/sdk";
import { getStore } from "@netlify/blobs";
import { createHash, timingSafeEqual } from "node:crypto";
import { DEFAULT_SETTINGS, RESPONSE_SCHEMA, SYSTEM_PROMPT, applyChanges, sanitize } from "../lib/settings.mjs";

const ALLOWED_ORIGINS = ["https://source-shrabya.github.io"];
const HISTORY_LIMIT = 20;   // versions kept for undo
const MAX_TEXT = 20000;     // characters in a typed letter
const MAX_PHOTO = 4 << 20;  // bytes in a letter photo or a picture
const MAX_THUMB = 1 << 19;  // bytes in a picture's small copy
const MAX_CAPTION = 300;    // characters under a picture
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
  const letter = { id: newId(), from, date: new Date().toISOString(), text, photo: Boolean(bytes) };
  if (bytes) await store.set(`photo-${letter.id}`, bytes);
  await store.setJSON("letters", [letter, ...await lettersIn(store)]);
  return letter;
}

// Pictures: one list with the details, and each picture and its small copy stored on their own.
const picturesIn = async store => (await store.get("pictures", { type: "json" })) ?? [];
// JPEG files start FF D8 FF
const jpeg = (b64, max) => {
  if (typeof b64 !== "string" || !b64) return null;
  const bytes = Buffer.from(b64, "base64");
  return bytes.length <= max && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? bytes : null;
};
const dayOk = d => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
const newestFirst = (a, b) => b.taken.localeCompare(a.taken) || b.added.localeCompare(a.added);

async function addPicture(store, by, { photo, thumb, caption, taken }) {
  const big = jpeg(photo, MAX_PHOTO), small = jpeg(thumb, MAX_THUMB);
  if (!big || !small) return null;
  const added = new Date().toISOString();
  const picture = {
    id: newId(),
    by,
    added,
    taken: dayOk(taken) ? taken : added.slice(0, 10),
    caption: typeof caption === "string" ? caption.trim().slice(0, MAX_CAPTION) : "",
  };
  await store.set(`picture-${picture.id}`, big);
  await store.set(`picture-thumb-${picture.id}`, small);
  await store.setJSON("pictures", [picture, ...await picturesIn(store)].sort(newestFirst));
  return picture;
}

// Reactions: { letter id or "first": { emoji: [names] } }. Only emoji from this list.
const REACTIONS = ["❤️", "🥰", "😍", "😘", "🫂", "😭", "😂", "🤍", "🌸", "✨", "🙏", "😤", "🥺", "💌", "🫶"];
const reactionsIn = async store => (await store.get("reactions", { type: "json" })) ?? {};

async function toggleReaction(store, me, letter, emoji) {
  const all = await reactionsIn(store);
  const names = all[letter]?.[emoji] ?? [];
  const next = names.includes(me) ? names.filter(n => n !== me) : [...names, me];
  all[letter] = { ...all[letter], [emoji]: next };
  if (!next.length) delete all[letter][emoji];
  if (!Object.keys(all[letter]).length) delete all[letter];
  await store.setJSON("reactions", all);
  return all[letter] ?? {};
}

// Movies: one list. The first time it is read it starts with what we had already
// watched and planned before the page had a list.
const STARTING_MOVIES = [
  { title: "Narnia", list: "watched", year: 2005, imdb: "tt0363771", poster: "https://m.media-amazon.com/images/M/MV5BMTc0NTUwMTU5OV5BMl5BanBnXkFtZTcwNjAwNzQzMw@@._V1_.jpg" },
  { title: "Man in Love", list: "watched", year: 2021, imdb: "tt14428606" },
  { title: "Tangled", list: "watched", year: 2010, imdb: "tt0398286", poster: "https://m.media-amazon.com/images/M/MV5BMTAxNDYxMjg0MjNeQTJeQWpwZ15BbWU3MDcyNTk2OTM@._V1_.jpg" },
  { title: "Twilight", list: "watched", year: 2008, imdb: "tt1099212", poster: "https://m.media-amazon.com/images/M/MV5BMTQ2NzUxMTAxN15BMl5BanBnXkFtZTcwMzEyMTIwMg@@._V1_.jpg" },
  { title: "Dhurandhar", list: "watched", year: 2025, imdb: "tt33014583", poster: "https://m.media-amazon.com/images/M/MV5BMzFiNTVkZjYtM2I3Yi00MGNjLWEyYTAtMGViNGExZmMzMGMzXkEyXkFqcGc@._V1_.jpg" },
  { title: "Dhurandhar 2", list: "watched", year: 2026, imdb: "tt39139925", poster: "https://m.media-amazon.com/images/M/MV5BMzE2ZmIzNTEtZTE1OS00ZDFhLTk2Y2YtZDEyNGIxNTdiYWFlXkEyXkFqcGc@._V1_.jpg" },
  { title: "Palm Springs", list: "bucket", year: 2020, imdb: "tt9484998", poster: "https://m.media-amazon.com/images/M/MV5BY2VkNGY0MTMtMjEzZi00OThkLWJiOTMtNGU4ZGNjZDE5ZGIyXkEyXkFqcGc@._V1_.jpg" },
  { title: "Avatar", list: "bucket", year: 2009, imdb: "tt0499549", poster: "https://m.media-amazon.com/images/M/MV5BMDEzMmQwZjctZWU2My00MWNlLWE0NjItMDJlYTRlNGJiZjcyXkEyXkFqcGc@._V1_.jpg" },
];
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function moviesIn(store) {
  const saved = await store.get("movies", { type: "json" });
  if (saved) {
    // a list saved before posters existed: give the starting movies theirs
    let changed = false;
    for (const m of saved) {
      const start = !m.poster && STARTING_MOVIES.find(s => s.title === m.title && s.poster);
      if (start) { Object.assign(m, { year: start.year, imdb: start.imdb, poster: start.poster }); changed = true; }
    }
    if (changed) await store.setJSON("movies", saved);
    return saved;
  }
  const date = new Date().toISOString();
  const movies = STARTING_MOVIES.map((m, i) => ({ id: newId() + i, ...m, by: "Shrabya", added: date }));
  await store.setJSON("movies", movies);
  return movies;
}

// IMDb's own search box answers this without a key. It is not a documented API, so if it
// stops working the page still lets us add a movie by typing its name.
const SEARCH_KINDS = ["movie", "tvMovie", "tvSeries", "tvMiniSeries"];
async function searchMovies(q) {
  const query = q.trim().toLowerCase().slice(0, 60);
  if (!query) return [];
  const res = await fetch(`https://v2.sg.media-imdb.com/suggestion/x/${encodeURIComponent(query)}.json`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error("search failed");
  const { d = [] } = await res.json();
  return d
    .filter(r => SEARCH_KINDS.includes(r.qid) && /^tt\d+$/.test(r.id))
    .slice(0, 8)
    .map(r => ({ title: r.l, year: r.y ?? null, imdb: r.id, series: r.qid.startsWith("tvSeries") || r.qid === "tvMiniSeries", poster: r.i?.imageUrl ?? null, stars: r.s ?? "" }));
}

// Only keep details that look like what the search gives back
const posterOk = p => typeof p === "string" && /^https:\/\/m\.media-amazon\.com\/images\/[^\s"'<>()\\]+$/.test(p) && p.length < 400;
const yearOk = y => Number.isInteger(y) && y > 1880 && y < 2100;

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

  // strong: a read straight after a write sees it (the default can lag by up to a minute)
  const store = getStore({ name: "love-letter", consistency: "strong" });
  const route = new URL(req.url).pathname.replace(/^\/api\//, "");
  const [, letterId, letterAction] = route.match(/^letters\/([a-z0-9]+)\/(photo|delete)$/) ?? [];
  const [, movieId, movieAction] = route.match(/^movies\/([a-z0-9]+)\/(watched|delete)$/) ?? [];
  const [, pictureId, pictureAction] = route.match(/^pictures\/([a-z0-9]+)\/(photo|thumb|delete)$/) ?? [];

  try {
    if (req.method === "GET" && route === "settings") return send({ settings: await load(store), me });

    if (req.method === "GET" && route === "movies") return send({ movies: await moviesIn(store) });
    if (req.method === "GET" && route === "movies/search") {
      try { return send({ results: await searchMovies(new URL(req.url).searchParams.get("q") ?? "") }); }
      catch { return send({ error: "The movie search isn't answering. You can still add it by name." }, 502); }
    }
    if (req.method === "GET" && route === "letters") {
      const [letters, reactions] = await Promise.all([lettersIn(store), reactionsIn(store)]);
      return send({ letters, reactions });
    }
    if (req.method === "GET" && letterAction === "photo") {
      const bytes = await store.get(`photo-${letterId}`, { type: "arrayBuffer" });
      if (!bytes) return send({ error: "not found" }, 404);
      return new Response(bytes, { headers: { ...cors(origin), "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000" } });
    }
    if (req.method === "GET" && route === "pictures") return send({ pictures: await picturesIn(store) });
    if (req.method === "GET" && (pictureAction === "photo" || pictureAction === "thumb")) {
      const bytes = await store.get(`picture-${pictureAction === "thumb" ? "thumb-" : ""}${pictureId}`, { type: "arrayBuffer" });
      if (!bytes) return send({ error: "not found" }, 404);
      return new Response(bytes, { headers: { ...cors(origin), "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000" } });
    }
    if (req.method !== "POST") return send({ error: "not found" }, 404);

    if (route === "reactions") {
      const { letter, emoji } = await req.json();
      if (!REACTIONS.includes(emoji)) return send({ error: "That one isn't on the list." }, 400);
      if (letter !== "first" && !(await lettersIn(store)).some(l => l.id === letter)) return send({ error: "That letter is gone." }, 404);
      return send({ reactions: await toggleReaction(store, me, letter, emoji) });
    }
    if (route === "pictures") {
      const picture = await addPicture(store, me, await req.json());
      if (!picture) return send({ error: "That picture didn't come through. Try it again." }, 400);
      return send({ picture });
    }
    if (pictureAction === "delete") {
      const pictures = await picturesIn(store);
      const picture = pictures.find(p => p.id === pictureId);
      if (!picture) return send({ error: "That picture is already gone." }, 404);
      if (picture.by !== me) return send({ error: "Only the one who added it can remove it." }, 403);
      await store.setJSON("pictures", pictures.filter(p => p.id !== pictureId));
      await store.delete(`picture-${pictureId}`);
      await store.delete(`picture-thumb-${pictureId}`);
      return send({ ok: true });
    }

    if (route === "letters") {
      const letter = await addLetter(store, me, await req.json());
      if (!letter) return send({ error: "Write something or add a photo first." }, 400);
      return send({ letter });
    }
    if (route === "movies") {
      const { title, list, year, poster, imdb } = await req.json();
      const name = typeof title === "string" ? title.trim().slice(0, 120) : "";
      if (!name) return send({ error: "Write the movie's name first." }, 400);
      const movies = await moviesIn(store);
      const twin = movies.find(m => (imdb && m.imdb === imdb) || m.title.toLowerCase() === name.toLowerCase());
      if (twin) return send({ error: `${twin.title} is already on the ${twin.list === "watched" ? "watched" : "to-watch"} list.` }, 409);
      const movie = { id: newId(), title: name, list: list === "watched" ? "watched" : "bucket", by: me, added: new Date().toISOString() };
      if (yearOk(year)) movie.year = year;
      if (posterOk(poster)) movie.poster = poster;
      if (typeof imdb === "string" && /^tt\d{1,10}$/.test(imdb)) movie.imdb = imdb;
      if (movie.list === "watched") movie.watched = movie.added;
      await store.setJSON("movies", [...movies, movie]);
      return send({ movie });
    }
    if (movieAction) {
      const movies = await moviesIn(store);
      const movie = movies.find(m => m.id === movieId);
      if (!movie) return send({ error: "That movie is not on the list any more." }, 404);
      if (movieAction === "delete") {
        await store.setJSON("movies", movies.filter(m => m.id !== movieId));
        return send({ ok: true });
      }
      Object.assign(movie, { list: "watched", watched: new Date().toISOString() });
      await store.setJSON("movies", movies);
      return send({ movie });
    }
    if (letterAction === "delete") {
      const letters = await lettersIn(store);
      const letter = letters.find(l => l.id === letterId);
      if (!letter) return send({ error: "That letter is already gone." }, 404);
      if (letter.from !== me) return send({ error: "Only the one who wrote it can remove it." }, 403);
      await store.setJSON("letters", letters.filter(l => l.id !== letterId));
      if (letter.photo) await store.delete(`photo-${letterId}`);
      const reactions = await reactionsIn(store);
      if (reactions[letterId]) { delete reactions[letterId]; await store.setJSON("reactions", reactions); }
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
