// Filter the galaxy by when you last played an artist: brush a stretch of the legend's color bar, or pick one of
// three presets (the artists still in your rotation, the ones fading, and the ones you left behind, out at
// aphelion). Everything else dims, and the legend says how many artists are left lit.
import { el, icon } from "./ui.js";

const $ = (id) => document.getElementById(id);
const HINT = "Drag across the colors to filter";
const PRESETS = [
  ["Still in rotation", 0, 30],
  ["Fading", 30, 365],
  ["Left behind", 365, Infinity],
];

// longest: the far end of the bar, in days; count(from, to) -> how many artists you last played that long ago;
// onChange(from, to) with days, or with nothing when it's cleared
export function setupRecency({ longest, count, onChange }) {
  const bar = $("heat-bar"), band = el("div", "heat-band");
  const toDays = (f) => Math.expm1(Math.min(1, Math.max(0, f)) * Math.log1p(longest)); // along the bar -> days
  const toF = (days) => (days === Infinity ? 1 : Math.log1p(days) / Math.log1p(longest)); // days -> along the bar
  bar.append(band);

  const row = el("div", "recency");
  const presets = PRESETS.map(([label, from, to]) => {
    const b = el("button", "recency-preset", label);
    b.type = "button";
    b.onclick = () => (b.getAttribute("aria-pressed") === "true" ? clear() : set(from, to));
    return [b, from, to];
  });
  // one line under the bar, always there so nothing moves: a hint, or how many artists are lit
  const status = el("div", "recency-status");
  const clearButton = el("button", "recency-clear");
  clearButton.type = "button";
  clearButton.setAttribute("aria-label", "Show every artist again");
  clearButton.append(icon("close"));
  clearButton.onclick = () => clear();
  const statusText = el("span", "", HINT);
  status.append(statusText, clearButton);
  row.append(...presets.map(([b]) => b));
  $("heat-ticks").after(status, row);

  let range = null;
  function set(from, to) {
    range = [Math.min(from, to), Math.max(from, to)];
    const [a, b] = range;
    band.hidden = false;
    band.style.left = `${toF(a) * 100}%`;
    band.style.width = `${Math.max(1.5, (toF(b) - toF(a)) * 100)}%`;
    // the band shows the bar's own colors under it: the same gradient, at the bar's size, shifted to line up
    band.style.setProperty("--bar-width", `${bar.offsetWidth}px`);
    band.style.backgroundPosition = `${-toF(a) * bar.offsetWidth}px 0`;
    bar.classList.add("filtering");
    for (const [button, pa, pb] of presets) button.setAttribute("aria-pressed", String(pa === a && pb === b));
    const n = count(a, b);
    statusText.textContent = `${n.toLocaleString("en-US")} artist${n === 1 ? "" : "s"} · ${describe(a, b)}`;
    status.classList.add("active");
    onChange(a, b);
  }

  function clear({ quiet = false } = {}) {
    if (!range) return;
    range = null;
    band.hidden = true;
    bar.classList.remove("filtering");
    for (const [button] of presets) button.setAttribute("aria-pressed", "false");
    statusText.textContent = HINT;
    status.classList.remove("active");
    if (!quiet) onChange(null);
  }

  // drag across the bar to choose a stretch of time; a click alone picks the time around that point
  let from = null;
  const fAt = (e) => {
    const box = bar.getBoundingClientRect();
    return (e.clientX - box.left) / box.width;
  };
  bar.onpointerdown = (e) => {
    from = fAt(e);
    bar.setPointerCapture(e.pointerId);
  };
  bar.onpointermove = (e) => {
    if (from === null) return;
    const to = fAt(e);
    if (Math.abs(to - from) > 0.01) set(toDays(from), toDays(to));
  };
  bar.onpointerup = (e) => {
    if (from === null) return;
    const to = fAt(e);
    if (Math.abs(to - from) <= 0.01) set(toDays(from - 0.06), toDays(from + 0.06));
    from = null;
  };
  band.hidden = true;

  return { clear, get active() { return !!range; } };
}

// A number of days in the largest unit that fits: [count, unit]
function amount(days) {
  return days < 7 ? [Math.max(1, Math.round(days)), "day"] : days < 28 ? [Math.round(days / 7), "week"]
    : days < 360 ? [Math.round(days / 30.4), "month"] : [Math.round(days / 365), "year"];
}
const plural = ([n, unit]) => `${n} ${unit}${n === 1 ? "" : "s"}`;

// When you last played them: "within the last month", "1 month – 1 year ago", "more than a year ago"
function describe(a, b) {
  if (b === Infinity) { const [n, unit] = amount(a); return `more than ${n === 1 ? `a ${unit}` : plural([n, unit])} ago`; }
  if (a < 1) { const [n, unit] = amount(b); return `within the last ${n === 1 ? unit : plural([n, unit])}`; }
  return `${plural(amount(a))} – ${plural(amount(b))} ago`;
}
