// The way in: what Aphelion is, a place to drop your Spotify data, and how to get it, over a slowly turning
// galaxy. With a galaxy made already (kept in this browser, or built by galaxy.py) it also offers to open that.
// A reload, once this tab has been in the galaxy, or a link to a star goes straight in.
import { format, icon, session } from "./ui.js";
import { forgetUpload, makeGalaxy, uploadedGalaxy } from "./upload.js";

const $ = (id) => document.getElementById(id);
const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const phone = window.matchMedia("(max-width: 760px)"); // the same width as the small-screen layout in index.html
const LEAVE_SECONDS = 0.45; // the page fading out; the same as .welcome.leaving in index.html

// -> { data, uploaded }: the galaxy to show, and whether it's the one you uploaded here
export async function welcome() {
  const uploaded = await uploadedGalaxy();
  let data = uploaded;
  if (!data) {
    try { data = await (await fetch("galaxy.json")).json(); } catch { /* none built */ }
  }
  if (!data?.stars?.length) data = null;
  if (data && (session.get("entered") || location.hash.startsWith("#/artist/"))) {
    session.set("entered", "1");
    return { data, uploaded: Boolean(uploaded) };
  }
  return new Promise((resolve) => showPage(data, Boolean(uploaded), resolve));
}

function showPage(data, uploaded, resolve) {
  const page = $("welcome"), input = $("welcome-input"), status = $("welcome-status");
  const behind = [...document.body.children].filter((node) => node !== page && node.tagName !== "SCRIPT");
  for (const node of behind) node.inert = true; // the galaxy's own controls wait underneath
  const stopSky = sky($("welcome-sky"));
  page.hidden = false;

  $("welcome-drop").prepend(icon("upload"));
  $("welcome-privacy").prepend(icon("lock"));
  $("welcome-open").append(icon("arrow"));
  const touch = window.matchMedia("(pointer: coarse)").matches; // no dragging files about on a phone
  $("welcome-drop-title").textContent = data ? `Or ${touch ? "add" : "drop"} new data to make another`
    : touch ? "Add your Spotify data" : "Drop your Spotify data here";

  function enter(galaxy, kept) {
    session.set("entered", "1");
    page.classList.add("leaving");
    setTimeout(() => {
      stopSky();
      page.hidden = true;
      for (const node of behind) node.inert = false;
      resolve({ data: galaxy, uploaded: kept });
    }, calm ? 0 : LEAVE_SECONDS * 1000);
  }

  // A galaxy made before: open it, or drop new data to make another
  if (data) {
    $("welcome-return").hidden = false;
    $("welcome-return-meta").textContent = [
      format.count(data.stars.length + data.dust.length, "artist"),
      `${format.compact(data.plays)} plays`,
      `since ${format.month(data.start)}`,
    ].join(" · ");
    $("welcome-open").onclick = () => enter(data, uploaded);
    $("welcome-choose").classList.remove("primary"); // one main thing to do at a time
    const forget = $("welcome-forget");
    forget.hidden = !uploaded;
    forget.onclick = async () => {
      await forgetUpload();
      location.reload();
    };
  }

  const say = (text, problem = false) => {
    status.textContent = text;
    status.classList.toggle("problem", problem);
    status.classList.toggle("working", Boolean(text) && !problem);
  };

  async function take(files) {
    if (!files.length || page.classList.contains("busy")) return;
    page.classList.add("busy");
    try {
      const made = await makeGalaxy(files, say);
      if (!made) return;
      if (!made.kept) { // a moment to read that before the page goes
        say("Here it is. This browser won't keep it (a private window, maybe), so drop it again next time.");
        await new Promise((r) => setTimeout(r, 2600));
      }
      enter(made.galaxy, made.kept);
    } finally {
      page.classList.remove("busy");
    }
  }

  $("welcome-choose").onclick = () => input.click();
  input.onchange = () => { take([...input.files]); input.value = ""; };

  // Drop the files anywhere on the page; while you drag them over it, the drop zone lights up
  let depth = 0;
  const carriesFiles = (e) => e.dataTransfer?.types.includes("Files");
  page.ondragenter = (e) => {
    if (!carriesFiles(e)) return;
    depth++;
    page.classList.add("dragging");
  };
  page.ondragleave = () => {
    depth = Math.max(0, depth - 1);
    if (!depth) page.classList.remove("dragging");
  };
  page.ondragover = (e) => { if (carriesFiles(e)) e.preventDefault(); };
  page.ondrop = (e) => {
    e.preventDefault();
    depth = 0;
    page.classList.remove("dragging");
    take([...e.dataTransfer.files]);
  };
}

// ---------- the galaxy behind it ----------
// One spiral arm like the one you'll get, and like the logo: warm at the center where a listening life starts,
// blue at the tip, today. The disc is painted once, face on, then each frame turns it, tilts it and leans it;
// only the bright stars and today's ping are drawn fresh. Less motion: it holds still.

