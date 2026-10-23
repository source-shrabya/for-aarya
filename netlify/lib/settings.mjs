// What the page can look like, and the checks that keep the bot inside those limits.
// The letter photo itself is not a setting: nothing here can hide or replace it.

export const ART = {
  "art/aslan-lucy.jpg": "Aslan lying in a sunlit forest with Lucy sitting in front of him (film still)",
  "art/ladybugs.jpg": "colourful swirly painting with heart-spotted ladybugs, a pink star, a seahorse",
  "art/sun.jpg": "Navajo-style cream sun with a spiral centre on rusty orange",
  "art/reepicheep.jpg": "pencil-and-ink drawing of Reepicheep the mouse with a red feather",
  "art/lamppost.jpg": "painting of Aslan sitting beside the lamppost in snowy woods",
  "art/aslan-sky.jpg": "soft painting of Aslan and a child on a rock under a pink and lilac sky",
  "art/aslan-forest.jpg": "painting of Aslan in a tall misty forest with a small figure in red",
  "art/sun-colour.jpg": "bright thick-paint sun bursting with rainbow colours",
  "art/dawn-treader.jpg": "framed oil painting of the Dawn Treader ship on stormy waves",
  "art/ladybug-mushroom.jpg": "a ladybug beside a red mushroom on green moss",
  "art/aslan-sunlit.jpg": "close-up painting of Aslan's face glowing gold in sunlight",
  "art/sun-swirl.jpg": "orange sun with wavy rays and a swirl centre on white",
};

export const FONTS = [
  "Tiro Devanagari Hindi", "Caveat", "Patrick Hand", "Indie Flower", "Dancing Script",
  "Homemade Apple", "Shadows Into Light", "Gloria Hallelujah", "Lora",
];
const PATTERNS = ["lined", "grid", "dots", "plain"];
const SIZES = ["small", "medium", "large"];
const PICTURE_STYLES = ["taped", "polaroid", "plain"];
const PLACES = ["left", "right", "top", "bottom"];
const EFFECTS = ["none", "hearts", "petals", "sparkles", "snow", "ladybugs", "stars"];

export const DEFAULT_SETTINGS = {
  paper: { color: "#c3b9a7", lines: "#5c6876", margin: "#c47868", pattern: "lined" },
  ink: "#1d2a50",
  font: "Lora",
  letter: { size: "medium", tilt: 0 },
  pictures: {
    style: "polaroid",
    left: [
      { src: "art/aslan-lucy.jpg", caption: "lucy & aslan" },
      { src: "art/ladybugs.jpg", caption: "lucky bugs" },
      { src: "art/sun.jpg", caption: "little sun" },
      { src: "art/reepicheep.jpg", caption: "brave" },
      { src: "art/lamppost.jpg", caption: "the lamppost" },
      { src: "art/aslan-sky.jpg", caption: "pink skies" },
    ],
    right: [
      { src: "art/aslan-forest.jpg", caption: "into the woods" },
      { src: "art/sun-colour.jpg", caption: "all the colours" },
      { src: "art/dawn-treader.jpg", caption: "the dawn treader" },
      { src: "art/ladybug-mushroom.jpg", caption: "a tiny visitor" },
      { src: "art/aslan-sunlit.jpg", caption: "golden" },
      { src: "art/sun-swirl.jpg", caption: "warm" },
    ],
  },
  notes: [],
  stickers: [],
  effect: "none",
};

// ---- checks -------------------------------------------------------------

const hex = (v, fallback) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : fallback);
const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);
const num = (v, min, max, fallback) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
const text = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

