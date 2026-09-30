// Everything on the page around the 3D view: header, tooltip, breadcrumb, artist panel, hints.
const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---------- time and number formatting ----------

export const monthNumber = (time) => { const d = new Date(time * 1000); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
export const monthStart = (month) => Date.UTC(Math.floor(month / 12), month % 12, 1) / 1000;

export const format = {
  month: (time) => new Date(time * 1000).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }),
  hours: (hours) => (hours >= 1 ? `${Math.round(hours).toLocaleString()} h` : `${Math.max(1, Math.round(hours * 60))} min`),
  count: (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`,
  duration(months) {
    const years = Math.floor(months / 12), rest = months % 12;
    return [years && `${years} year${years > 1 ? "s" : ""}`, rest && `${rest} month${rest > 1 ? "s" : ""}`].filter(Boolean).join(", ");
  },
  compact: (n) => (n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : n.toLocaleString()),
  ago(days) {
    if (days < 1) return "today";
    if (days < 2) return "yesterday";
    if (days < 14) return `${Math.round(days)} days ago`;
    if (days < 60) return `${Math.round(days / 7)} weeks ago`;
    if (days < 730) return `${Math.round(days / 30.4)} months ago`;
    return `${Math.round(days / 365)} years ago`;
  },
};

// ---------- page chrome ----------

export function showMessage(text) {
  const box = $("message");
  box.textContent = text;
  box.hidden = false;
  doneLoading();
}

export function doneLoading() {
  $("loading").classList.add("done");
}

export function setupHeader(data) {
  const artists = data.stars.length + data.dust.length;
  const chips = [
    format.count(artists, "artist"),
    `${format.compact(data.plays)} plays`,
    `${format.compact(data.hours)} hours`,
    `${format.month(data.start)} → today`,
  ];
  $("chips").replaceChildren(...chips.map((text) => el("span", "chip", text)));
  $("preview").hidden = data.mode !== "preview";
}

// The "how to move around" hint fades once you've started exploring
export function setupHint(canvas) {
  const hint = $("hint");
  const hide = () => hint.classList.add("gone");
  canvas.addEventListener("pointerdown", hide, { once: true });
  canvas.addEventListener("wheel", hide, { once: true, passive: true });
  setTimeout(hide, 12000);
}

export function showCrumb(name, onBack) {
  $("crumb-name").textContent = name;
  $("crumb").hidden = false;
  $("back").onclick = onBack;
}

export function hideCrumb() {
  $("crumb").hidden = true;
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

  const close = el("button", "panel-close", "×");
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

  const link = el("a", "spotify-link", "Find on Spotify ↗");
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

