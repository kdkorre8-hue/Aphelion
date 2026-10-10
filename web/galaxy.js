// Aphelion: your listening timeline as a galaxy.
// The spiral arm is your listening life: your first play is in the center and today is at the tip.
// Each artist you've really listened to is one star, placed where you played them the most.
// Star size = time listened. Color = how recently you played them: blue = still playing, amber/red = left behind.
// Point at a star to see its era along the arm: when you first and last played them, and each month you did.
// Click it to fly in: its songs become planets. Artists you played less are dust along the arm.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import {
  starMaterial, softMaterial, cloudMaterial, makePoints, cloudTexture,
  backgroundMaterial, sunMaterial, atmosphereMaterial, planetTexture,
} from "./shaders.js";
import * as ui from "./ui.js";
import { setupSearch } from "./search.js";
import { setupScrubber } from "./scrubber.js";
import { FORMATS, composePoster, setupShare } from "./poster.js";
import { setupRecency } from "./recency.js";
import { setupUpload, uploadedGalaxy } from "./upload.js";

const TURNS = 2;                 // how many times the timeline winds around the center
const INNER_RADIUS = 20;         // where your first play is
const OUTER_RADIUS = 240;        // where today is
const ARM_WIDTH = [10, 34];      // width of the arm at the start and at today
const MAX_PLANETS = 20;          // an artist's most played songs become planets, the rest an asteroid belt
const PLANET_LABELS = 8;         // how many planets get a name tag (the rest on hover)
const BELT_COLOR = "#8d8479";    // the asteroid belt's rocks
const NAMED_STARS = [6, 4];      // how many of your most played artists always have their name shown (on phones)
const ORBIT_SPEED = 0.5;
const BREAK_MONTHS = 4;          // this many empty months in a row count as a break in your listening
const BREAK_ROOM = 1.5;          // a whole break takes as much of the arm as 1.5 months you listened
const QUIET_MONTH_ROOM = 0.3;    // a single empty month takes 30% of the room
const DAY = 86400;
// Star color by days since you last played the artist: hot blue now, cooling through violet and pink to amber and red
const HEAT = [[0, "#72d0ff"], [21, "#8fa8ff"], [90, "#c49bff"], [270, "#ff9fc6"], [730, "#ffb778"], [1825, "#e0775a"]];
const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const phone = window.matchMedia("(max-width: 760px)"); // the same width as the small-screen layout in index.html

// ---------- helpers ----------

