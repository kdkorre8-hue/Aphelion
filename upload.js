// Make a galaxy from your own Spotify data, right here in the browser: drop the export (the zip, or the JSON
// files in it) and it's read, summed up the same way galaxy.py does it, and kept in this browser. Nothing
// leaves your device. Works with the extended streaming history and with the shorter one-year history.
import { unzipSync, strFromU8 } from "fflate";
import { el, icon, keepFocusIn } from "./ui.js";

const $ = (id) => document.getElementById(id);

const MIN_SECONDS = 30;      // shorter plays don't count
const MAX_STARS = 100;       // the artists you've listened to most become stars, the rest is dust
const MIN_STAR_PLAYS = 3;
const SONGS_PER_STAR = 100;  // songs kept for each star: planets plus asteroid belt

// ---------- reading the export ----------

const isExtended = (data) => Array.isArray(data) && "ts" in (data[0] ?? {}) && "ms_played" in (data[0] ?? {});
const isBasic = (data) => Array.isArray(data) && "endTime" in (data[0] ?? {}) && "artistName" in (data[0] ?? {});

// A stable made-up id for songs from the one-year history, which has no Spotify ids
function songKey(artist, song) {
  let a = 2166136261;
  const text = `${artist}\u0000${song}`.toLowerCase();
  for (let i = 0; i < text.length; i++) a = Math.imul(a ^ text.charCodeAt(i), 16777619);
  return `n${(a >>> 0).toString(36)}`;
}

// One entry of the export -> a play, or null for podcasts, audiobooks and plays too short to count
function toPlay(entry) {
  if ("ts" in entry) {
    const uri = entry.spotify_track_uri, artist = entry.master_metadata_album_artist_name;
    if (!uri || !artist || entry.ms_played < MIN_SECONDS * 1000) return null;
    return {
      time: Date.parse(entry.ts) / 1000, artist, song: entry.master_metadata_track_name || "Unknown song",
      album: entry.master_metadata_album_album_name || "", id: uri.split(":").pop(), ms: entry.ms_played,
    };
  }
  if (!entry.artistName || entry.msPlayed < MIN_SECONDS * 1000) return null;
  return { // "2023-01-05 14:03", in UTC
    time: Date.parse(`${entry.endTime.replace(" ", "T")}:00Z`) / 1000, artist: entry.artistName,
    song: entry.trackName || "Unknown song", album: "", id: songKey(entry.artistName, entry.trackName || ""), ms: entry.msPlayed,
  };
}

// Every .json in the files you dropped, zipped or not -> [name, parsed JSON]
async function readJson(files) {
  const found = [];
  for (const file of files) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".zip")) {
      const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: (f) => f.name.toLowerCase().endsWith(".json") });
      for (const [inner, bytes] of Object.entries(entries)) {
        try { found.push([inner, JSON.parse(strFromU8(bytes))]); } catch { /* not a history file */ }
      }
    } else if (name.endsWith(".json")) {
      try { found.push([file.name, JSON.parse(await file.text())]); } catch { /* not a history file */ }
    }
  }
  return found;
}

async function readPlays(files) {
  const plays = new Map(); // the same play in two files counts once
  let extended = false;
  for (const [, data] of await readJson(files)) {
    if (!isExtended(data) && !isBasic(data)) continue;
    extended ||= isExtended(data);
    for (const entry of data) {
      const play = toPlay(entry);
      if (play && Number.isFinite(play.time)) plays.set(`${play.time}|${play.id}`, play);
    }
  }
  return { plays: [...plays.values()], extended };
}

// ---------- plays -> galaxy (the same as galaxy.py's build) ----------

