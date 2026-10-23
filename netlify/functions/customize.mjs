// The bot's server. Everything needs one of the two passwords, which also says who is asking.
//   GET  /api/settings        -> current settings, and who is asking
//   POST /api/chat {message, history} -> asks Claude, saves the result, returns {reply, settings}
//   POST /api/undo, /api/reset
//   GET  /api/letters         -> the letters we have written each other, newest first, and the reactions on them
//   POST /api/reactions {letter, emoji} -> adds or takes back the asker's reaction ("first" is the first letter)
//   POST /api/letters {text, photo} -> adds a letter (photo is a base64 JPEG)
//   GET  /api/letters/<id>/photo    -> that letter's photo
//   POST /api/letters/<id>/delete   -> removes a letter, only by the one who wrote it
//   GET  /api/movies          -> our movie list: what we have watched and what we want to, in our order
//   GET  /api/movies/search?q=      -> movies matching a name, with year and poster (from IMDb's search box)
//   POST /api/movies {title, list, year, poster, imdb} -> adds a movie to "watched" or "bucket"
//   POST /api/movies/<id>/watched   -> moves a bucket-list movie to watched
//   POST /api/movies/<id>/delete    -> removes a movie
//   GET  /api/pictures        -> our pictures, in our order (a new one goes on top)
//   POST /api/pictures {photo, thumb, caption, taken} -> adds a picture (both base64 JPEGs); its day is today unless one is picked
//   GET  /api/pictures/<id>/photo, /api/pictures/<id>/thumb -> the picture, or its small copy
//   POST /api/pictures/<id>/delete  -> removes a picture, only by the one who added it
//   POST /api/pictures/<id>/day {taken}  -> changes the day shown on a picture
//   POST /api/pictures/<id>/comment {text} -> adds the asker's comment under a picture
//   POST /api/pictures/<id>/uncomment {comment} -> removes a comment, only by the one who wrote it
//   GET  /api/songs           -> songs we have sent each other, in our order, and who is asking
//   GET  /api/songs/search?q=       -> songs matching a name, with artist, cover and a 30 second preview (from iTunes)
//   GET  /api/songs/link?url=       -> the name and picture behind a YouTube or Spotify link
//   POST /api/songs {title, artist, cover, preview, apple, link, note} -> sends a song
//   POST /api/songs/<id>/love       -> adds or takes back the asker's heart
//   POST /api/songs/<id>/delete     -> removes a song, only by the one who sent it
//   POST /api/movies/order, /api/pictures/order, /api/songs/order {ids} -> saves the order we dragged them into
//   GET  /api/avatars         -> when each of us last changed our profile picture (null if never), and who is asking
//   GET  /api/avatars/<name>  -> that profile picture
//   POST /api/avatars {photo} -> sets the asker's profile picture (a small square base64 JPEG)
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
const MAX_NOTE = 300;       // characters sent with a song
const MAX_COMMENT = 500;    // characters in a comment under a picture
const MAX_AVATAR = 1 << 18; // bytes in a profile picture
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
    comments: [],
  };
  await store.set(`picture-${picture.id}`, big);
  await store.set(`picture-thumb-${picture.id}`, small);
  await store.setJSON("pictures", [picture, ...await picturesIn(store)]);
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

// Songs: one list, newest first unless we have dragged them around.
const songsIn = async store => (await store.get("songs", { type: "json" })) ?? [];

