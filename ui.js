// Everything on the page around the 3D view: header, tooltip, breadcrumb, artist panel, hints.
const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---------- time and number formatting ----------

const LOCALE = "en-US"; // the page is in English, so numbers and dates are written the English way

export const monthNumber = (time) => { const d = new Date(time * 1000); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
export const monthStart = (month) => Date.UTC(Math.floor(month / 12), month % 12, 1) / 1000;

export const format = {
  month: (time) => new Date(time * 1000).toLocaleDateString(LOCALE, { month: "short", year: "numeric", timeZone: "UTC" }),
  hours: (hours) => (hours >= 1 ? `${Math.round(hours).toLocaleString(LOCALE)} h` : `${Math.max(1, Math.round(hours * 60))} min`),
  count: (n, word) => `${n.toLocaleString(LOCALE)} ${word}${n === 1 ? "" : "s"}`,
  shortDuration: (months) => (months >= 12 ? `${Math.round(months / 12)} yr${Math.round(months / 12) > 1 ? "s" : ""}` : `${months} mo`),
  duration(months) {
    const years = Math.floor(months / 12), rest = months % 12;
    return [years && `${years} year${years > 1 ? "s" : ""}`, rest && `${rest} month${rest > 1 ? "s" : ""}`].filter(Boolean).join(", ");
  },
  compact: (n) => (n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : n.toLocaleString(LOCALE)),
  ago(days) {
    if (days < 1) return "today";
    if (days < 2) return "yesterday";
    if (days < 14) return `${Math.round(days)} days ago`;
    if (days < 60) return `${Math.round(days / 7)} weeks ago`;
    if (days < 730) return `${Math.round(days / 30.4)} months ago`;
    return `${Math.round(days / 365)} years ago`;
  },
};

// ---------- icons ----------

// Line icons on a 24-unit grid, drawn with a 1.5px stroke at any size, instead of text arrows and crosses
const ICONS = {
  close: ["M6 6l12 12", "M18 6L6 18"],
  back: ["M19 12H5", "M11 6l-6 6 6 6"],
  external: ["M8 16L16 8", "M9.5 8H16v6.5"],
  search: ["M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13z", "M15.5 15.5L20 20"],
  play: ["M8 5.5v13l10.5-6.5z"],
  pause: ["M9 5.5v13", "M15 5.5v13"],
  info: ["M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z", "M12 11v5.5", "M12 7.6v.01"],
  home: ["M4 11l8-6.5 8 6.5", "M6.5 9.5V19h11V9.5"],
  plus: ["M12 5v14", "M5 12h14"],
  minus: ["M5 12h14"],
  fullscreen: ["M4 9V4h5", "M15 4h5v5", "M20 15v5h-5", "M9 20H4v-5"],
  share: ["M12 15V4", "M7.5 8.5L12 4l4.5 4.5", "M5 13v7h14v-7"],
  left: ["M14.5 6l-6 6 6 6"],
  right: ["M9.5 6l6 6-6 6"],
  down: ["M6 9.5l6 6 6-6"],
  up: ["M6 14.5l6-6 6 6"],
  names: ["M3.5 6.5h11l5.5 5.5-5.5 5.5h-11z", "M8 12v.01"],
};
const FILLED_ICONS = new Set(["play"]);
const SVG_NS = "http://www.w3.org/2000/svg";

export function icon(name) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", FILLED_ICONS.has(name) ? "icon filled" : "icon");
  svg.setAttribute("aria-hidden", "true");
  for (const d of ICONS[name]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

// ---------- page chrome ----------

$("back").prepend(icon("back"));

// Small preferences remembered in this browser. Private windows or blocked storage just don't remember.
export const settings = {
  get(key) {
    try { return localStorage.getItem(`aphelion.${key}`); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(`aphelion.${key}`, value); } catch { /* not remembered, that's all */ }
  },
};

export function showMessage(text) {
  const box = $("message");
  box.textContent = text;
  box.hidden = false;
  doneLoading();
}

export function doneLoading() {
  $("loading").classList.add("done");
}

export function setupHeader(data, onHome) {
  const artists = data.stars.length + data.dust.length;
  $("summary").textContent = [
    format.count(artists, "artist"),
    `${format.compact(data.plays)} plays`,
    format.hours(data.hours),
    `since ${format.month(data.start)}`,
  ].join(" · ");
  $("preview").hidden = data.mode !== "preview";
  $("brand").onclick = onHome;
}

// Buttons for the view: back to the whole galaxy, zoom, names on or off, full screen (each also on a key)
export function setupControls({ onHome, onZoom, onNames, onFullscreen, names }) {
  const button = (name, label, onClick, className = "") => {
    const b = el("button", className);
    b.type = "button";
    b.title = label;
    b.setAttribute("aria-label", label.replace(/ \(.*\)$/, ""));
    b.append(icon(name));
    b.onclick = onClick;
    return b;
  };
  const items = [
    button("home", "The whole galaxy (H)", onHome),
    el("div", "rule zoom"),
    button("plus", "Zoom in (+)", () => onZoom(0.7), "zoom"),
    button("minus", "Zoom out (−)", () => onZoom(1 / 0.7), "zoom"),
    el("div", "rule"),
    button("names", "Names (N)", onNames, "names-button"),
  ];
  if (document.fullscreenEnabled) items.push(button("fullscreen", "Full screen (F)", onFullscreen));
  $("controls").replaceChildren(...items);
  setNamesButton(names);
}

export function setNamesButton(on) {
  document.querySelector("#controls .names-button").setAttribute("aria-pressed", String(on));
}

// The legend explains what you're looking at: the galaxy, or the system of the star you visit. It folds away
// into a "How to read" pill. Whether the galaxy's is open is remembered; a system's starts folded, so it never
// covers planets, and stays open once you open it.
const legendOpen = { galaxy: true, system: false };
let legendMode = "galaxy";

// The color bar and its time marks are drawn from the stars' own color scale (days -> color, on a log scale)
export function setupLegend(heat, open) {
  const longest = heat.at(-1)[0];
  const at = (days) => `${((Math.log1p(days) / Math.log1p(longest)) * 100).toFixed(1)}%`;
  document.documentElement.style.setProperty("--heat", `linear-gradient(90deg, ${heat.map(([days, color]) => `${color} ${at(days)}`).join(", ")})`);
  $("heat-ticks").replaceChildren(...[[0, "now"], [7, "1 wk"], [30, "1 mo"], [365, "1 yr"]].map(([days, text]) => {
    const tick = el("span", "", text);
    tick.style.left = at(days);
    return tick;
  }));
  legendOpen.galaxy = open;
  $("legend-toggle").onclick = () => {
    legendOpen[legendMode] = !legendOpen[legendMode];
    if (legendMode === "galaxy") settings.set("legend", legendOpen.galaxy ? "open" : "closed");
    showLegend();
  };
  showLegend();
}

export function setLegendMode(mode) {
  legendMode = mode;
  for (const keys of document.querySelectorAll("#legend .keys")) keys.hidden = keys.dataset.for !== mode;
  $("legend").setAttribute("aria-label", mode === "galaxy" ? "How to read the galaxy" : "How to read a star system");
  showLegend();
}

function showLegend() {
  const open = legendOpen[legendMode];
  $("legend").classList.toggle("collapsed", !open);
  $("legend-body").hidden = !open;
  const toggle = $("legend-toggle");
  toggle.setAttribute("aria-expanded", String(open));
  toggle.title = open ? "Fold the legend away" : "";
  toggle.setAttribute("aria-label", open ? "Fold the legend away" : "How to read");
  toggle.replaceChildren(...(open ? [icon("down")] : [icon("info"), "How to read"]));
}

// The "how to move around" hint, in the words of a touch screen where that's what you have. It fades once
// you've started exploring.
export function setupHint(canvas) {
  const hint = $("hint");
  if (window.matchMedia("(pointer: coarse)").matches) {
    const b = (text) => el("b", "", text);
    hint.replaceChildren(b("Tap"), " a star · ", b("drag"), " to orbit · ", b("pinch"), " to zoom");
  }
  const hide = () => hint.classList.add("gone");
  canvas.addEventListener("pointerdown", hide, { once: true });
  canvas.addEventListener("wheel", hide, { once: true, passive: true });
  setTimeout(hide, 12000);
}

// The top bar says where you are: the tagline in the galaxy, "Galaxy / artist" while you visit a star
export function showCrumb(name, onBack) {
  $("crumb-name").textContent = name;
  $("crumb").hidden = false;
  $("tagline").hidden = true;
  $("back").onclick = onBack;
  document.body.classList.add("visiting");
}

export function hideCrumb() {
  $("crumb").hidden = true;
  $("tagline").hidden = false;
  document.body.classList.remove("visiting");
}

// ---------- tooltip ----------

// What a star, a speck of dust or a song is: a title and a line or two, for the tooltip and the card.
// item: { kind: "star" | "dust" | "song", artist, song?, asteroid? }; ago: time -> days since
function describe(item, ago) {
  const a = item.artist;
  if (item.kind === "song") {
    const s = item.song;
    return {
      image: s.image, title: s.name,
      lines: [`${a.name}${s.album ? ` · ${s.album}` : ""}`, `${format.count(s.plays, "play")} · ${format.hours(s.minutes / 60)} · last played ${format.ago(ago(s.last))}`],
    };
  }
  return {
    title: a.name,
    lines: [
      `${format.hours(a.hours)} · ${format.count(a.plays, "play")} · ${format.count(a.song_count, "song")}`,
      item.kind === "star"
        ? `Most played in ${format.month(a.peak)} · last played ${format.ago(ago(a.last))}`
        : `Last played ${format.ago(ago(a.last))} · top song: ${a.top_song.name}`,
    ],
  };
}

function describeInto(box, item, ago) {
  const { image, title, lines } = describe(item, ago);
  if (image) {
    const img = el("img");
    img.src = image;
    img.alt = "";
    box.append(img);
  }
  const text = el("div", "tip-text");
  text.append(el("div", "tip-title", title), ...lines.map((line) => el("div", "tip-meta", line)));
  box.append(text);
  return text;
}

const tip = $("tooltip");
let tipAbove = false;

export const tooltip = {
  show(item, { ago, visiting }) {
    tipAbove = item.kind !== "song"; // star names hang below their stars, planet names sit above their planets
    tip.replaceChildren();
    const text = describeInto(tip, item, ago);
    const hint = item.kind === "star" ? !visiting && "Click to fly in"
      : item.asteroid ? "Asteroid belt: songs you played less · click for details" : "Click for details";
    if (hint) text.append(el("div", "tip-hint", hint));
    tip.classList.add("shown");
  },
  // Beside the pointer, on the side away from the name of what you point at (flipped if there's no room)
  move(x, y) {
    const height = tip.offsetHeight;
    const above = y - 18 - height, below = y + 18;
    const top = tipAbove ? (above >= 12 ? above : below) : (below + height <= window.innerHeight - 12 ? below : above);
    tip.style.left = `${Math.min(x + 18, window.innerWidth - tip.offsetWidth - 12)}px`;
    tip.style.top = `${Math.max(12, Math.min(top, window.innerHeight - height - 12))}px`;
  },
  hide() {
    tip.classList.remove("shown");
  },
};

// ---------- card ----------

// A small card for something you clicked that has no page of its own, like a speck of dust: what it is, and
// buttons for what you can do with it. Pinned where you clicked (docked at the bottom on phones); Escape, its
// close button or a click anywhere else closes it.
const cardBox = $("card");

export const card = {
  // actions: [{ label, icon, primary, external, onClick }]
  show(item, { x, y, ago, actions }) {
    cardBox.replaceChildren();
    const close = el("button", "card-close");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.append(icon("close"));
    close.onclick = () => card.hide();
    const text = describeInto(cardBox, item, ago);
    const buttons = el("div", "card-actions");
    for (const action of actions) {
      const b = el("button", action.primary ? "button primary" : "button");
      b.type = "button";
      b.append(...(action.icon ? [icon(action.icon)] : []), action.label, ...(action.external ? [icon("external")] : []));
      b.onclick = () => {
        card.hide();
        action.onClick();
      };
      buttons.append(b);
    }
    text.append(buttons);
    cardBox.prepend(close);
    cardBox.hidden = false;
    cardBox.setAttribute("aria-label", describe(item, ago).title);
    const width = cardBox.offsetWidth, height = cardBox.offsetHeight;
    const above = y - 16 - height;
    cardBox.style.left = `${Math.max(12, Math.min(x + 16, window.innerWidth - width - 12))}px`;
    cardBox.style.top = `${Math.max(12, Math.min(above >= 12 ? above : y + 16, window.innerHeight - height - 12))}px`;
  },
  hide() {
    cardBox.hidden = true;
  },
  get isOpen() {
    return !cardBox.hidden;
  },
};
document.addEventListener("pointerdown", (e) => {
  if (card.isOpen && !cardBox.contains(e.target)) card.hide();
}, true);

// ---------- artist panel ----------

// Monthly plays across your whole listening life, so you can see when this artist was part of it. Laid out
// like the spiral arm: months you listened get equal room, and long breaks shrink to a short dashed stretch
// that says how long they were. The faint band runs from the first time you played the artist to the last,
// and the dot marks the month you played them most. hover: a month to bring forward.
function drawTimeline(canvas, artist, timeline, color, hover = null) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const x = (time) => timeline.frac(time) * width;
  const base = height - 1, room = base - 10; // 10px above the tallest bar for the peak dot

  ctx.fillStyle = "rgba(255, 255, 255, 0.035)";
  ctx.fillRect(x(artist.first), 0, Math.max(2, x(artist.last) - x(artist.first)), base);

  ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
  ctx.fillRect(0, base, width, 1);
  ctx.font = `500 10px ${getComputedStyle(canvas).fontFamily}`;
  ctx.textAlign = "center";
  for (const b of timeline.breaks) {
    const x0 = x(monthStart(b.from)), x1 = x(monthStart(b.to + 1));
    ctx.clearRect(x0, base, x1 - x0, 1);
    ctx.strokeStyle = "rgba(233, 235, 245, 0.35)";
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(x0, base + 0.5);
    ctx.lineTo(x1, base + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    const text = format.shortDuration(b.to - b.from + 1);
    if (ctx.measureText(text).width + 8 < x1 - x0) {
      ctx.fillStyle = "#7a81a3";
      ctx.fillText(text, (x0 + x1) / 2, base - 5);
    }
  }

  const busiest = Math.max(...artist.months.map(([, n]) => n));
  const peak = monthNumber(artist.peak);
  for (const [month, n] of artist.months) {
    const left = x(monthStart(month)), right = x(monthStart(month + 1));
    const w = Math.min(14, Math.max(1.5, right - left - 1.5)), h = Math.max(2, (n / busiest) * room);
    const middle = (left + right) / 2;
    ctx.globalAlpha = hover === null || hover === month ? 1 : 0.5;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(middle - w / 2, base - h, w, h, [Math.min(2, w / 2), Math.min(2, w / 2), 0, 0]);
    ctx.fill();
    if (month === peak) {
      ctx.beginPath();
      ctx.arc(middle, base - h - 5, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  if (hover !== null) {
    ctx.fillStyle = "rgba(233, 235, 245, 0.4)";
    ctx.fillRect(Math.round((x(monthStart(hover)) + x(monthStart(hover + 1))) / 2), 0, 1, base);
  }
}

// Point at the chart to read one month: "Jul 2026 · 212 plays", or how long a break was
function chartReadout(canvas, readout, artist, timeline, color) {
  const plays = new Map(artist.months);
  const show = (clientX) => {
    const box = canvas.getBoundingClientRect();
    const at = Math.min(Math.max((clientX - box.left) / box.width, 0), 0.9999);
    const time = timeline.timeAt(at);
    const month = monthNumber(time);
    const gap = timeline.breaks.find((b) => month >= b.from && month <= b.to);
    readout.textContent = gap
      ? `${format.duration(gap.to - gap.from + 1)} without plays`
      : `${format.month(monthStart(month))} · ${plays.has(month) ? format.count(plays.get(month), "play") : "no plays"}`;
    readout.style.left = `${Math.min(Math.max(at * box.width, readout.offsetWidth / 2), box.width - readout.offsetWidth / 2)}px`;
    readout.parentElement.classList.add("reading");
    drawTimeline(canvas, artist, timeline, color, gap ? null : month);
  };
  canvas.onpointermove = (e) => show(e.clientX);
  canvas.onpointerleave = () => {
    readout.parentElement.classList.remove("reading");
    drawTimeline(canvas, artist, timeline, color);
  };
}

// The most months in a row you played the artist (months are in order)
function longestStreak(months) {
  let best = 0, run = 0, previous = null;
  for (const [month] of months) {
    run = month === previous + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = month;
  }
  return best;
}

// The artist next to the rest of your listening: their share of it, their longest streak, and how you met
function artistFacts(artist, data) {
  const facts = el("dl", "facts");
  const fact = (term, ...description) => {
    const row = el("div", "fact");
    const value = el("dd");
    value.append(...description);
    row.append(el("dt", "", term), value);
    facts.append(row);
  };
  const share = artist.hours / Math.max(data.hours, 0.1);
  const meter = el("span", "meter");
  meter.append(el("span"));
  meter.firstChild.style.width = `${Math.min(100, Math.max(3, share * 100))}%`;
  fact("Share", `${share < 0.01 ? "Under 1" : Math.round(share * 100)}% of your listening`, meter);
  const streak = longestStreak(artist.months);
  if (streak > 1) fact("Streak", `${streak} months in a row`);
  const firstSong = artist.songs.reduce((a, b) => (b.first < a.first ? b : a));
  fact("First heard", el("span", "fact-text", `${format.month(artist.first)} · ${firstSong.name}`));
  return facts;
}

// A song in the list: a small planet in its planet's color (its album art, ringed in that color, when there is
// one), its name over a bar for its share of the artist's plays, and its plays
const songRows = new Map(); // song -> its row in the open panel
function songRow(song, rank, mostPlays, colorOf, { onSongEnter, onSongLeave, onSongClick }) {
  const item = el("li");
  songRows.set(song, item);
  item.style.setProperty("--planet", colorOf(song));
  const art = el("span", "song-art");
  if (song.image) {
    const img = el("img");
    img.src = song.image;
    img.alt = "";
    img.loading = "lazy";
    art.append(img);
  }
  const text = el("span", "song-text");
  const bar = el("span", "song-bar");
  bar.style.width = `${Math.max(2, (song.plays / mostPlays) * 100)}%`;
  text.append(el("span", "song-name", song.name), bar);
  item.append(el("span", "song-rank", String(rank)), art, text, el("span", "song-plays", format.compact(song.plays)));
  item.title = `${song.name} · ${format.count(song.plays, "play")}`;
  item.onmouseenter = () => onSongEnter(song);
  item.onmouseleave = () => onSongLeave(song);
  item.onclick = () => onSongClick(song);
  return item;
}

// Pointing at a planet (or an asteroid) lights up its song in the list
export function highlightRow(song, on) {
  songRows.get(song)?.classList.toggle("lit", on);
}

// The song you clicked, in a card at the top of the list: its art or planet, album, plays and dates, and a
// button to play it in Spotify. Going to Spotify is always a button you press, never a click in the galaxy.
let songSlot = null; // where the card goes in the open panel
const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function showSong(song, artist, { ago, colorOf, onPlay, onClear }) {
  const card = el("div", "song-card");
  card.style.setProperty("--planet", colorOf(song));
  const art = el("span", "song-art");
  if (song.image) {
    const img = el("img");
    img.src = song.image;
    img.alt = "";
    art.append(img);
  }
  const head = el("div", "song-card-head");
  head.append(el("div", "song-card-title", song.name), el("div", "song-card-meta", [artist.name, song.album].filter(Boolean).join(" · ")));
  const clear = el("button", "song-card-clear");
  clear.type = "button";
  clear.setAttribute("aria-label", "Close the song");
  clear.append(icon("close"));
  clear.onclick = onClear;
  const top = el("div", "song-card-top");
  top.append(art, head, clear);
  const facts = el("p", "song-card-facts",
    `${format.count(song.plays, "play")} · ${format.hours(song.minutes / 60)} · first played ${format.month(song.first)} · last played ${format.ago(ago(song.last))}`);
  const play = el("button", "button primary");
  play.type = "button";
  play.append(icon("play"), "Play in Spotify", icon("external"));
  play.onclick = () => onPlay(song);
  card.append(top, facts, play);
  songSlot.replaceChildren(card);
  for (const [s, row] of songRows) row.classList.toggle("selected", s === song);
  card.scrollIntoView({ block: "nearest", behavior: calm ? "auto" : "smooth" });
}

export function clearSong() {
  songSlot?.replaceChildren();
  for (const row of songRows.values()) row.classList.remove("selected");
}

export function openPanel(artist, data, { color, ago, rank, colorOf, timeline, onClose, onSongEnter, onSongLeave, onSongClick }) {
  const panel = $("panel");
  panel.replaceChildren();
  songRows.clear();
  panel.style.setProperty("--artist", color);

  const close = el("button", "panel-close");
  close.append(icon("close"));
  close.type = "button";
  close.setAttribute("aria-label", "Back to the galaxy");
  close.onclick = onClose;

  const stats = el("div", "stats");
  for (const [value, label] of [[format.hours(artist.hours), "listened"], [format.compact(artist.plays), "plays"], [format.compact(artist.song_count), "songs"]]) {
    const box = el("div", "stat");
    box.append(el("div", "stat-value", value), el("div", "stat-label", label));
    stats.append(box);
  }

  const chart = el("div", "timeline-chart");
  const canvas = el("canvas", "timeline");
  const range = el("div", "timeline-range");
  range.append(el("span", "", format.month(data.start)), el("span", "", "today"));
  const readout = el("div", "timeline-readout");
  chart.append(canvas, range, readout);

  songSlot = el("div", "song-slot");

  // The top 10, and the rest on request
  const list = el("ol", "songs");
  const handlers = { onSongEnter, onSongLeave, onSongClick };
  const mostPlays = artist.songs[0]?.plays || 1;
  const addRows = (from, to) => artist.songs.slice(from, to).forEach((song, i) => list.append(songRow(song, from + i + 1, mostPlays, colorOf, handlers)));
  addRows(0, 10);
  let more = null;
  if (artist.songs.length > 10) {
    more = el("button", "show-more", artist.songs.length === artist.song_count
      ? `Show all ${artist.songs.length} songs` : `Show the top ${artist.songs.length} songs`);
    more.type = "button";
    more.onclick = () => {
      addRows(10, artist.songs.length);
      more.remove();
    };
  }

  const link = el("a", "spotify-link", "Find on Spotify");
  link.append(icon("external"));
  link.href = `https://open.spotify.com/search/${encodeURIComponent(artist.name)}`;
  link.target = "_blank";
  link.rel = "noopener";

  panel.append(
    close,
    el("div", "eyebrow", `Artist · #${rank} of ${(data.stars.length + data.dust.length).toLocaleString("en-US")}`),
    el("h2", "", artist.name),
    el("p", "panel-sub", `Most played in ${format.month(artist.peak)} · last played ${format.ago(ago(artist.last))}`),
    stats,
    artistFacts(artist, data),
    el("div", "section-title", "When you listened"),
    chart,
    el("div", "section-title", "Top songs"),
    songSlot,
    list,
    ...(more ? [more] : []),
    link,
  );
  panel.hidden = false;
  requestAnimationFrame(() => {
    panel.classList.add("open");
    drawTimeline(canvas, artist, timeline, color);
    chartReadout(canvas, readout, artist, timeline, color);
  });
}

export function closePanel() {
  const panel = $("panel");
  panel.classList.remove("open");
  panel.hidden = true;
}

