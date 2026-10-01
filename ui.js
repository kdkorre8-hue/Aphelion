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

// Buttons for the view: back to the whole galaxy, zoom, full screen (each also on a key)
export function setupControls({ onHome, onZoom, onFullscreen }) {
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
  ];
  if (document.fullscreenEnabled) items.push(el("div", "rule"), button("fullscreen", "Full screen (F)", onFullscreen));
  $("controls").replaceChildren(...items);
}

// The legend's color bar and its time marks, drawn from the stars' own color scale (days -> color, on a log scale)
export function setupLegend(heat) {
  const longest = heat.at(-1)[0];
  const at = (days) => `${((Math.log1p(days) / Math.log1p(longest)) * 100).toFixed(1)}%`;
  document.documentElement.style.setProperty("--heat", `linear-gradient(90deg, ${heat.map(([days, color]) => `${color} ${at(days)}`).join(", ")})`);
  $("heat-ticks").replaceChildren(...[[0, "now"], [7, "1 wk"], [30, "1 mo"], [365, "1 yr"]].map(([days, text]) => {
    const tick = el("span", "", text);
    tick.style.left = at(days);
    return tick;
  }));
}

// The "how to move around" hint fades once you've started exploring
export function setupHint(canvas) {
  const hint = $("hint");
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

const tip = $("tooltip");

export const tooltip = {
  // item: { kind: "star" | "dust" | "song", artist, song?, asteroid? }; ago: time -> days since
  show(item, { ago, visiting }) {
    tip.replaceChildren();
    const text = el("div", "tip-text");
    const add = (content, className) => text.append(el("div", className, content));
    const a = item.artist;
    if (item.kind === "song") {
      const s = item.song;
      if (s.image) {
        const img = el("img");
        img.src = s.image;
        img.alt = "";
        tip.append(img);
      }
      add(s.name, "tip-title");
      add(`${a.name}${s.album ? ` · ${s.album}` : ""}`, "tip-meta");
      add(`${format.count(s.plays, "play")} · ${format.hours(s.minutes / 60)} · last played ${format.ago(ago(s.last))}`, "tip-meta");
      add(item.asteroid ? "Asteroid belt: songs you played less · click to open" : "Click to open in Spotify", "tip-hint");
    } else {
      add(a.name, "tip-title");
      add(`${format.hours(a.hours)} · ${format.count(a.plays, "play")} · ${format.count(a.song_count, "song")}`, "tip-meta");
      if (item.kind === "star") {
        add(`Most played in ${format.month(a.peak)} · last played ${format.ago(ago(a.last))}`, "tip-meta");
        if (!visiting) add("Click to fly in", "tip-hint");
      } else {
        add(`Last played ${format.ago(ago(a.last))} · top song: ${a.top_song.name}`, "tip-meta");
        add("Click to play the top song in Spotify", "tip-hint");
      }
    }
    tip.append(text);
    tip.classList.add("shown");
  },
  move(x, y) {
    tip.style.left = `${Math.min(x + 18, window.innerWidth - tip.offsetWidth - 12)}px`;
    tip.style.top = `${Math.min(y + 18, window.innerHeight - tip.offsetHeight - 12)}px`;
  },
  hide() {
    tip.classList.remove("shown");
  },
};

// ---------- artist panel ----------

// Monthly plays across your whole timeline, so you can see when this artist was part of your life
function drawTimeline(canvas, artist, data, color) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth, height = canvas.clientHeight;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  const first = monthNumber(data.start);
  const count = monthNumber(data.end) - first + 1;
  const step = width / count;
  const busiest = Math.max(...artist.months.map(([, n]) => n));
  ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
  ctx.fillRect(0, height - 1, width, 1);
  ctx.fillStyle = color;
  for (const [month, n] of artist.months) {
    const barHeight = Math.max(2, (n / busiest) * (height - 4));
    const barWidth = Math.max(1, step - 1);
    ctx.beginPath();
    ctx.roundRect((month - first) * step, height - barHeight, barWidth, barHeight, [Math.min(2, barWidth / 2), Math.min(2, barWidth / 2), 0, 0]);
    ctx.fill();
  }
}

export function openPanel(artist, data, { color, ago, onClose, onSongEnter, onSongLeave, onSongClick }) {
  const panel = $("panel");
  panel.replaceChildren();
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

  const canvas = el("canvas", "timeline");
  const range = el("div", "timeline-range");
  range.append(el("span", "", format.month(data.start)), el("span", "", "today"));

  const list = el("ol", "songs");
  artist.songs.slice(0, 10).forEach((song, i) => {
    const item = el("li");
    item.append(el("span", "song-rank", String(i + 1)), el("span", "song-name", song.name), el("span", "song-plays", format.compact(song.plays)));
    item.title = `${song.name} · ${format.count(song.plays, "play")} · click to open in Spotify`;
    item.onmouseenter = () => onSongEnter(song);
    item.onmouseleave = () => onSongLeave(song);
    item.onclick = () => onSongClick(song);
    list.append(item);
  });

  const link = el("a", "spotify-link", "Find on Spotify");
  link.append(icon("external"));
  link.href = `https://open.spotify.com/search/${encodeURIComponent(artist.name)}`;
  link.target = "_blank";
  link.rel = "noopener";

  panel.append(
    close,
    el("div", "eyebrow", "Artist"),
    el("h2", "", artist.name),
    el("p", "panel-sub", `Most played in ${format.month(artist.peak)} · last played ${format.ago(ago(artist.last))}`),
    stats,
    el("div", "section-title", "When you listened"),
    canvas,
    range,
    el("div", "section-title", "Top songs"),
    list,
    link,
  );
  panel.hidden = false;
  requestAnimationFrame(() => {
    panel.classList.add("open");
    drawTimeline(canvas, artist, data, color);
  });
}

export function closePanel() {
  const panel = $("panel");
  panel.classList.remove("open");
  panel.hidden = true;
}