// A picture is one of ours, or an https image link someone pasted.
function picture(p) {
  if (!p || typeof p.src !== "string") return null;
  const src = p.src.trim();
  const ok = src in ART || (/^https:\/\/[^\s"'<>()\\]+$/.test(src) && src.length <= 600);
  return ok ? { src, caption: text(p.caption, 80) } : null;
}
const pictureList = list => (Array.isArray(list) ? list.map(picture).filter(Boolean).slice(0, 10) : []);

export function sanitize(s) {
  const d = DEFAULT_SETTINGS;
  s = s && typeof s === "object" ? s : {};
  const paper = s.paper || {}, letter = s.letter || {}, pics = s.pictures || {};
  return {
    paper: {
      color: hex(paper.color, d.paper.color),
      lines: hex(paper.lines, d.paper.lines),
      margin: hex(paper.margin, d.paper.margin),
      pattern: pick(paper.pattern, PATTERNS, d.paper.pattern),
    },
    ink: hex(s.ink, d.ink),
    font: pick(s.font, FONTS, d.font),
    letter: { size: pick(letter.size, SIZES, d.letter.size), tilt: num(letter.tilt, -5, 5, 0) },
    pictures: {
      style: pick(pics.style, PICTURE_STYLES, d.pictures.style),
      left: pictureList(pics.left),
      right: pictureList(pics.right),
    },
    notes: (Array.isArray(s.notes) ? s.notes : [])
      .map(n => n && typeof n.text === "string" && n.text.trim()
        ? { text: text(n.text, 280), place: pick(n.place, PLACES, "right"), color: hex(n.color, d.ink) }
        : null)
      .filter(Boolean).slice(0, 12),
    stickers: (Array.isArray(s.stickers) ? s.stickers : [])
      .map(st => st && typeof st.emoji === "string" && st.emoji.trim()
        ? {
            emoji: [...st.emoji.trim()].slice(0, 4).join(""),
            x: num(st.x, 0, 100, 50), y: num(st.y, 0, 100, 50),
            size: num(st.size, 16, 160, 48), rotate: num(st.rotate, -45, 45, 0),
          }
        : null)
      .filter(Boolean).slice(0, 40),
    effect: pick(s.effect, EFFECTS, "none"),
  };
}

// Apply the bot's changes (null = leave that part alone) on top of the current settings.
export function applyChanges(current, changes) {
  const next = { ...current };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (changes && changes[key] !== null && changes[key] !== undefined) next[key] = changes[key];
  }
  return sanitize(next);
}

// ---- the shape the bot must answer in ------------------------------------

const nullable = schema => ({ anyOf: [schema, { type: "null" }] });
const obj = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const str = { type: "string" };
const picSchema = obj({ src: str, caption: str });

export const RESPONSE_SCHEMA = obj({
  reply: str,
  action: { type: "string", enum: ["change", "undo", "reset", "none"] },
  changes: obj({
    paper: nullable(obj({ color: str, lines: str, margin: str, pattern: { type: "string", enum: PATTERNS } })),
    ink: nullable(str),
    font: nullable({ type: "string", enum: FONTS }),
    letter: nullable(obj({ size: { type: "string", enum: SIZES }, tilt: { type: "number" } })),
    pictures: nullable(obj({
      style: { type: "string", enum: PICTURE_STYLES },
      left: { type: "array", items: picSchema },
      right: { type: "array", items: picSchema },
    })),
    notes: nullable({ type: "array", items: obj({ text: str, place: { type: "string", enum: PLACES }, color: str }) }),
    stickers: nullable({ type: "array", items: obj({ emoji: str, x: { type: "number" }, y: { type: "number" }, size: { type: "number" }, rotate: { type: "number" } }) }),
    effect: nullable({ type: "string", enum: EFFECTS }),
  }),
});

export const SYSTEM_PROMPT = `You decorate a private web page. Shrabya made it for his girlfriend Aarya: it shows a photo of a handwritten Nepali love letter on notebook paper, with paintings taped down both sides. Only people who know the page's password can talk to you, and that is almost always Aarya. Change the page the way she asks.

You never touch the letter photo itself or the password; those are fixed. Everything else is a setting:

- paper: the page background. color, lines (ruled-line colour), margin (the red margin-line colour) are 6-digit hex like "#c3b9a7". pattern is ${PATTERNS.join(", ")}. The original paper is ${JSON.stringify(DEFAULT_SETTINGS.paper)}; it matches the letter photo, so if she drifts far from it the photo will look like a separate sheet. That is fine if she asks for it.
- ink: hex colour for handwritten notes.
- font: handwriting font for notes, one of ${FONTS.join(", ")}. Only Tiro Devanagari Hindi can write Nepali (Devanagari) text; Nepali letters in any other font are drawn in Tiro Devanagari Hindi automatically.
- letter: size (small, medium, large) and tilt in degrees (-5 to 5).
- pictures: style (taped = masking tape at an angle, polaroid = white frame with the caption underneath, plain = no frame) and two lists, left and right, top to bottom, at most 10 each. Each picture is {src, caption}. src is one of these files:
${Object.entries(ART).map(([k, v]) => `  ${k}: ${v}`).join("\n")}
  or an https image link the person pasted to you. You cannot search for or invent image links; if she wants a picture you do not have, ask her to paste a link to it.
- notes: little handwritten notes, at most 12. {text up to 280 characters, place (left, right, top or bottom of the letter), color hex}.
- stickers: emoji scattered over the page, at most 40. {emoji, x and y as percent of the page (0-100), size in px (16-160), rotate in degrees (-45 to 45)}. Keep them off the middle 30-70% of x where the letter is unless she asks.
- effect: something gently falling down the screen: ${EFFECTS.join(", ")}.

How to answer:
- In changes, give the full new value for each part you change and null for every part you leave alone. Lists are replaced whole, so when adding one item, repeat the existing items too.
- action is "change" when you changed something, "undo" when she wants the last change taken back, "reset" when she wants everything back to how Shrabya made it, and "none" when you are only talking (then every change is null).
- reply is one or two short, warm sentences saying what you did, in the language she wrote in (Nepali, English or a mix). If she asks for something you cannot do, say so plainly and offer the closest thing you can do.`;
