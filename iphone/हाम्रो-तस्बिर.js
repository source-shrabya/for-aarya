// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: pink; icon-glyph: heart;
// हाम्रो तस्बिर: the iPhone home screen widget, for the free Scriptable app.
// Like the Android one: the newest picture the other one posted on our picture wall, with its caption.
// Run it once inside Scriptable to type the password; it is kept in the iPhone's Keychain.
// Tapping the widget opens the picture wall. iOS decides when widgets refresh, usually every 15 to 30 minutes.

const API = "https://for-aarya-bot.netlify.app/api";
const WALL = "https://source-shrabya.github.io/for-aarya/pictures.html";
const KEY = "for-aarya-password";
const files = FileManager.local();
const saved = name => files.joinPath(files.documentsDirectory(), "for-aarya-" + name);

async function askPassword() {
  const alert = new Alert();
  alert.title = "हाम्रो तस्बिर";
  alert.message = "The password you use on the site";
  alert.addSecureTextField("password");
  alert.addAction("Save");
  alert.addCancelAction("Cancel");
  if (await alert.present() === -1) return "";
  const password = alert.textFieldValue(0).trim();
  if (password) Keychain.set(KEY, password);
  return password;
}

async function get(path, password, kind) {
  const req = new Request(API + path);
  req.headers = { "x-letter-password": password };
  req.timeoutInterval = 20;
  const body = kind === "image" ? await req.loadImage() : await req.loadJSON();
  if (req.response.statusCode === 401) throw new Error("wrong password");
  if (req.response.statusCode !== 200) throw new Error("server said " + req.response.statusCode);
  return body;
}

// the newest by when it was posted, not by where we dragged it; the other one's first
function newest(pictures, me) {
  const latest = list => list.reduce((a, b) => (!a || b.added > a.added ? b : a), null);
  return latest(pictures.filter(p => p.by !== me)) ?? latest(pictures);
}

async function load(password) {
  const { me } = await get("/avatars", password);
  const { pictures } = await get("/pictures", password);
  const p = newest(pictures, me);
  if (!p) return null;
  const info = { id: p.id, caption: p.caption ?? "", by: p.by, day: p.taken ?? p.added.slice(0, 10) };
  const last = files.fileExists(saved("info.json")) ? JSON.parse(files.readString(saved("info.json"))) : {};
  if (last.id !== info.id || !files.fileExists(saved("photo.jpg"))) {
    files.writeImage(saved("photo.jpg"), await get(`/pictures/${p.id}/thumb`, password, "image"));
  }
  files.writeString(saved("info.json"), JSON.stringify(info));
  return info;
}

const shortDay = day => new Date(day + "T12:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function draw(info, note) {
  const w = new ListWidget();
  w.url = WALL;
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  w.setPadding(10, 12, 10, 12);
  const photo = info && files.fileExists(saved("photo.jpg")) ? files.readImage(saved("photo.jpg")) : null;
  if (!photo) {
    w.backgroundColor = new Color("#FBF8F1");
    w.addSpacer();
    const t = w.addText(note || "अहिलेसम्म तस्बिर छैन");
    t.font = Font.italicSystemFont(14);
    t.textColor = new Color("#1D2A50");
    t.centerAlignText();
    w.addSpacer();
    return w;
  }
  // the picture fills the widget, with a dark fade at the bottom so the words read on any photo
  w.backgroundImage = photo;
  const fade = new LinearGradient();
  fade.colors = [new Color("#000000", 0), new Color("#000000", 0), new Color("#000000", 0.6)];
  fade.locations = [0, 0.5, 1];
  w.backgroundGradient = fade;
  w.addSpacer();
  if (info.caption) {
    const c = w.addText(info.caption);
    c.font = new Font("Georgia-Italic", 14);
    c.textColor = Color.white();
    c.lineLimit = 2;
  }
  const from = w.addText(`${info.by}, ${shortDay(info.day)}`);
  from.font = new Font("Georgia-Italic", 11);
  from.textColor = new Color("#FFFFFF", 0.85);
  return w;
}

let password = Keychain.contains(KEY) ? Keychain.get(KEY) : "";
if (!password && config.runsInApp) password = await askPassword();

let info = null, note = "";
if (!password) {
  note = "Scriptable खोलेर यो script एक पटक चलाऊ";
} else {
  try {
    info = await load(password);
  } catch (e) {
    if (String(e.message).includes("wrong password")) {
      Keychain.remove(KEY);
      note = "Password मिलेन। Scriptable मा फेरि चलाऊ";
    } else {
      // offline or the server is asleep: keep showing the last picture
      info = files.fileExists(saved("info.json")) ? JSON.parse(files.readString(saved("info.json"))) : null;
    }
  }
}

const widget = draw(info, note);
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentSmall();
Script.complete();