// iTunes search needs no key and has most Nepali songs too
async function searchSongs(q) {
  const query = q.trim().slice(0, 80);
  if (!query) return [];
  const url = `https://itunes.apple.com/search?media=music&entity=song&limit=10&term=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error("search failed");
  const { results = [] } = await res.json();
  return results.map(r => ({
    title: r.trackName,
    artist: r.artistName,
    year: r.releaseDate ? Number(r.releaseDate.slice(0, 4)) : null,
    cover: r.artworkUrl100?.replace(/\/100x100bb\./, "/300x300bb.") ?? null,
    preview: r.previewUrl ?? null,
    apple: r.trackViewUrl?.replace(/[?&]uo=\d+$/, "") ?? null,
  }));
}

// A pasted YouTube or Spotify link: both sites say what is behind it without a key
const YOUTUBE = /^https:\/\/(www\.|m\.|music\.)?(youtube\.com\/(watch\?|shorts\/)|youtu\.be\/)[^\s"'<>\\]+$/;
const SPOTIFY = /^https:\/\/open\.spotify\.com\/(intl-[a-z-]+\/)?(track|album|playlist)\/[A-Za-z0-9]+[^\s"'<>\\]*$/;
const linkOk = l => typeof l === "string" && l.length < 300 && (YOUTUBE.test(l) || SPOTIFY.test(l));
async function lookUpLink(link) {
  if (!linkOk(link)) return null;
  const oembed = YOUTUBE.test(link) ? "https://www.youtube.com/oembed?format=json&url=" : "https://open.spotify.com/oembed?url=";
  const res = await fetch(oembed + encodeURIComponent(link), { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return null;
  const o = await res.json();
  // YouTube's default thumbnail has black bars above and below; the medium one does not
  const cover = o.thumbnail_url?.replace(/\/hqdefault\.jpg$/, "/mqdefault.jpg") ?? null;
  return { title: o.title ?? "", artist: o.author_name ?? "", cover, link };
}

// Only keep details that look like what the search or the link gives back
const urlOk = (u, host) => typeof u === "string" && u.length < 500 && host.test(u) && !/[\s"'<>()\\]/.test(u);
const COVER = /^https:\/\/(is\d+-ssl\.mzstatic\.com|i\.ytimg\.com|image-cdn-[a-z0-9-]+\.spotifycdn\.com|i\.scdn\.co)\//;
const PREVIEW = /^https:\/\/audio-ssl\.itunes\.apple\.com\//;
const APPLE = /^https:\/\/music\.apple\.com\//;
const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Puts the items named in ids into that order, in the places those items already hold.
// Items not named keep their places, so the to-watch list can be reordered without touching
// the watched one, and a song added while the other one was dragging is not lost.
function reorder(items, ids) {
  if (!Array.isArray(ids)) return null;
  const byId = new Map(items.map(i => [i.id, i]));
  const wanted = [...new Set(ids)].filter(id => byId.has(id));
  const named = new Set(wanted);
  return items.map(i => named.has(i.id) ? byId.get(wanted.shift()) : i);
}

async function addSong(store, by, body) {
  const song = { id: newId(), title: text(body.title, 150), artist: text(body.artist, 120), by, added: new Date().toISOString(), note: text(body.note, MAX_NOTE), loves: [] };
  if (!song.title) return { error: "Find a song or paste a link first." };
  if (urlOk(body.cover, COVER)) song.cover = body.cover;
  if (urlOk(body.preview, PREVIEW)) song.preview = body.preview;
  if (urlOk(body.apple, APPLE)) song.apple = body.apple;
  if (linkOk(body.link)) song.link = body.link;
  const songs = await songsIn(store);
  const same = s => s.title.toLowerCase() === song.title.toLowerCase() && s.artist.toLowerCase() === song.artist.toLowerCase();
  const twin = songs.find(s => (song.link && s.link === song.link) || same(s));
  if (twin) return { error: `${twin.by} already sent ${twin.title}.` };
  await store.setJSON("songs", [song, ...songs]);
  return { song };
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

  // strong: a read straight after a write sees it (the default can lag by up to a minute)
  const store = getStore({ name: "love-letter", consistency: "strong" });
  const route = new URL(req.url).pathname.replace(/^\/api\//, "");
  const [, letterId, letterAction] = route.match(/^letters\/([a-z0-9]+)\/(photo|delete)$/) ?? [];
  const [, movieId, movieAction] = route.match(/^movies\/([a-z0-9]+)\/(watched|delete)$/) ?? [];
  const [, pictureId, pictureAction] = route.match(/^pictures\/([a-z0-9]+)\/(photo|thumb|delete|day|comment|uncomment)$/) ?? [];
  const [, songId, songAction] = route.match(/^songs\/([a-z0-9]+)\/(love|delete)$/) ?? [];
  const [, orderOf] = route.match(/^(movies|pictures|songs)\/order$/) ?? [];
  const [, avatarOf] = route.match(/^avatars\/(Aarya|Shrabya)$/) ?? [];

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
    if (req.method === "GET" && route === "avatars") return send({ avatars: { Aarya: null, Shrabya: null, ...await store.get("avatars", { type: "json" }) }, me });
    if (req.method === "GET" && avatarOf) {
      const bytes = await store.get(`avatar-${avatarOf}`, { type: "arrayBuffer" });
      if (!bytes) return send({ error: "not found" }, 404);
      return new Response(bytes, { headers: { ...cors(origin), "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000" } });
    }
    if (req.method === "GET" && route === "songs") return send({ songs: await songsIn(store), me });
    if (req.method === "GET" && route === "songs/search") {
      try { return send({ results: await searchSongs(new URL(req.url).searchParams.get("q") ?? "") }); }
      catch { return send({ error: "The song search isn't answering. Paste a YouTube or Spotify link instead." }, 502); }
    }
    if (req.method === "GET" && route === "songs/link") {
      const found = await lookUpLink(new URL(req.url).searchParams.get("url") ?? "").catch(() => null);
      if (!found) return send({ error: "That link didn't work. Use a YouTube or Spotify song link." }, 400);
      return send({ song: found });
    }
    if (req.method !== "POST") return send({ error: "not found" }, 404);

    if (route === "avatars") {
      const bytes = jpeg((await req.json()).photo, MAX_AVATAR);
      if (!bytes) return send({ error: "That picture didn't come through. Try another one." }, 400);
      await store.set(`avatar-${me}`, bytes);
      const avatars = { ...await store.get("avatars", { type: "json" }), [me]: Date.now() };
      await store.setJSON("avatars", avatars);
      return send({ avatars: { Aarya: null, Shrabya: null, ...avatars } });
    }
    if (route === "songs") {
      const { song, error } = await addSong(store, me, await req.json());
      if (error) return send({ error }, 400);
      return send({ song });
    }
    if (songAction) {
      const songs = await songsIn(store);
      const song = songs.find(s => s.id === songId);
      if (!song) return send({ error: "That song is already gone." }, 404);
      if (songAction === "delete") {
        if (song.by !== me) return send({ error: "Only the one who sent it can remove it." }, 403);
        await store.setJSON("songs", songs.filter(s => s.id !== songId));
        return send({ ok: true });
      }
      song.loves = song.loves.includes(me) ? song.loves.filter(n => n !== me) : [...song.loves, me];
      await store.setJSON("songs", songs);
      return send({ song });
    }

    if (req.method === "POST" && orderOf) {
      const listOf = { movies: moviesIn, pictures: picturesIn, songs: songsIn }[orderOf];
      const { ids } = await req.json();
      const next = reorder(await listOf(store), ids);
      if (!next) return send({ error: "That order didn't come through. Try dragging it again." }, 400);
      await store.setJSON(orderOf, next);
      return send({ ok: true });
    }
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
    if (pictureAction === "day" || pictureAction === "comment" || pictureAction === "uncomment") {
      const pictures = await picturesIn(store);
      const picture = pictures.find(p => p.id === pictureId);
      if (!picture) return send({ error: "That picture is gone." }, 404);
      const body = await req.json();
      picture.comments ??= [];
      if (pictureAction === "day") {
        if (!dayOk(body.taken)) return send({ error: "Pick a day first." }, 400);
        picture.taken = body.taken;
      } else if (pictureAction === "comment") {
        const words = text(body.text, MAX_COMMENT);
        if (!words) return send({ error: "Write something first." }, 400);
        picture.comments.push({ id: newId(), by: me, date: new Date().toISOString(), text: words });
      } else {
        const comment = picture.comments.find(c => c.id === body.comment);
        if (!comment) return send({ error: "That comment is already gone." }, 404);
        if (comment.by !== me) return send({ error: "Only the one who wrote it can remove it." }, 403);
        picture.comments = picture.comments.filter(c => c !== comment);
      }
      await store.setJSON("pictures", pictures);
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
      await store.setJSON("movies", [movie, ...movies]);
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
      // a movie we just watched goes to the top of the watched side
      Object.assign(movie, { list: "watched", watched: new Date().toISOString() });
      await store.setJSON("movies", [movie, ...movies.filter(m => m.id !== movieId)]);
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
