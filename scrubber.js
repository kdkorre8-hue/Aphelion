// The time strip: your listening life along the bottom of the overview, laid out like the spiral arm, with a
// bar for each month's plays in the color of how long ago that month was, and long breaks as short dashed
// stretches. Drag along it, click it, or use the arrow keys on it to light up the stars of one month; Escape or
// its close button lets go.
import { format, icon, monthNumber, monthStart } from "./ui.js";

const $ = (id) => document.getElementById(id);

// timeline: the arm's (frac, timeAt, breaks); colorAt: time -> css color; describe: month -> caption;
// onChange: month (a month number) or null when you let go
export function setupScrubber({ timeline, data, colorAt, describe, onChange }) {
  const root = $("scrubber"), rail = $("scrubber-rail"), canvas = $("scrubber-track"), thumb = $("scrubber-thumb");
  const caption = $("scrubber-caption"), close = $("scrubber-close");
  const first = monthNumber(data.start), last = monthNumber(data.end);
  const plays = new Map(data.months);
  const busiest = Math.max(1, ...plays.values());
  const breakOf = (month) => timeline.breaks.find((b) => month >= b.from && month <= b.to);
  const middle = (month) => (timeline.frac(monthStart(month)) + timeline.frac(monthStart(month + 1))) / 2; // 0..1
  const monthAt = (f) => Math.min(last, Math.max(first, monthNumber(timeline.timeAt(Math.min(Math.max(f, 0), 0.9999)))));
  const idleCaption = "Your listening, month by month · drag along it";
  let month = null, hover = null;

  close.append(icon("close"));
  caption.textContent = idleCaption;

  function draw() {
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width) return;
    if (canvas.width !== Math.round(width * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const base = height - 1;
    ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
    ctx.fillRect(0, base, width, 1);
    for (const b of timeline.breaks) {
      const x0 = timeline.frac(monthStart(b.from)) * width, x1 = timeline.frac(monthStart(b.to + 1)) * width;
      ctx.clearRect(x0, base, x1 - x0, 1);
      ctx.strokeStyle = "rgba(233, 235, 245, 0.35)";
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(x0, base + 0.5);
      ctx.lineTo(x1, base + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const [m, n] of plays) {
      const left = timeline.frac(monthStart(m)) * width, right = timeline.frac(monthStart(m + 1)) * width;
      const w = Math.max(1.5, Math.min(12, right - left - 1.5)), h = Math.max(2, Math.sqrt(n / busiest) * (base - 2));
      ctx.globalAlpha = month === null || month === m ? 1 : 0.35;
      ctx.fillStyle = colorAt(monthStart(m) + 15 * 86400);
      ctx.beginPath();
      ctx.roundRect((left + right) / 2 - w / 2, base - h, w, h, [Math.min(2, w / 2), Math.min(2, w / 2), 0, 0]);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (hover !== null && hover !== month) {
      ctx.fillStyle = "rgba(233, 235, 245, 0.35)";
      ctx.fillRect(Math.round(middle(hover) * width), 0, 1, base);
    }
  }

  const label = (m) => {
    const gap = breakOf(m);
    return gap ? `${format.duration(gap.to - gap.from + 1)} without plays` : describe(m);
  };

  function set(m) {
    month = Math.min(last, Math.max(first, m));
    root.classList.add("engaged");
    close.hidden = false;
    caption.textContent = label(month);
    thumb.style.left = `${middle(month) * 100}%`;
    thumb.setAttribute("aria-valuenow", String(month));
    thumb.setAttribute("aria-valuetext", caption.textContent);
    onChange(month);
    draw();
  }

  function release() {
    if (month === null) return;
    month = null;
    root.classList.remove("engaged");
    close.hidden = true;
    caption.textContent = idleCaption;
    thumb.setAttribute("aria-valuetext", "No month chosen");
    onChange(null);
    draw();
  }

  // Step a month at a time, over a break in one go
  function step(direction) {
    let m = (month ?? (direction > 0 ? first - 1 : last + 1)) + direction;
    const gap = breakOf(m);
    if (gap) m = direction > 0 ? gap.to + 1 : gap.from - 1;
    set(m);
  }

  const fractionAt = (e) => {
    const box = rail.getBoundingClientRect();
    return (e.clientX - box.left) / box.width;
  };
  let dragging = false;
  rail.onpointerdown = (e) => {
    dragging = true;
    rail.setPointerCapture(e.pointerId);
    set(monthAt(fractionAt(e)));
  };
  rail.onpointermove = (e) => {
    if (dragging) set(monthAt(fractionAt(e)));
    else {
      hover = monthAt(fractionAt(e));
      if (month === null) caption.textContent = label(hover);
      draw();
    }
  };
  rail.onpointerup = rail.onpointercancel = () => { dragging = false; };
  rail.onpointerleave = () => {
    hover = null;
    if (month === null) caption.textContent = idleCaption;
    draw();
  };
  thumb.onkeydown = (e) => {
    const keys = {
      ArrowLeft: () => step(-1), ArrowRight: () => step(1), ArrowDown: () => step(-1), ArrowUp: () => step(1),
      Home: () => set(first), End: () => set(last),
      Escape: () => { release(); thumb.blur(); },
    };
    if (!keys[e.key]) return;
    e.preventDefault();
    e.stopPropagation(); // the galaxy's own keys stay out of it
    keys[e.key]();
  };
  close.onclick = release;
  thumb.setAttribute("aria-valuemin", String(first));
  thumb.setAttribute("aria-valuemax", String(last));
  thumb.setAttribute("aria-valuetext", "No month chosen");
  window.addEventListener("resize", draw);
  requestAnimationFrame(draw);

  return { set, release, get month() { return month; } };
}