// Seeded random numbers, so everything lands in the same spot every time
function seededRandom(text) {
  let a = 2166136261;
  for (let i = 0; i < text.length; i++) a = Math.imul(a ^ text.charCodeAt(i), 16777619);
  return () => { // mulberry32
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function heatColor(daysAgo) {
  const x = Math.log1p(Math.max(daysAgo, 0));
  for (let i = 0; i < HEAT.length - 1; i++) {
    const [d0, c0] = HEAT[i], [d1, c1] = HEAT[i + 1];
    if (daysAgo <= d1) {
      const t = (x - Math.log1p(d0)) / (Math.log1p(d1) - Math.log1p(d0));
      return new THREE.Color(c0).lerp(new THREE.Color(c1), Math.max(0, t));
    }
  }
  return new THREE.Color(HEAT.at(-1)[1]);
}

// Artists you left behind long ago also shine less
const brightness = (daysAgo) => 1 - 0.4 * Math.min(1, Math.log1p(Math.max(daysAgo, 0)) / Math.log1p(1825));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// Time -> 0..1 along the arm. Months you listened get equal room, a lone empty month gets a little,
// and long breaks shrink to a short stretch that is labelled with how long it really was.
// (An older galaxy.json without monthly totals just spreads time evenly.)
function buildTimeline(data) {
  const first = ui.monthNumber(data.start), last = ui.monthNumber(data.end);
  const active = new Set((data.months ?? []).map(([month]) => month));
  const room = [], breaks = [];
  for (let m = first; m <= last;) {
    if (!data.months || active.has(m)) { room.push(1); m++; continue; }
    let end = m;
    while (end < last && !active.has(end + 1)) end++;
    const length = end - m + 1;
    const isBreak = length >= BREAK_MONTHS;
    if (isBreak) breaks.push({ from: m, to: end });
    for (let k = m; k <= end; k++) room.push(isBreak ? BREAK_ROOM / length : QUIET_MONTH_ROOM);
    m = end + 1;
  }
  const before = [0]; // room used before each month
  for (const r of room) before.push(before.at(-1) + r);
  const monthLength = (i) => ui.monthStart(first + i + 1) - ui.monthStart(first + i);
  const position = (time) => {
    const i = Math.min(Math.max(ui.monthNumber(time) - first, 0), room.length - 1);
    const within = Math.min(Math.max((time - ui.monthStart(first + i)) / monthLength(i), 0), 1);
    return before[i] + room[i] * within;
  };
  const from = position(data.start), to = Math.max(position(data.end), from + 1e-6);
  return {
    breaks,
    activeMonths: data.months ? active.size : last - first + 1,
    frac: (time) => Math.min(1, Math.max(0, (position(time) - from) / (to - from))),
    timeAt(f) { // the other way round: 0..1 along the arm -> time
      const target = from + f * (to - from);
      let i = 0;
      while (i < room.length - 1 && before[i + 1] <= target) i++;
      return ui.monthStart(first + i) + ((target - before[i]) / room[i]) * monthLength(i);
    },
    inBreak: (time) => breaks.some((b) => time >= ui.monthStart(b.from) && time < ui.monthStart(b.to + 1)),
  };
}

function label(html, className) {
  const div = document.createElement("div");
  div.className = `label ${className}`;
  div.append(...html);
  return new CSS2DObject(div);
}

function dispose(object) {
  object.traverse((o) => {
    if (o.isCSS2DObject) o.element.remove();
    o.geometry?.dispose();
    for (const m of [o.material].flat()) {
      m?.map?.dispose();
      m?.dispose();
    }
  });
}

// ---------- scene ----------

async function main() {
  // The arrival from afar, unless you'd rather have less motion or a link takes you straight to a star: the
  // page's own parts wait for it from the start, under the loading screen
  const introduce = !calm && !location.hash.startsWith("#/artist/");
  if (introduce) ui.startIntro();
  // the galaxy you uploaded here, if you did; otherwise the one galaxy.py built
  const uploaded = await uploadedGalaxy();
  let data = uploaded;
  if (!data) {
    try { data = await (await fetch("galaxy.json")).json(); } catch { /* none built: ask for your data instead */ }
  }
  if (!data?.stars?.length) {
    setupUpload({ alone: true });
    ui.doneLoading();
    return;
  }
  ui.setupHeader(data, showWholeGalaxy);
  ui.setupLegend(HEAT, !phone.matches && ui.settings.get("legend") !== "closed"); // folded on phones, to start with

  // Time -> place on the spiral arm
  const timeline = buildTimeline(data);
  const { frac } = timeline;
  const armWidth = (f) => ARM_WIDTH[0] + (ARM_WIDTH[1] - ARM_WIDTH[0]) * f;
  function onArm(f, side = 0, height = 0) { // side: -1 inner edge of the arm, 1 outer edge
    const angle = f * TURNS * Math.PI * 2;
    const r = INNER_RADIUS + (OUTER_RADIUS - INNER_RADIUS) * f + (side * armWidth(f)) / 2;
    return new THREE.Vector3(Math.cos(angle) * r, height, Math.sin(angle) * r);
  }
  const daysAgo = (time) => (data.end - time) / DAY;

  const renderer = new THREE.WebGLRenderer();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.body.prepend(renderer.domElement);
  renderer.domElement.setAttribute("role", "img");
  renderer.domElement.setAttribute("aria-label", `Your listening galaxy: ${(data.stars.length + data.dust.length).toLocaleString("en-US")} artists ` +
    `along a spiral from ${ui.format.month(data.start)} to today. Search with the slash key to go to an artist or a song.`);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  Object.assign(labelRenderer.domElement.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "1" });
  document.body.append(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.12));
  const sunlight = new THREE.PointLight(0xffffff, 2.2, 0, 0); // moves to the star you're visiting
  scene.add(sunlight);

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, OUTER_RADIUS * 40);
  const home = { target: new THREE.Vector3(), dir: new THREE.Vector3(0, 0.8, 0.6).normalize(), distance: OUTER_RADIUS * 2.2 };

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.autoRotate = !calm;
  controls.autoRotateSpeed = 0.15;
  controls.minDistance = 0.5;
  controls.maxDistance = OUTER_RADIUS * 5;
  controls.addEventListener("start", () => { controls.autoRotate = false; });

  const stars = starMaterial(), soft = softMaterial();
  const clouds = cloudMaterial(cloudTexture(seededRandom("cloud")));
  const sunGlow = softMaterial(); // the glow around a visited star's sun
  sunGlow.uniforms.nearFade.value = 0; // it's meant to be big
  const pointMaterials = [stars, soft, clouds, sunGlow];

  // Deep space all around. Its noise shader is expensive and never changes, so it's drawn once
  // into a cube map here instead of for every pixel on every frame.
  {
    const sky = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType }); // half float keeps the dark gradients smooth
    const space = new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), backgroundMaterial());
    new THREE.CubeCamera(1, 100, sky).update(renderer, new THREE.Scene().add(space));
    dispose(space);
    scene.background = sky.texture;
  }
  {
    const rand = seededRandom("sky");
    const sky = { positions: [], tints: [], sizes: [] };
    for (let i = 0; i < 3000; i++) {
      const v = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize().multiplyScalar(OUTER_RADIUS * (8 + rand() * 6));
      sky.positions.push(v.x, v.y, v.z);
      const b = 0.12 + Math.pow(rand(), 3) * 0.5;
      const warm = rand() < 0.3;
      sky.tints.push(b * (warm ? 1 : 0.85), b * 0.92, b * (warm ? 0.8 : 1.05));
      sky.sizes.push((2.5 + rand() * 3) * (OUTER_RADIUS / 150));
    }
    scene.add(makePoints(sky, soft));
  }

  // The arm: a faint timeline line, soft gas clouds and haze
  const ARM_LINE_OPACITY = 0.14;
  const armLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(Array.from({ length: 801 }, (_, i) => onArm(i / 800))),
    new THREE.LineBasicMaterial({ color: "#6d7fa8", transparent: true, opacity: ARM_LINE_OPACITY, depthWrite: false }),
  );
  scene.add(armLine);
  {
    const rand = seededRandom("gas");
    const gas = { positions: [], tints: [], sizes: [], seeds: [] };
    for (let i = 0; i < 240; i++) {
      const f = rand();
      const time = timeline.timeAt(f);
      if (timeline.inBreak(time) && rand() < 0.85) continue; // breaks stay mostly empty
      const p = onArm(f, (rand() + rand() - 1) * 0.9, (rand() - 0.5) * 3);
      gas.positions.push(p.x, p.y, p.z);
      const c = heatColor(daysAgo(time)).multiplyScalar(0.05);
      gas.tints.push(c.r, c.g, c.b);
      gas.sizes.push(armWidth(f) * (1.2 + rand() * 1.6));
      gas.seeds.push(rand());
    }
    scene.add(makePoints(gas, clouds));

    const haze = { positions: [], tints: [], sizes: [] };
    for (let i = 0; i < 5000; i++) {
      const p = onArm(rand(), (rand() + rand() + rand() - 1.5) * 1.4, (rand() - 0.5) * 3);
      haze.positions.push(p.x, p.y, p.z);
      const b = 0.05 + rand() * 0.05;
      haze.tints.push(b * 0.9, b, b * 1.25);
      haze.sizes.push(0.8 + rand() * 1.4);
    }
    // a warm glow where it all began
    haze.positions.push(0, 0, 0);
    haze.tints.push(0.16, 0.12, 0.09);
    haze.sizes.push(INNER_RADIUS * 6);
    scene.add(makePoints(haze, soft));
  }

  // Dust: artists you played less, at the month you played them most
  const dustPositions = [];
  let dustPoints;
  {
    const maxPlays = Math.max(1, ...data.dust.map((a) => a.plays));
    const dust = { positions: [], tints: [], sizes: [], seeds: [] };
    for (const artist of data.dust) {
      const rand = seededRandom(artist.name);
      const p = onArm(frac(artist.peak + (rand() - 0.5) * 30 * DAY), (rand() * 2 - 1) * 1.1, (rand() - 0.5) * 2);
      dustPositions.push(p);
      dust.positions.push(p.x, p.y, p.z);
      const c = heatColor(daysAgo(artist.last)).multiplyScalar(0.75 * brightness(daysAgo(artist.last)));
      dust.tints.push(c.r, c.g, c.b);
      dust.sizes.push(2.2 + 3.5 * Math.sqrt(artist.plays / maxPlays));
      dust.seeds.push(rand());
    }
    dustPoints = makePoints(dust, stars);
    scene.add(dustPoints);
  }

  // Stars: one per artist you've really listened to
  const maxHours = Math.max(...data.stars.map((a) => a.hours), 0.01);
  const starInfo = data.stars.map((artist, index) => {
    const rand = seededRandom(artist.name);
    const side = (rand() * 2 - 1) * 0.85;
    const height = (rand() - 0.5) * 3;
    const f = frac(artist.peak + (rand() - 0.5) * 20 * DAY); // somewhere in the peak month
    const position = onArm(f, side, height);
    const weight = Math.sqrt(artist.hours / maxHours);
    return {
      kind: "star", index, artist, f, side, height, position, weight,
      color: heatColor(daysAgo(artist.last)),
      shine: brightness(daysAgo(artist.last)),
      size: 10 + 28 * weight,
      twinkle: rand(),
    };
  });
  const starPoints = makePoints({
    positions: starInfo.flatMap((s) => s.position.toArray()),
    tints: starInfo.flatMap((s) => s.color.clone().multiplyScalar(s.shine).toArray()),
    sizes: starInfo.map((s) => s.size),
    seeds: starInfo.map((s) => s.twinkle),
    spikes: starInfo.map((s) => Math.min(1, Math.max(0, (s.weight - 0.35) / 0.65))),
  }, stars);
  scene.add(starPoints);

  function setStarSize(info, factor) {
    starPoints.geometry.attributes.size.array[info.index] = info.size * factor;
    starPoints.geometry.attributes.size.needsUpdate = true;
  }

  // Bring some stars and dust forward by dimming the rest: the star you point at, and so on. starWeight and
  // dustWeight say how much each one stays lit (0-1); the dimming fades in, and out again with no weights.
  let focusWanted = 0;
  function setEmphasis(starWeight, dustWeight = () => 0) {
    const write = (points, items, weight) => {
      const { emphasis } = points.geometry.attributes;
      items.forEach((item, i) => { emphasis.array[i] = weight(item); });
      emphasis.needsUpdate = true;
    };
    if (starWeight) {
      write(starPoints, starInfo, starWeight);
      write(dustPoints, data.dust, dustWeight);
      for (const info of starInfo) info.name.element.classList.toggle("dimmed", starWeight(info) < 0.5);
    }
    focusWanted = starWeight ? 1 : 0;
    document.body.classList.toggle("focused", !!starWeight);
  }

  // An artist's era along their lane in the arm: a faint trail from the first time you played them to the
  // last, and a pulse for every month you did, bigger the more you played them that month
  function makeEra(info) {
    const { artist } = info;
    const era = { positions: [], tints: [], sizes: [] };
    const add = (p, color, size) => {
      era.positions.push(p.x, p.y, p.z);
      era.tints.push(color.r, color.g, color.b);
      era.sizes.push(size);
    };
    // the trail's dots are spaced evenly along the arm (not in time), so it reads as one even line
    const from = frac(artist.first), to = frac(artist.last);
    const trail = info.color.clone().multiplyScalar(0.5 * info.shine);
    let last = null;
    for (let i = 0; i <= 4000; i++) {
      const p = onArm(from + ((to - from) * i) / 4000, info.side, info.height);
      if (last && p.distanceTo(last) < 2.4) continue;
      add(p, trail, 3);
      last = p;
    }
    const busiest = Math.max(...artist.months.map(([, n]) => n));
    for (const [month, n] of artist.months) {
      const strength = Math.sqrt(n / busiest);
      const p = onArm(frac(ui.monthStart(month) + 15 * DAY), info.side, info.height);
      add(p, info.color.clone().multiplyScalar((0.6 + 0.9 * strength) * info.shine), 5 + 11 * strength);
    }
    const points = makePoints(era, soft);
    scene.add(points);
    return points;
  }

  // Time along the arm: years, or every 3 months when you've listened for 2 years or less.
  // Breaks get their own label saying how long they were, plus the month you started listening again.
  const timeLabels = [];
  const milestones = {}; // the "First play" and "Today" labels
  {
    const short = timeline.activeMonths <= 24;
    const labelled = new Set();
    const addTime = (month, text) => {
      if (labelled.has(month)) return;
      labelled.add(month);
      const l = label([text], "note time");
      l.position.copy(onArm(frac(ui.monthStart(month)), 1.35));
      timeLabels.push(l);
    };
    for (let month = ui.monthNumber(data.start) + 1; month <= ui.monthNumber(data.end); month++) {
      if (short ? month % 3 !== 0 : month % 12 !== 0) continue;
      if (timeline.inBreak(ui.monthStart(month))) continue;
      const f = frac(ui.monthStart(month));
      if (f < 0.06 || f > 0.95) continue; // too close to the "First play" and "Today" labels
      addTime(month, short ? ui.format.month(ui.monthStart(month)) : String(Math.floor(month / 12)));
    }
    for (const b of timeline.breaks) {
      const middle = (ui.monthStart(b.from) + ui.monthStart(b.to + 1)) / 2;
      const gap = label([`${ui.format.duration(b.to - b.from + 1)} without plays`], "note gap");
      gap.position.copy(onArm(frac(middle), 1.35));
      timeLabels.push(gap);
      if (b.to < ui.monthNumber(data.end)) addTime(b.to + 1, ui.format.month(ui.monthStart(b.to + 1)));
    }
    const first = label([`First play · ${ui.format.month(data.start)}`], "name milestone");
    first.position.copy(onArm(0, 0, 5));
    const dot = document.createElement("span");
    dot.className = "pulse";
    const today = label([dot, "Today"], "name milestone today");
    today.position.copy(onArm(1, 0, 5));
    Object.assign(milestones, { first, today });
    timeLabels.push(first, today);
    // most important first, for when they'd cover each other
    const order = (l) => ["milestone", "gap", "time"].findIndex((c) => l.element.classList.contains(c));
    timeLabels.sort((a, b) => order(a) - order(b));
    scene.add(...timeLabels);
  }

  // Star names, just below each star. Only some show at a time (see starNames)
  for (const info of starInfo) {
    info.name = label([info.artist.name], info.index < 3 ? "name star major" : "name star");
    info.name.position.copy(info.position);
    info.name.center.set(0.5, -0.8);
    scene.add(info.name);
  }
  const keyLabels = timeLabels.filter((l) => !l.element.classList.contains("time")); // milestones and breaks
  const tickLabels = timeLabels.filter((l) => l.element.classList.contains("time"));

  // Smooth edges, and one tone-mapping step for everything so glows stay soft. Multisampling is the most
  // expensive part of a frame, and screens with small pixels need less of it (none at 2x, where it costs 5x the frame)
  const ratio = renderer.getPixelRatio();
  const samples = ratio >= 2 ? 0 : ratio > 1 ? 2 : 4;
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples }));
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new OutputPass());

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(window.innerWidth, window.innerHeight);
    const scale = (window.innerHeight * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    for (const m of pointMaterials) m.uniforms.scale.value = scale;
  }
  window.addEventListener("resize", resize);
  resize();

  // ---------- visiting a star: its songs as planets ----------

  let system = null;
  const planets = [];

  // The stars, dust and haze around the star you visit fade away so its planets have room, and come back
  // when you leave. Two clearings, so the one you're leaving can fill back in while the next one opens.
  const clearings = [0, 1].map(() => ({ zone: new THREE.Vector4(), target: 0 })); // zone: center xyz, radius w
  let clearing = clearings[0];
  stars.uniforms.clearings.value = soft.uniforms.clearings.value = clearings.map((c) => c.zone);

  function openClearing(position, radius) {
    clearing.target = 0;
    clearing = clearings.find((c) => c !== clearing);
    clearing.zone.set(position.x, position.y, position.z, 0);
    clearing.target = radius;
  }
  const inClearing = (p) => {
    const z = clearing.zone;
    return Math.hypot(p.x - z.x, p.y - z.y, p.z - z.z) < z.w * 1.15; // about where they're half faded
  };

  function openSystem(info) {
    const { artist } = info;
    const group = new THREE.Group();
    group.position.copy(info.position);
    scene.add(group);
    const rand = seededRandom(`system-${artist.name}`);

    const sunRadius = 0.9 + 2.6 * info.weight;
    const sun = new THREE.Mesh(new THREE.SphereGeometry(sunRadius, 64, 32), sunMaterial(info.color.clone()));
    group.add(sun);
    // A glow around the sun, a bright one and a wide halo, so the star you clicked visibly turns into it.
    // Right at the star's own position, which the clearing around it leaves alone.
    const glowColor = info.color.clone().multiplyScalar(info.shine);
    const glow = makePoints({
      positions: [...info.position.toArray(), ...info.position.toArray()],
      tints: [...glowColor.clone().multiplyScalar(0.9).toArray(), ...glowColor.clone().multiplyScalar(0.28).toArray()],
      sizes: [sunRadius * 7, sunRadius * 22],
    }, sunGlow);
    scene.add(glow);

    const orbits = new THREE.Group();
    orbits.rotation.x = (rand() - 0.5) * 0.3;
    group.add(orbits);

    const planetSongs = artist.songs.slice(0, MAX_PLANETS).sort((a, b) => a.first - b.first); // inner = found first
    const maxPlays = Math.max(...planetSongs.map((s) => s.plays));
    const named = new Set(artist.songs.slice(0, PLANET_LABELS));
    const targets = [], meshes = new Map(), colors = new Map(); // song -> its planet, its planet's color
    const build = { start: Infinity, items: [], belt: null }; // see buildSystem
    let orbit = sunRadius * 1.8 + 0.8, previous = 0;
    for (const song of planetSongs) {
      const size = 0.35 + 1.0 * Math.sqrt(song.plays / maxPlays);
      // Seen from the usual ~40° above, orbits look squashed to about 0.64 of their spacing, so neighbours
      // need 1.6x their radii apart or they seem to crash into each other when one overtakes the other
      orbit += 1.7 * (previous + size) + 0.4;
      previous = size;
      // its orbit: fainter the less you played the song, so 20 rings don't all shout at once
      const path = new THREE.EllipseCurve(0, 0, orbit, orbit).getPoints(160).map((p) => new THREE.Vector3(p.x, 0, p.y));
      const orbitOpacity = 0.03 + 0.09 * Math.sqrt(song.plays / maxPlays);
      const orbitLine = new THREE.Line( // the path ends where it starts, and can be drawn partway
        new THREE.BufferGeometry().setFromPoints(path),
        new THREE.LineBasicMaterial({ color: info.color, transparent: true, opacity: orbitOpacity, depthWrite: false }),
      );
      orbitLine.userData.opacity = orbitOpacity;
      orbits.add(orbitLine);
      const pivot = new THREE.Object3D();
      pivot.rotation.y = rand() * Math.PI * 2;
      orbits.add(pivot);
      const color = heatColor(daysAgo(song.last)).offsetHSL((rand() - 0.5) * 0.06, -0.12, -0.04);
      const planet = new THREE.Mesh(
        new THREE.SphereGeometry(size, 48, 24),
        new THREE.MeshStandardMaterial({ map: planetTexture(color, rand), roughness: 0.85 }),
      );
      planet.position.x = orbit;
      planet.rotation.z = (rand() - 0.5) * 0.5;
      planet.userData = { kind: "song", song, artist, size, rank: artist.songs.indexOf(song) };
      planet.add(new THREE.Mesh(new THREE.SphereGeometry(size * 1.07, 48, 24), atmosphereMaterial(color.clone().offsetHSL(0, 0.1, 0.1), info.position.clone())));
      pivot.add(planet);
      planets.push({ pivot, speed: ORBIT_SPEED / Math.pow(orbit, 0.9) });
      targets.push(planet);
      meshes.set(song, planet);
      colors.set(song, `#${color.getHexString()}`);
      const tag = label([song.name], "name planet");
      tag.position.set(0, size + 0.35, 0);
      tag.visible = named.has(song) && namesOn;
      planet.add(tag);
      planet.userData.tag = tag;
      planet.userData.named = named.has(song);
      planet.userData.orbit = orbitLine;
      build.items.push({ orbit: orbitLine, planet });
    }

    // Songs you played less: an asteroid belt
    let extent = orbit + previous;
    const beltSongs = artist.songs.slice(MAX_PLANETS);
    if (beltSongs.length) {
      const beltRadius = orbit + previous + 2;
      const beltColor = info.color.clone().lerp(new THREE.Color(BELT_COLOR), 0.55); // rock, with a hint of its star
      const belt = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(1, 0),
        // a faint glow of their own, or the rocks on the far side of the sun disappear
        new THREE.MeshStandardMaterial({ color: beltColor, emissive: beltColor, emissiveIntensity: 0.3, roughness: 1, flatShading: true, transparent: true }),
        beltSongs.length,
      );
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
      beltSongs.forEach((song, i) => {
        const angle = (i / beltSongs.length) * Math.PI * 2 + rand() * 0.3;
        const r = beltRadius + (rand() - 0.5) * 1.6;
        p.set(Math.cos(angle) * r, (rand() - 0.5) * 0.5, Math.sin(angle) * r);
        q.setFromEuler(new THREE.Euler(rand() * 6, rand() * 6, rand() * 6));
        const size = 0.3 + 0.1 * Math.sqrt(song.plays); // big enough to see from where the system fits the view
        s.set(size * (0.8 + rand() * 0.5), size * (0.6 + rand() * 0.4), size);
        belt.setMatrixAt(i, m.compose(p, q, s));
        colors.set(song, `#${beltColor.getHexString()}`);
      });
      belt.userData = { kind: "belt", songs: beltSongs, artist };
      build.belt = belt;
      orbits.add(belt);
      planets.push({ pivot: belt, speed: (ORBIT_SPEED * 0.4) / Math.sqrt(beltRadius) });
      targets.push(belt);
      extent = beltRadius + 1;
    }
    sunlight.position.copy(info.position);
    const byRank = targets.filter((t) => t.userData.kind === "song").sort((a, b) => a.userData.rank - b.userData.rank);
    // Points around the outermost orbit, in the tilted plane of the orbits, to fit the whole system into view
    group.updateMatrixWorld(true);
    const ring = Array.from({ length: 32 }, (_, i) => {
      const angle = (i / 32) * Math.PI * 2;
      return { p: new THREE.Vector3(Math.cos(angle) * extent, 0, Math.sin(angle) * extent).applyMatrix4(orbits.matrixWorld) };
    });
    return { info, group, sun, glow, targets, meshes, colors, byRank, extent, ring, build: calm ? null : build, era: makeEra(info) };
  }

  // A system builds itself as you arrive: its orbits draw out from the sun, innermost first, and each planet
  // grows in with a little overshoot just after its orbit, then gets its name; the asteroid belt fades in last
  const easeOutBack = (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
  function buildSystem(now) {
    const { build } = system;
    const time = (now - build.start) / 1000;
    let done = true;
    build.items.forEach(({ orbit, planet }, i) => {
      const draw = THREE.MathUtils.clamp((time - i * 0.035) / 0.5, 0, 1);
      orbit.geometry.setDrawRange(0, Math.ceil(orbit.geometry.attributes.position.count * (1 - Math.pow(1 - draw, 3))));
      const grow = THREE.MathUtils.clamp((time - 0.15 - i * 0.04) / 0.45, 0, 1);
      planet.userData.grow = easeOutBack(grow);
      planet.scale.setScalar(Math.max(1e-3, planet.userData.grow) * (planet.userData.lit ? 1.25 : 1));
      planet.userData.tag.visible = grow === 1 && (planet.userData.lit || (planet.userData.named && namesOn));
      if (grow < 1) done = false;
    });
    if (build.belt) {
      const fade = THREE.MathUtils.clamp((time - 0.3 - build.items.length * 0.04) / 0.6, 0, 1);
      build.belt.material.opacity = fade;
      if (fade < 1) done = false;
      else {
        build.belt.material.transparent = false;
        build.belt.material.needsUpdate = true;
      }
    }
    if (done) system.build = null;
  }

  function closeSystem() {
    if (!system) return;
    scene.remove(system.group, system.era, system.glow);
    dispose(system.group);
    system.era.geometry.dispose(); // their material is shared, so keep that
    system.glow.geometry.dispose();
    planets.length = 0;
    system = null;
    selected = null;
  }

  // Highlight a planet when you point at its song in the panel (the selected song's stays highlighted)
  function highlightSong(song, on) {
    const planet = system?.meshes.get(song);
    if (!planet || (!on && song === selected)) return;
    planet.userData.lit = on;
    planet.scale.setScalar((on ? 1.25 : 1) * (planet.userData.grow ?? 1));
    const { orbit } = planet.userData;
    orbit.material.opacity = on ? 0.35 : orbit.userData.opacity;
    planet.userData.tag.visible = on || (planet.userData.named && namesOn);
    planet.userData.tag.element.classList.toggle("lit", on);
  }

  // A label fades out while it would cover a label that matters more, or stick out of the free part of the
  // window, and comes back once there's room. Labels come most important first.
  const labelAt = new THREE.Vector3();
  function declutter(labels) {
    const placed = [...chromeBoxes()];
    const left = insets.left, top = insets.top, right = window.innerWidth - insets.right, bottom = window.innerHeight - insets.bottom;
    for (const l of labels) {
      if (!l.visible) continue;
      // measured once: it doesn't change, and reading it every frame makes the browser lay out the page again
      l.userData.size ??= l.element.offsetWidth ? [l.element.offsetWidth, l.element.offsetHeight] : undefined; // 0 until drawn once
      if (!l.userData.size) continue;
      const [w, h] = l.userData.size;
      l.getWorldPosition(labelAt).project(camera);
      const x = ((labelAt.x + 1) / 2) * window.innerWidth - w * l.center.x;
      const y = ((1 - labelAt.y) / 2) * window.innerHeight - h * l.center.y;
      const box = [x - 4, y, x + w + 4, y + h];
      const hidden = box[0] < left || box[2] > right || box[1] < top || box[3] > bottom
        || placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
      l.element.classList.toggle("crowded", hidden);
      if (!hidden) placed.push(box);
    }
  }
  // The legend, the view toolbar and the time strip sit over the scene, so labels make way for them too. They only move
  // when the layout changes, so they're measured twice a second rather than every frame.
  let chrome = [], chromeAt = -Infinity;
  function chromeBoxes() {
    if (performance.now() - chromeAt > 500) {
      chromeAt = performance.now();
      chrome = ["legend", "controls", "scrubber", "story"].map((id) => document.getElementById(id).getBoundingClientRect())
        .filter((r) => r.width > 0).map((r) => [r.left - 6, r.top - 6, r.right + 6, r.bottom + 6]);
    }
    return chrome;
  }

  // Labels first measured in a fallback font are measured again once the real fonts are in
  document.fonts?.ready.then(() => scene.traverse((o) => { if (o.isCSS2DObject) delete o.userData.size; }));

  // Planet names: the one you point at first, then by how much you played the song
  const planetTags = () => {
    const lit = (p) => p.userData.tag.element.classList.contains("lit");
    return system.byRank.slice().sort((a, b) => lit(b) - lit(a)).map((p) => p.userData.tag);
  };

  // The overview's labels: the milestones and breaks, the star you point at, the names of your most played
  // artists, the months or years along the arm, then other stars' names. A star's name shows for your most
  // played artists and for any star that looks as big as theirs do in the overview, so more names appear
  // as you come closer. (Pointing at a star whose name isn't shown doesn't add it: the tooltip names it.)
  let nameSize = Infinity; // in pixels, set with the overview's distance
  const pixelsPerUnit = () => window.innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  function overviewLabels() {
    const top = NAMED_STARS[phone.matches ? 1 : 0];
    const scale = pixelsPerUnit();
    const lit = [], major = [], minor = [];
    for (const info of starInfo) {
      const { name } = info;
      labelAt.copy(info.position).applyMatrix4(camera.matrixWorldInverse);
      const pixels = labelAt.z < 0 ? (info.size * scale) / -labelAt.z : 0;
      if (info.index >= top && pixels < nameSize) name.element.classList.add("crowded");
      else if (name.element.classList.contains("lit")) lit.push(name);
      else (info.index < top ? major : minor).push(name);
    }
    return [...keyLabels, ...lit, ...major, ...tickLabels, ...minor];
  }
  function showOverviewLabels(on) { // hidden while you visit a star
    for (const l of timeLabels) l.visible = on;
    for (const info of starInfo) info.name.visible = on && namesOn;
  }

  // Names on or off (N): star names in the overview and planet names in a system, remembered for next time
  let namesOn = ui.settings.get("names") !== "off";
  showOverviewLabels(true);
  function toggleNames() {
    namesOn = !namesOn;
    ui.settings.set("names", namesOn ? "on" : "off");
    ui.setNamesButton(namesOn);
    showOverviewLabels(!system);
    for (const planet of system?.byRank ?? []) {
      planet.userData.tag.visible = planet.userData.tag.element.classList.contains("lit") || (planet.userData.named && namesOn);
    }
  }
  // Songs from the one-year history have no Spotify id, so those open a search for them instead
  const openSong = (song, artist) => window.open(/^[0-9A-Za-z]{22}$/.test(song.id)
    ? `https://open.spotify.com/track/${song.id}`
    : `https://open.spotify.com/search/${encodeURIComponent(`${artist.name} ${song.name}`)}`, "_blank", "noopener");
  const colorOf = (song) => system?.colors.get(song) ?? BELT_COLOR; // a song's planet color; the belt's for the rest

  // The song you clicked, on a planet, an asteroid or in the list: its planet stays big and named, and the
  // panel shows its card
  let selected = null;
  function selectSong(song) {
    const previous = selected;
    selected = song;
    if (previous && previous !== song) highlightSong(previous, false);
    highlightSong(song, true);
    setAddress(addressOf(system.info, song), true); // the song refines the star's address, so Back skips it
    ui.announce(`${song.name}, ${ui.format.count(song.plays, "play")}`);
    ui.showSong(song, system.info.artist, { ago: daysAgo, colorOf, onPlay: (s) => openSong(s, system.info.artist), onClear: clearSong });
  }
  function clearSong() {
    if (!selected) return;
    const song = selected;
    selected = null;
    highlightSong(song, false);
    ui.clearSong();
    if (system) setAddress(addressOf(system.info), true);
  }

  // ---------- moving around ----------

  let flight = null;

  // A viewing angle from slightly above, keeping the direction you're looking from
  function niceDirection() {
    const flat = camera.position.clone().sub(controls.target).setY(0);
    if (flat.lengthSq() < 1e-6) flat.set(0, 0, 1);
    return flat.normalize().multiplyScalar(0.75).add(new THREE.Vector3(0, 0.62, 0)).normalize();
  }

  // ---------- framing: fit what you look at into the part of the window that's free ----------

  // Free means below the top bar and above the time strip at the bottom, and while you visit a star, left of
  // the artist panel (or above it on phones, where it's a sheet at the bottom)
  function measureInsets(visiting) {
    const bar = [...document.getElementById("topbar").children].map((c) => c.getBoundingClientRect()).filter((r) => r.height > 0);
    const free = { left: 0, top: Math.max(0, ...bar.map((r) => r.bottom)) + 8, right: 0, bottom: 0 };
    for (const id of ["scrubber", "story"]) { // the time strip, and the story's caption while it's told
      const box = document.getElementById(id).getBoundingClientRect();
      if (box.height) free.bottom = Math.max(free.bottom, window.innerHeight - box.top + 8);
    }
    const panel = document.getElementById("panel");
    if (visiting && !panel.hidden) { // (offsetTop and offsetLeft leave out the panel's slide-in)
      if (phone.matches) free.bottom = window.innerHeight - panel.offsetTop + 8;
      else free.right = window.innerWidth - panel.offsetLeft + 20;
    }
    return free;
  }
  let insets = measureInsets(false);

  // How far from target, looking along dir, the camera has to be for every point to show inside the free
  // part of the window (or of view: a picture of another size), with a margin, plus half its size in pixels
  // for a label
  const fitter = new THREE.PerspectiveCamera(camera.fov, 1, camera.near, camera.far);
  const fitAt = new THREE.Vector3();
  function fitDistance(points, target, dir, free, margin = 20, view = { width: window.innerWidth, height: window.innerHeight }) {
    const width = view.width - free.left - free.right, height = view.height - free.top - free.bottom;
    // the camera's own lens, cropped to the free part of the window
    fitter.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (height / view.height)));
    fitter.aspect = width / height;
    fitter.updateProjectionMatrix();
    const fits = (distance) => {
      fitter.position.copy(target).addScaledVector(dir, distance);
      fitter.lookAt(target);
      fitter.updateMatrixWorld();
      return points.every(({ p, padX = 0, padY = 0 }) => {
        fitAt.copy(p).project(fitter);
        return fitAt.z < 1 && Math.abs(fitAt.x) <= 1 - (2 * (margin + padX)) / width && Math.abs(fitAt.y) <= 1 - (2 * (margin + padY)) / height;
      });
    };
    let near = camera.near, far = controls.maxDistance * 2;
    for (let i = 0; i < 30; i++) {
      const middle = (near + far) / 2;
      if (fits(middle)) far = middle;
      else near = middle;
    }
    return far;
  }

  // The overview fits the arm out to its time labels, and the "Today" and "First play" labels. On narrow
  // screens that can be further away than you could zoom out yourself, so the limit moves out with it.
  const armEdge = Array.from({ length: 97 }, (_, i) => ({ p: onArm(i / 96, 1.35) }));
  const labelPoint = (l) => ({ p: l.position, padX: (l.element.offsetWidth || 90) / 2, padY: (l.element.offsetHeight || 16) / 2 });
  function frameHome() {
    home.distance = fitDistance([...armEdge, labelPoint(milestones.today), labelPoint(milestones.first)], home.target, home.dir, measureInsets(false), 32);
    controls.maxDistance = Math.max(OUTER_RADIUS * 5, home.distance * 1.5);
    // a little bigger than the last always-named star in the overview, so other names wait until you come closer
    nameSize = (1.4 * starInfo[Math.min(NAMED_STARS[phone.matches ? 1 : 0], starInfo.length) - 1].size * pixelsPerUnit()) / home.distance;
  }

  // When the window changes size, the view you were flown to keeps fitting, unless you've moved the camera since
  let userMoved = false;
  controls.addEventListener("start", () => {
    userMoved = true;
    if (tour) endTour({ flyHome: false }); // you took the camera
  });
  function reframe() {
    insets = measureInsets(!!system);
    frameHome();
    // and not when there's hardly any room left, as with the artist sheet pulled all the way up on a phone
    if (userMoved || window.innerHeight - insets.top - insets.bottom < 120) return;
    const target = system ? system.info.position : home.target;
    const dir = flight ? flight.dir : camera.position.clone().sub(controls.target).normalize();
    const distance = system ? fitDistance(system.ring, target, dir, insets) : home.distance;
    if (flight) flight.distance = distance;
    else camera.position.copy(target).addScaledVector(dir, distance);
  }

  function flyTo(target, distance, dir = niceDirection(), seconds = 1.6, onArrive = null) {
    flight = { t: 0, seconds, target: target.clone(), distance, dir, onArrive, fromTarget: controls.target.clone(), fromCamera: camera.position.clone() };
    controls.enabled = false;
    controls.autoRotate = false;
  }

  // Closer or further along the line you're looking, around the same point. Pressing again before
  // the camera gets there carries on from where it was heading, so quick presses add up.
  function zoom(factor) {
    const target = flight ? flight.target : controls.target;
    const dir = flight ? flight.dir.clone() : camera.position.clone().sub(target).normalize();
    const from = flight ? flight.distance : camera.position.distanceTo(target);
    flyTo(target, THREE.MathUtils.clamp(from * factor, controls.minDistance, controls.maxDistance), dir, 0.45);
    userMoved = true;
  }

  // Back to the overview: leave the star you're visiting, or undo your own orbiting and zooming
  function showWholeGalaxy() {
    if (system) return goHome();
    userMoved = false;
    flyTo(home.target, home.distance, home.dir);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  function visit(info, { seconds = 1.6 } = {}) {
    if (tour) endTour({ flyHome: false });
    scrubber.release(); // the strip and the filter are for the overview
    recency.clear();
    closeSystem();
    system = openSystem(info);
    openClearing(info.position, system.extent + 6);
    showOverviewLabels(false);
    ui.showCrumb(info.artist.name, goHome);
    ui.setLegendMode("system");
    document.title = `${info.artist.name} · Aphelion`;
    ui.announce(`${info.artist.name}, number ${info.index + 1} of your artists. ${ui.format.hours(info.artist.hours)} listened. ` +
      "The left and right arrow keys go to the artist before and after along your timeline.");
    setAddress(addressOf(info));
    ui.openPanel(info.artist, data, {
      color: `#${info.color.getHexString()}`,
      ago: daysAgo,
      rank: info.index + 1, // stars come most listened first
      colorOf,
      timeline,
      onClose: goHome,
      onSheet: reframe, // on phones: the sheet changed height, so the system fits a different space
      onSongEnter: (song) => highlightSong(song, true),
      onSongLeave: (song) => highlightSong(song, false),
      onSongClick: selectSong,
      steps: [-1, 1].map((direction) => {
        const other = alongArm[alongArm.indexOf(info) + direction];
        return other && { name: other.artist.name, go: () => step(direction) };
      }),
    });
    insets = measureInsets(true); // with the panel open
    const dir = niceDirection();
    userMoved = false;
    flyTo(info.position, fitDistance(system.ring, info.position, dir, insets), dir, seconds);
    if (system.build) system.build.start = performance.now() + seconds * 550;
  }

  // The stars in the order of your timeline, from your first plays to today: the one before and after the
  // star you're visiting are a step away (the arrow keys, or the buttons at the bottom of the panel)
  const alongArm = [...starInfo].sort((a, b) => a.f - b.f);
  function step(direction) {
    const next = system && alongArm[alongArm.indexOf(system.info) + direction];
    if (next) visit(next, { seconds: 1.2 });
  }

  function leaveSystem() {
    closeSystem();
    document.title = "Aphelion";
    setAddress("#/");
    clearing.target = 0;
    showOverviewLabels(true);
    ui.hideCrumb();
    ui.setLegendMode("galaxy");
    ui.closePanel();
    insets = measureInsets(false);
  }

  function goHome() {
    leaveSystem();
    ui.announce("The whole galaxy");
    userMoved = false;
    flyTo(home.target, home.distance, home.dir);
  }

  // A speck of dust's card, at a point on the screen
  function showDust(item, x, y, focus = false) {
    ui.card.show(item, {
      x, y, ago: daysAgo, focus,
      actions: [{ label: "Play the top song", icon: "play", iconAfter: "external", primary: true, onClick: () => openSong(item.artist.top_song, item.artist) }],
    });
  }

  // Fly to a speck of dust (found by searching) and open its card there
  function visitDust(index) {
    if (system) leaveSystem();
    userMoved = true; // a view of its own, not one to keep fitted
    const position = dustPositions[index];
    flyTo(position, 70, niceDirection(), 1.6, () => {
      const p = position.clone().project(camera);
      showDust({ kind: "dust", artist: data.dust[index] }, ((p.x + 1) / 2) * window.innerWidth, ((1 - p.y) / 2) * window.innerHeight, true);
    });
  }

  // ---------- addresses ----------

  // Every star has an address (#/artist/Drake), and so does a selected song (#/artist/Drake/song/<id>), so the
  // Back button, reloading the page and links you keep or share take you back to it
  const addressOf = (info, song) => `#/artist/${encodeURIComponent(info.artist.name)}${song ? `/song/${song.id}` : ""}`;
  let following = false; // while going where an address says, which shouldn't add to the history again
  function setAddress(hash, replace = false) {
    if (following || location.hash === hash) return;
    history[replace ? "replaceState" : "pushState"](null, "", hash);
  }
  function follow(hash) {
    following = true;
    try {
      const [, name, songId] = /^#\/artist\/([^/]+)(?:\/song\/([^/]+))?$/.exec(hash) ?? [];
      const info = name && starInfo.find((s) => s.artist.name === decodeURIComponent(name));
      if (!info) {
        if (name) {
          ui.toast(`${decodeURIComponent(name)} isn't one of the stars in your galaxy`);
          history.replaceState(null, "", "#/");
        }
        if (system) goHome();
        return;
      }
      if (system?.info !== info) visit(info);
      const song = songId && info.artist.songs.find((s) => s.id === songId);
      if (song) selectSong(song);
      else clearSong();
    } finally {
      following = false;
    }
  }
  window.addEventListener("popstate", () => follow(location.hash));

  ui.setupControls({ onHome: showWholeGalaxy, onZoom: zoom, onNames: toggleNames, onFullscreen: toggleFullscreen, names: namesOn });
  const keys = {
    Escape: () => (tour ? endTour() : ui.card.isOpen ? ui.card.hide() : selected ? clearSong() : system ? goHome()
      : recency.active ? recency.clear() : scrubber.release()), // one step back at a time
    h: showWholeGalaxy,
    "+": () => zoom(0.7), "=": () => zoom(0.7),
    "-": () => zoom(1 / 0.7), _: () => zoom(1 / 0.7),
    n: toggleNames,
    ArrowLeft: () => step(-1),
    ArrowRight: () => step(1),
    f: toggleFullscreen,
  };
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.("input, textarea, [contenteditable]")) return;
    const action = keys[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (action) {
      e.preventDefault();
      action();
    }
  });

  // ---------- pointing at things ----------

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const projected = new THREE.Vector3();

  function screenDistance(position, x, y) {
    projected.copy(position).project(camera);
    if (projected.z > 1) return null; // behind the camera
    return Math.hypot(((projected.x + 1) / 2) * window.innerWidth - x, ((1 - projected.y) / 2) * window.innerHeight - y);
  }

  function pick(x, y) {
    // Planets and asteroids of the star you're visiting
    if (system) {
      pointer.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(system.targets, false)[0];
      if (hit) {
        const d = hit.object.userData;
        return hit.object.isInstancedMesh ? { kind: "song", song: d.songs[hit.instanceId], artist: d.artist, asteroid: true } : { ...d, planet: hit.object };
      }
    }
    // Stars and dust are tiny from far away, so pick them on screen with a minimum size
    const pixelsPerUnit = window.innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    let best = null, bestScore = Infinity;
    for (const info of starInfo) {
      if (system && info !== system.info && inClearing(info.position)) continue; // faded away around the visited star
      const d = screenDistance(info.position, x, y);
      if (d === null) continue;
      const reach = Math.max(12, (info.size * 0.2 * pixelsPerUnit) / camera.position.distanceTo(info.position));
      if (d < reach && d / reach < bestScore) { best = info; bestScore = d / reach; }
    }
    if (best) return best;
    for (let i = 0; i < dustPositions.length; i++) {
      if (system && inClearing(dustPositions[i])) continue;
      const d = screenDistance(dustPositions[i], x, y);
      if (d !== null && d < 7 && d < bestScore) { best = { kind: "dust", artist: data.dust[i] }; bestScore = d; }
    }
    return best;
  }

  let hovered = null, hoverEra = null, pointerAt = null;
  renderer.domElement.addEventListener("pointermove", (e) => { pointerAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener("pointerleave", () => { pointerAt = null; });

  function setHovered(item) {
    if (hovered?.kind === "star") {
      setStarSize(hovered, 1);
      hovered.name.element.classList.remove("lit");
      if (!system && !timeFocus && !recency.active) setEmphasis(null);
    }
    if (hovered?.planet) highlightSong(hovered.song, false);
    if (hovered?.kind === "song") ui.highlightRow(hovered.song, false);
    if (hoverEra) { scene.remove(hoverEra); hoverEra.geometry.dispose(); hoverEra = null; }
    hovered = item;
    if (!item) {
      ui.tooltip.hide();
      renderer.domElement.style.cursor = "";
      return;
    }
    if (item.kind === "star") {
      setStarSize(item, 1.35);
      item.name.element.classList.add("lit");
      if (!system && !timeFocus && !recency.active) setEmphasis((info) => (info === item ? 1 : 0)); // the rest of the galaxy steps back
      if (system?.info !== item) hoverEra = makeEra(item);
    }
    if (item.planet) highlightSong(item.song, true);
    if (item.kind === "song") ui.highlightRow(item.song, true);
    ui.tooltip.show(item, { ago: daysAgo, visiting: system?.info === item });
    renderer.domElement.style.cursor = "pointer";
  }

  function updateHover() { // once per frame, not on every mouse event
    const item = pointerAt && !flight && !ui.card.isOpen ? pick(...pointerAt) : null; // no tooltips over an open card
    const key = (i) => i && (i.kind === "song" ? `song-${i.song.id}` : `${i.kind}-${i.artist.name}`);
    if (key(item) !== key(hovered)) setHovered(item);
    if (hovered && pointerAt) ui.tooltip.move(...pointerAt);
  }

  // A click (not a drag) visits a star, selects a song, or opens a card for a speck of dust
  let downAt = null;
  renderer.domElement.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener("pointerup", (e) => {
    const moved = downAt ? Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) : Infinity;
    if (moved >= 5 || flight) return;
    const item = pick(e.clientX, e.clientY);
    if (!item) return;
    setHovered(null);
    if (item.kind === "star" && system?.info !== item) {
      // With a finger there's no pointing without touching, so the first tap shows what the star is, and
      // its Visit button, or a second tap on it, flies in
      if (e.pointerType === "touch" && !ui.card.justShowed(item)) {
        ui.card.show(item, {
          x: e.clientX, y: e.clientY, ago: daysAgo,
          actions: [{ label: "Visit", iconAfter: "right", primary: true, onClick: () => visit(item) }],
        });
      } else visit(item);
    }
    else if (item.kind === "song") selectSong(item.song);
    else if (item.kind === "dust") showDust(item, e.clientX, e.clientY);
  });

  // ---------- one month at a time ----------

  // The time strip lights up the stars of one month (and the dust of artists you knew then), and marks the
  // month on the arm with a glow and a faint beam
  let timeFocus = false;
  const monthsOf = new Map(starInfo.map((info) => [info, new Set(info.artist.months.map(([m]) => m))]));
  const playsIn = new Map(data.months);
  const topIn = new Map(); // month -> [the artist you played most, how often]
  for (const info of starInfo) {
    for (const [m, n] of info.artist.months) if ((topIn.get(m)?.[1] ?? 0) < n) topIn.set(m, [info.artist.name, n]);
  }
  const monthMarker = new THREE.Group();
  monthMarker.add(makePoints({ positions: [0, 0, 0], tints: [0.5, 0.72, 1], sizes: [26] }, sunGlow));
  monthMarker.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -3, 0), new THREE.Vector3(0, 32, 0)]),
    new THREE.LineBasicMaterial({ color: "#9fd4ff", transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }),
  ));
  monthMarker.visible = false;
  scene.add(monthMarker);
  const scrubber = setupScrubber({
    timeline, data,
    colorAt: (time) => `#${heatColor(daysAgo(time)).getHexString()}`,
    describe: (m) => [
      ui.format.month(ui.monthStart(m)),
      playsIn.has(m) ? ui.format.count(playsIn.get(m), "play") : "no plays",
      topIn.has(m) && `most played: ${topIn.get(m)[0]}`,
    ].filter(Boolean).join(" · "),
    onChange(m) {
      if (m !== null) recency.clear({ quiet: true }); // one way of picking stars at a time
      timeFocus = m !== null;
      monthMarker.visible = timeFocus;
      if (!timeFocus) return setEmphasis(null);
      const start = ui.monthStart(m), end = ui.monthStart(m + 1);
      setEmphasis((info) => (monthsOf.get(info).has(m) ? 1 : 0), (artist) => (artist.first < end && artist.last >= start ? 1 : 0));
      monthMarker.position.copy(onArm(frac(start + 15 * DAY)));
    },
  });

  // ---------- by when you last played them ----------

  // Brushing the legend's color bar (or a preset under it) lights the artists you last played that long ago
  const recency = setupRecency({
    longest: HEAT.at(-1)[0],
    count: (a, b) => [...data.stars, ...data.dust].filter((artist) => { const d = daysAgo(artist.last); return d >= a && d < b; }).length,
    onChange(a, b) {
      if (a === undefined || a === null) return setEmphasis(null);
      scrubber.release();
      const lit = (artist) => { const d = daysAgo(artist.last); return d >= a && d < b ? 1 : 0; };
      setEmphasis((info) => lit(info.artist), lit);
    },
  });

  // ---------- your story ----------

  // Your listening life told in chapters, flying along the arm: an opening, each stretch of months you
  // listened (a year at a time when it's longer) with the artists you played most then, each long break,
  // and today. The time strip steps through each chapter's months as it's told.
  const monthName = (m) => new Date(ui.monthStart(m) * 1000).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const yearOf = (m) => Math.floor(m / 12);
  const spanText = (a, b) => (a === b ? ui.format.month(ui.monthStart(a))
    : yearOf(a) === yearOf(b) ? `${monthName(a)} – ${ui.format.month(ui.monthStart(b))}`
      : `${ui.format.month(ui.monthStart(a))} – ${ui.format.month(ui.monthStart(b))}`);
  const playsBetween = (months, a, b) => months.filter(([m]) => m >= a && m <= b).reduce((sum, [, n]) => sum + n, 0);

  function storySteps() {
    const first = ui.monthNumber(data.start), last = ui.monthNumber(data.end);
    const pieces = []; // [from, to] stretches you listened, and the breaks between them
    const addStretch = (a, b) => {
      if (b - a + 1 <= 12) return pieces.push([a, b]);
      for (let m = a; m <= b;) {
        const december = Math.min(b, m - (m % 12) + 11);
        pieces.push([m, december]);
        m = december + 1;
      }
    };
    let from = first;
    for (const gap of timeline.breaks) {
      if (gap.from > from) addStretch(from, gap.from - 1);
      pieces.push(gap);
      from = gap.to + 1;
    }
    if (from <= last) addStretch(from, last);

    const artists = data.stars.length + data.dust.length;
    const steps = [{
      eyebrow: "Your story", title: `${ui.format.month(data.start)} → today`, view: "home",
      meta: `${ui.format.count(artists, "artist")} · ${ui.format.count(data.plays, "play")} · ${ui.format.hours(data.hours)}`,
    }];
    pieces.forEach((piece, i) => {
      if (!Array.isArray(piece)) {
        steps.push({
          eyebrow: spanText(piece.from, piece.to), title: `${ui.format.duration(piece.to - piece.from + 1)} without plays`,
          meta: piece.to < last ? `Then, in ${ui.format.month(ui.monthStart(piece.to + 1))}, you came back` : "",
          span: [piece.from, piece.to], gap: true,
        });
        return;
      }
      const [a, b] = piece;
      const plays = playsBetween(data.months, a, b);
      const top = starInfo.map((info) => [info, playsBetween(info.artist.months, a, b)])
        .filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1]).slice(0, 3);
      const when = i === 0 ? " · where it began" : b === last ? " · now" : "";
      steps.push({
        eyebrow: spanText(a, b) + when,
        title: !top.length ? ui.format.count(plays, "play")
          : top[0][1] >= plays * 0.3 ? `${top[0][0].artist.name} on repeat` : `Mostly ${top[0][0].artist.name}`,
        meta: [ui.format.count(plays, "play"), ...top.map(([info, n]) => `${info.artist.name} ${n.toLocaleString("en-US")}`)].join(" · "),
        span: [a, b],
      });
    });
    steps.push({
      eyebrow: "Today", title: `${ui.format.count(artists, "artist")}, ${ui.format.hours(data.hours)}`,
      meta: "And it keeps growing as you listen", view: "home",
    });
    return steps;
  }

  // Where the camera goes for a step: the overview, or the stretch of arm the chapter covers, fitted into view
  function showStep(step) {
    const seconds = calm ? 0.001 : 2.2;
    if (step.view === "home") return flyTo(home.target, home.distance, home.dir, seconds);
    const [a, b] = step.span;
    const fa = frac(ui.monthStart(a)), fb = frac(ui.monthStart(b + 1));
    const points = [];
    for (let i = 0; i <= 24; i++) for (const side of [-1, 1.35]) points.push({ p: onArm(fa + ((fb - fa) * i) / 24, side) });
    const target = points.reduce((sum, { p }) => sum.add(p), new THREE.Vector3()).divideScalar(points.length);
    const dir = niceDirection();
    insets = measureInsets(false);
    flyTo(target, THREE.MathUtils.clamp(fitDistance(points, target, dir, insets, 40), 70, controls.maxDistance), dir, seconds);
  }

  let tour = null; // { steps, index, paused, timers }
  function startTour() {
    if (system) leaveSystem();
    ui.card.hide();
    tour = { steps: storySteps(), index: -1, paused: false, timers: [] };
    userMoved = true; // the story's views aren't ones to keep fitted
    nextStep();
  }
  function clearTimers() {
    for (const t of tour.timers) clearTimeout(t);
    tour.timers = [];
  }
  // Plays the current step: the time strip walks through the chapter's months, then the story moves on
  function playStep() {
    clearTimers();
    const step = tour.steps[tour.index];
    const hold = step.view ? 4500 : step.gap ? 5000 : 7000;
    if (step.gap) scrubber.set(step.span[0]);
    else if (step.span) {
      const months = data.months.map(([m]) => m).filter((m) => m >= step.span[0] && m <= step.span[1]);
      months.forEach((m, i) => tour.timers.push(setTimeout(() => scrubber.set(m), 400 + (i * (hold - 900)) / months.length)));
    } else scrubber.release();
    if (!tour.paused) tour.timers.push(setTimeout(nextStep, hold));
  }
  function nextStep() {
    if (tour.index + 1 >= tour.steps.length) return endTour();
    tour.index++;
    const step = tour.steps[tour.index];
    ui.story.show(step, [tour.index, tour.steps.length], {
      paused: tour.paused,
      onPause: () => {
        tour.paused = !tour.paused;
        ui.story.setPaused(tour.paused);
        if (tour.paused) clearTimers();
        else playStep();
      },
      onSkip: nextStep,
      onEnd: () => endTour(),
    });
    showStep(step);
    playStep();
  }
  function endTour({ flyHome = true } = {}) {
    if (!tour) return;
    clearTimers();
    tour = null;
    ui.story.hide();
    scrubber.release();
    insets = measureInsets(!!system);
    if (flyHome && !system) {
      userMoved = false;
      flyTo(home.target, home.distance, home.dir);
    }
  }
  ui.setupStoryButton(startTour);

  // ---------- a poster to share ----------

  // What you're looking at (the whole galaxy, or the star you're visiting) as a picture of the poster's size,
  // from the direction you're looking, framed to leave room for the poster's words above and below; and where
  // the names of the five brightest things in it go
  function renderPicture(width, height) {
    setHovered(null);
    const saved = { ratio: renderer.getPixelRatio(), position: camera.position.clone() };
    const free = { left: 0, right: 0, top: 190, bottom: 600 };
    const dir = camera.position.clone().sub(controls.target).normalize();
    const target = system ? system.info.position : home.target;
    const points = system ? system.ring : [...armEdge, labelPoint(milestones.today), labelPoint(milestones.first)];
    const distance = fitDistance(points, target, dir, free, 30, { width, height });

    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    composer.setPixelRatio(1);
    composer.setSize(width, height);
    camera.aspect = width / height;
    camera.setViewOffset(width, height, 0, (free.bottom - free.top) / 2, width, height);
    camera.position.copy(target).addScaledVector(dir, distance);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    const scale = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    for (const m of pointMaterials) m.uniforms.scale.value = scale;
    composer.render();
    const picture = document.createElement("canvas"); // copied right away, before the browser clears the frame
    picture.width = width;
    picture.height = height;
    picture.getContext("2d").drawImage(renderer.domElement, 0, 0);
    const named = system
      ? system.byRank.slice(0, 5).map((planet) => [planet.getWorldPosition(new THREE.Vector3()), planet.userData.song.name])
      : starInfo.slice(0, 5).map((info) => [info.position, info.artist.name]);
    const labels = named.map(([p, text]) => {
      const at = p.clone().project(camera);
      return { x: ((at.x + 1) / 2) * width, y: ((1 - at.y) / 2) * height + 20, text };
    });

    renderer.setPixelRatio(saved.ratio);
    resize(); // the window's sizes again
    camera.position.copy(saved.position);
    camera.lookAt(controls.target);
    return { picture, labels };
  }

  // The poster's words: your totals and top five artists, or the star's numbers and top five songs
  function posterCopy() {
    const artists = data.stars.length + data.dust.length;
    const eyebrow = `${ui.format.month(data.start)} → today`;
    if (system) {
      const { artist, index } = system.info;
      return {
        eyebrow, title: artist.name,
        subtitle: `#${index + 1} of ${artists.toLocaleString("en-US")} artists · ${ui.format.hours(artist.hours)} · ${ui.format.count(artist.plays, "play")}`,
        listTitle: "Top songs",
        list: artist.songs.slice(0, 5).map((song) => ({ name: song.name, value: ui.format.count(song.plays, "play"), color: colorOf(song) })),
      };
    }
    return {
      eyebrow, title: "My listening life",
      subtitle: `${ui.format.count(artists, "artist")} · ${ui.format.count(data.plays, "play")} · ${ui.format.hours(data.hours)}`,
      listTitle: "Top artists",
      list: starInfo.slice(0, 5).map((info) => ({
        name: info.artist.name, value: ui.format.hours(info.artist.hours), color: `#${heatColor(daysAgo(info.artist.last)).getHexString()}`,
      })),
    };
  }

  setupShare({
    async make(format) {
      const { picture, labels } = renderPicture(...FORMATS[format]);
      return composePoster(picture, labels, posterCopy());
    },
    filename: (format) => `aphelion-${system ? system.info.artist.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-") : "galaxy"}-${format}.png`,
  });
  setupUpload({ alone: false, uploaded: Boolean(uploaded) });

  // ---------- search ----------

  {
    const dot = (time) => `#${heatColor(daysAgo(time)).getHexString()}`; // colored by when you last played it
    const items = [
      ...starInfo.map((info) => ({
        group: "Artists", name: info.artist.name, meta: `${ui.format.hours(info.artist.hours)} · #${info.index + 1}`,
        color: dot(info.artist.last), weight: info.artist.hours, pick: () => visit(info),
      })),
      ...data.dust.map((artist, index) => ({
        group: "Artists", name: artist.name, meta: ui.format.count(artist.plays, "play"),
        color: dot(artist.last), weight: artist.hours, pick: () => visitDust(index),
      })),
      ...starInfo.flatMap((info) => info.artist.songs.map((song) => ({
        group: "Songs", name: song.name, meta: `${info.artist.name} · ${ui.format.count(song.plays, "play")}`,
        color: dot(song.last), weight: song.plays,
        pick: () => {
          if (system?.info !== info) visit(info);
          selectSong(song);
        },
      }))),
    ];
    setupSearch(items, items.slice(0, 6)); // until you type: your top six artists
  }

  // ---------- animation ----------

  // handy in the browser console, and for timing frames (composer.render)
  window.heavyRotation = { scene, camera, controls, renderer, composer, starInfo, isFlying: () => !!flight, visit, goHome };

  // Arrive from far away
  frameHome();
  if (calm) {
    camera.position.copy(home.dir).multiplyScalar(home.distance);
  } else {
    camera.position.copy(home.dir).applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.7).multiplyScalar(home.distance * 2.4);
    if (introduce) setTimeout(ui.reveal, 3800); // in case something else takes over the flight
    flyTo(home.target, home.distance, home.dir, 3.2, ui.reveal);
  }
  ui.setupHint(renderer.domElement);
  window.addEventListener("resize", reframe);
  if (location.hash.startsWith("#/artist/")) follow(location.hash); // a link to a star: arrive there instead

  // Shift the picture so what you look at sits in the middle of the free part of the window
  const viewShift = { x: 0, y: 0 };
  function updateViewShift(dt) {
    const wantedX = (insets.right - insets.left) / 2;
    const wantedY = (insets.bottom - insets.top) / 2;
    const k = Math.min(1, dt * 4);
    viewShift.x += (wantedX - viewShift.x) * k;
    viewShift.y += (wantedY - viewShift.y) * k;
    if (Math.abs(viewShift.x) + Math.abs(viewShift.y) < 0.5) camera.clearViewOffset();
    else camera.setViewOffset(window.innerWidth, window.innerHeight, viewShift.x, viewShift.y, window.innerWidth, window.innerHeight);
  }

  let lastFrame = performance.now(), firstFrame = true;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;
    if (!calm) stars.uniforms.time.value = now / 1000;
    for (const p of planets) p.pivot.rotation.y += p.speed * dt;
    const fade = calm ? 1 : Math.min(1, dt * 3);
    for (const c of clearings) c.zone.w += (c.target - c.zone.w) * fade;
    stars.uniforms.focus.value += (focusWanted - stars.uniforms.focus.value) * (calm ? 1 : Math.min(1, dt * 8));
    armLine.material.opacity += ((system ? 0 : ARM_LINE_OPACITY) - armLine.material.opacity) * fade; // it would cut through the system
    if (system) system.sun.material.uniforms.time.value = now / 1000;
    if (system?.build) buildSystem(now);

    if (flight) {
      flight.t = Math.min(flight.t + dt / flight.seconds, 1);
      const k = easeInOut(flight.t);
      controls.target.lerpVectors(flight.fromTarget, flight.target, k);
      camera.position.lerpVectors(flight.fromCamera, flight.target.clone().addScaledVector(flight.dir, flight.distance), k);
      if (flight.t === 1) {
        const { onArrive } = flight;
        flight = null;
        controls.enabled = true;
        onArrive?.();
      }
    }
    updateViewShift(dt);
    controls.update();
    updateHover();
    composer.render();
    declutter(system ? planetTags() : overviewLabels());
    labelRenderer.render(scene, camera);
    if (firstFrame) {
      firstFrame = false;
      reframe(); // now that the labels have been drawn and have their real size
      ui.doneLoading();
    }
  });
}

main();