const monthNumber = (time) => { const d = new Date(time * 1000); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
const count = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
const sortedMonths = (months) => [...months].sort((a, b) => a[0] - b[0]);

function summarize(plays) {
  const artists = new Map();
  for (const p of plays) {
    const name = p.artist.trim();
    let a = artists.get(name.toLowerCase());
    if (!a) artists.set(name.toLowerCase(), a = { name, plays: 0, ms: 0, first: p.time, last: p.time, months: new Map(), songs: new Map() });
    a.plays++;
    a.ms += p.ms;
    a.first = Math.min(a.first, p.time);
    a.last = Math.max(a.last, p.time);
    count(a.months, monthNumber(p.time));

    const key = p.song.trim().toLowerCase(); // the single and the album version count as one song
    let s = a.songs.get(key);
    if (!s) a.songs.set(key, s = { name: p.song, id: p.id, album: p.album, plays: 0, ms: 0, first: p.time, last: p.time });
    s.plays++;
    s.ms += p.ms;
    s.first = Math.min(s.first, p.time);
    s.last = Math.max(s.last, p.time);
  }
  return [...artists.values()];
}

// Middle of the month you played the artist the most (the latest one if there's a tie)
function peakTime(months) {
  let best = null;
  for (const [month, n] of months) if (!best || n > best[1] || (n === best[1] && month > best[0])) best = [month, n];
  return Date.UTC(Math.floor(best[0] / 12), best[0] % 12, 15) / 1000;
}

function artistJson(a, withSongs) {
  const songs = [...a.songs.values()].sort((x, y) => y.plays - x.plays || y.last - x.last);
  const data = {
    name: a.name, plays: a.plays, hours: Math.round(a.ms / 360_000) / 10,
    first: Math.floor(a.first), last: Math.floor(a.last), peak: Math.floor(peakTime(a.months)), song_count: songs.length,
  };
  if (withSongs) {
    data.months = sortedMonths(a.months);
    data.songs = songs.slice(0, SONGS_PER_STAR).map((s) => ({
      name: s.name, id: s.id, album: s.album, plays: s.plays, minutes: Math.round(s.ms / 60_000),
      first: Math.floor(s.first), last: Math.floor(s.last), image: null,
    }));
  } else {
    data.top_song = { name: songs[0].name, id: songs[0].id };
  }
  return data;
}

export function buildGalaxy(plays) {
  const ranked = summarize(plays).sort((a, b) => b.ms - a.ms);
  let stars = ranked.filter((a) => a.plays >= MIN_STAR_PLAYS).slice(0, MAX_STARS);
  if (stars.length < 10) stars = ranked.slice(0, 10); // very little data: still give the galaxy something to show
  const starNames = new Set(stars.map((a) => a.name));
  const months = new Map();
  for (const p of plays) count(months, monthNumber(p.time));
  let start = Infinity, ms = 0;
  for (const p of plays) { start = Math.min(start, p.time); ms += p.ms; }
  return {
    generated_at: new Date().toISOString().slice(0, 19),
    mode: "uploaded",
    start: Math.floor(start),
    end: Math.floor(Date.now() / 1000),
    plays: plays.length,
    hours: Math.round(ms / 3_600_000),
    months: sortedMonths(months),
    stars: stars.map((a) => artistJson(a, true)),
    dust: ranked.filter((a) => !starNames.has(a.name)).map((a) => artistJson(a, false)),
  };
}

// ---------- kept in this browser ----------
// In IndexedDB, since a galaxy is too big for localStorage. Private windows or blocked storage just don't keep it.

function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("aphelion", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("galaxies");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function store(mode, value) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("galaxies", mode), galaxies = tx.objectStore("galaxies");
      const request = value === undefined ? galaxies.get("uploaded") : value === null ? galaxies.delete("uploaded") : galaxies.put(value, "uploaded");
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function uploadedGalaxy() {
  try { return (await store("readonly")) ?? null; } catch { return null; }
}

// ---------- the window ----------

// with a galaxy on screen it's a window over it; without one it's the whole page, and the way in
export function setupUpload({ alone, uploaded }) {
  const dialog = $("upload"), input = $("upload-input"), status = $("upload-status"), drop = $("upload-drop");
  let opener = null;
  drop.prepend(icon("upload"));

  const say = (text, problem = false) => {
    status.textContent = text;
    status.classList.toggle("problem", problem);
  };

  async function take(files) {
    if (!files.length || dialog.classList.contains("busy")) return;
    dialog.classList.add("busy");
    say("Reading your listening history…");
    await new Promise((r) => setTimeout(r, 30)); // let that show before the heavy part
    try {
      const { plays, extended } = await readPlays(files);
      if (!plays.length) {
        say("No listening history in there. Drop my_spotify_data.zip, or the Streaming_History JSON files inside it.", true);
        return;
      }
      const galaxy = buildGalaxy(plays);
      galaxy.history = extended ? "extended" : "basic";
      say(`Building your galaxy from ${plays.length.toLocaleString("en-US")} plays…`);
      try {
        await store("readwrite", galaxy);
      } catch {
        say("This browser won't keep the galaxy (a private window, maybe). Try a regular window.", true);
        return;
      }
      location.hash = "";
      location.reload();
    } catch (error) {
      console.error(error);
      say("Couldn't read that file. Is it the zip from Spotify?", true);
    } finally {
      dialog.classList.remove("busy");
    }
  }

  $("upload-choose").onclick = () => input.click();
  input.onchange = () => { take([...input.files]); input.value = ""; };
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    take([...e.dataTransfer.files]);
  };
  // a file dropped anywhere on the page while the window is open counts too, instead of the browser opening it
  window.addEventListener("dragover", (e) => { if (!dialog.hidden) e.preventDefault(); });
  window.addEventListener("drop", (e) => {
    if (dialog.hidden) return;
    e.preventDefault();
    if (!drop.contains(e.target)) take([...e.dataTransfer.files]);
  });

  const forget = $("upload-forget");
  forget.hidden = !uploaded;
  forget.onclick = async () => {
    try { await store("readwrite", null); } catch { /* nothing kept to forget */ }
    location.hash = "";
    location.reload();
  };

  if (alone) {
    dialog.classList.add("alone");
    dialog.hidden = false;
    return;
  }

  function open() {
    opener = document.activeElement;
    say("");
    dialog.hidden = false;
    $("upload-choose").focus();
  }
  function close() {
    if (dialog.classList.contains("busy")) return;
    dialog.hidden = true;
    opener?.focus();
  }
  $("upload-close").append(icon("close"));
  $("upload-close").onclick = close;
  dialog.onpointerdown = (e) => { if (e.target === dialog) close(); };
  dialog.onkeydown = (e) => {
    if (keepFocusIn(dialog, e) || e.key !== "Escape") return;
    e.stopPropagation();
    close();
  };

  const button = el("button", "action");
  button.type = "button";
  button.title = "Make a galaxy from your Spotify data";
  button.setAttribute("aria-label", "Upload your data");
  button.append(icon("upload"), el("span", "action-label", "Upload"));
  button.onclick = open;
  $("actions").append(button);
}