const TURNS = 1.75;
const TILT = 0.55;              // how flat the disc looks from here
const SLANT = -0.2;             // its long axis, tipped a little
const TURN_SECONDS = 300;       // one full turn
const ARM = ["#e37d5d", "#ffb385", "#ffa2bc", "#d29cf2", "#a1a4ff", "#75ccff"]; // the logo's colors, center to tip
const WORDS = 640;              // the column of words on the left, and some room, in CSS pixels
const START_SECONDS = 0;        // how far into its turn it starts, so today's tip starts clear of the words

function sky(canvas) {
  const ctx = canvas.getContext("2d");
  const rgb = ARM.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
  const colorAt = (f, alpha) => {
    const x = Math.min(0.999, Math.max(0, f)) * (rgb.length - 1), i = Math.floor(x), k = x - i;
    const [r, g, b] = rgb[i].map((c, j) => Math.round(c + (rgb[i + 1][j] - c) * k));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  // Laid out once, the same every time: a fixed seed. Positions are on a disc of radius 1.
  let seed = 20240917;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const spread = () => (random() + random() + random() - 1.5) / 1.5; // mostly near 0, now and then out to ±1
  const armAngle = (f) => f * TURNS * Math.PI * 2;
  const armRadius = (f) => 0.08 + 0.92 * f;
  const onArm = (f, width) => {
    const angle = armAngle(f) + spread() * 0.1, r = armRadius(f) + spread() * width;
    return { x: Math.cos(angle) * r, y: Math.sin(angle) * r, f };
  };
  const clouds = Array.from({ length: 170 }, () => {
    const f = Math.sqrt(random()); // as many per stretch of arm further out, where the arm is longer
    return { ...onArm(f, 0.05 + 0.05 * f), size: 0.05 + 0.06 * f + random() * 0.04, alpha: 0.05 + random() * 0.06 };
  });
  const motes = Array.from({ length: 4200 }, () => {
    const f = Math.sqrt(random());
    return { ...onArm(f, 0.03 + 0.07 * f), size: 0.5 + random() * 1.1, alpha: 0.25 + random() * 0.6 };
  });
  const dust = Array.from({ length: 1400 }, () => { // the disc around the arm, faint
    const angle = random() * Math.PI * 2, r = 0.1 + Math.sqrt(random()) * 1.02;
    return { x: Math.cos(angle) * r, y: Math.sin(angle) * r, size: 0.5 + random() * 0.7, alpha: 0.06 + random() * 0.16 };
  });
  const stars = Array.from({ length: 48 }, () => ({ // artists: bright, with a glow, twinkling
    ...onArm(0.06 + random() * 0.92, 0.04), size: 1.3 + Math.pow(random(), 3) * 3, phase: random() * Math.PI * 2, speed: 0.6 + random() * 1.4,
  }));
  const field = Array.from({ length: 280 }, () => ({ // the sky far behind, on the screen itself
    x: random(), y: random(), size: 0.4 + random() * 0.9, alpha: 0.15 + random() * 0.45, phase: random() * Math.PI * 2,
  }));
  const tip = { x: Math.cos(armAngle(1)) * armRadius(1), y: Math.sin(armAngle(1)) * armRadius(1) };

  // A soft round glow, drawn once and stamped for each bright star
  const glow = document.createElement("canvas");
  glow.width = glow.height = 64;
  {
    const g = glow.getContext("2d"), gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255, 255, 255, 0.9)");
    gradient.addColorStop(0.18, "rgba(255, 255, 255, 0.35)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    g.fillStyle = gradient;
    g.fillRect(0, 0, 64, 64);
  }

  const disc = document.createElement("canvas");
  let width = 0, height = 0, scale = 1, cx = 0, cy = 0, radius = 0;

  // The disc face on, `radius` pixels from its center to the tip of the arm
  function paintDisc() {
    const half = Math.ceil(radius * 1.2);
    disc.width = disc.height = half * 2;
    const d = disc.getContext("2d");
    d.translate(half, half);
    d.globalCompositeOperation = "lighter";
    const heart = d.createRadialGradient(0, 0, 0, 0, 0, radius * 0.45); // warm, where it all started
    heart.addColorStop(0, "rgba(255, 190, 150, 0.34)");
    heart.addColorStop(0.35, "rgba(240, 140, 170, 0.1)");
    heart.addColorStop(1, "rgba(120, 110, 220, 0)");
    d.fillStyle = heart;
    d.fillRect(-half, -half, half * 2, half * 2);
    for (const c of clouds) {
      const x = c.x * radius, y = c.y * radius, size = c.size * radius;
      const cloud = d.createRadialGradient(x, y, 0, x, y, size);
      cloud.addColorStop(0, colorAt(c.f, c.alpha));
      cloud.addColorStop(1, colorAt(c.f, 0));
      d.fillStyle = cloud;
      d.fillRect(x - size, y - size, size * 2, size * 2);
    }
    for (const m of dust) {
      d.fillStyle = `rgba(170, 180, 225, ${m.alpha})`;
      d.fillRect(m.x * radius, m.y * radius, m.size * scale, m.size * scale);
    }
    for (const m of motes) {
      d.fillStyle = colorAt(m.f, m.alpha);
      d.fillRect(m.x * radius, m.y * radius, m.size * scale, m.size * scale);
    }
  }

  function resize() {
    scale = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.width = Math.round(window.innerWidth * scale);
    height = canvas.height = Math.round(window.innerHeight * scale);
    if (phone.matches) { // above the words, at the top
      radius = Math.min(width * 0.5, height * 0.24);
      cx = width * 0.5;
      cy = height * 0.19;
    } else { // to the right of the words, running under them a little only on narrow windows
      const free = width - WORDS * scale;
      radius = Math.min(height * 0.52, Math.max(free * 0.46, width * 0.28));
      cx = Math.max(width - radius * 1.08 - 24 * scale, width * 0.6);
      cy = height * 0.5;
    }
    paintDisc();
    if (calm) draw(START_SECONDS);
  }

  // A little parallax: the galaxy leans away from the pointer
  const lean = { x: 0, y: 0, wantX: 0, wantY: 0 };
  const onPointer = (e) => {
    lean.wantX = (e.clientX / window.innerWidth - 0.5) * -18 * scale;
    lean.wantY = (e.clientY / window.innerHeight - 0.5) * -12 * scale;
  };

  // From the disc, face on, to the screen: turned, then tilted away, then leaned
  const place = (turn) => {
    ctx.setTransform(1, 0, 0, 1, cx + lean.x, cy + lean.y);
    ctx.rotate(SLANT);
    ctx.scale(1, TILT);
    ctx.rotate(turn);
  };
  const toScreen = (x, y, turn) => {
    const cosT = Math.cos(turn), sinT = Math.sin(turn);
    const u = (x * cosT - y * sinT) * radius, v = (x * sinT + y * cosT) * radius * TILT;
    return [cx + lean.x + u * Math.cos(SLANT) - v * Math.sin(SLANT), cy + lean.y + u * Math.sin(SLANT) + v * Math.cos(SLANT)];
  };

  function draw(seconds) {
    const turn = -(seconds / TURN_SECONDS) * Math.PI * 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = "lighter";

    ctx.fillStyle = "#cdd5f5";
    for (const s of field) {
      ctx.globalAlpha = s.alpha * (calm ? 1 : 0.7 + 0.3 * Math.sin(seconds * 0.8 + s.phase));
      ctx.fillRect(s.x * width, s.y * height, s.size * scale, s.size * scale);
    }
    ctx.globalAlpha = 1;

    place(turn);
    ctx.drawImage(disc, -disc.width / 2, -disc.height / 2);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    for (const s of stars) {
      const [x, y] = toScreen(s.x, s.y, turn);
      const twinkle = calm ? 1 : 0.75 + 0.25 * Math.sin(seconds * s.speed + s.phase);
      const size = s.size * scale * 7 * twinkle;
      ctx.globalAlpha = 0.55 * twinkle;
      ctx.drawImage(glow, x - size / 2, y - size / 2, size, size);
      ctx.globalAlpha = 1;
      ctx.fillStyle = colorAt(s.f, 0.95);
      ctx.beginPath();
      ctx.arc(x, y, s.size * scale * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // today: the tip of the arm, white with a blue glow and a slow ping, like the logo
    const [tx, ty] = toScreen(tip.x, tip.y, turn), reach = 28 * scale;
    const halo = ctx.createRadialGradient(tx, ty, 0, tx, ty, reach);
    halo.addColorStop(0, "rgba(114, 208, 255, 0.75)");
    halo.addColorStop(1, "rgba(114, 208, 255, 0)");
    ctx.fillStyle = halo;
    ctx.fillRect(tx - reach, ty - reach, reach * 2, reach * 2);
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(tx, ty, 3 * scale, 0, Math.PI * 2);
    ctx.fill();
    if (!calm) {
      const ping = (seconds / 2.4) % 1;
      ctx.strokeStyle = `rgba(114, 208, 255, ${0.8 * (1 - ping)})`;
      ctx.lineWidth = scale;
      ctx.beginPath();
      ctx.arc(tx, ty, (4 + ping * 16) * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  let frame = 0;
  const start = performance.now() - START_SECONDS * 1000;
  const loop = (now) => {
    lean.x += (lean.wantX - lean.x) * 0.04;
    lean.y += (lean.wantY - lean.y) * 0.04;
    draw((now - start) / 1000);
    frame = requestAnimationFrame(loop);
  };

  window.addEventListener("resize", resize);
  resize();
  if (!calm) {
    window.addEventListener("pointermove", onPointer);
    frame = requestAnimationFrame(loop);
  }
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", resize);
    window.removeEventListener("pointermove", onPointer);
  };
}
