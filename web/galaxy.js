// Heavy Rotation: your listening timeline as a galaxy.
// The spiral arm is your listening life: your first play is in the center and today is at the tip.
// Each artist you've really listened to is one star, placed where you played them the most.
// Star size = time listened. Color = how recently you played them: blue = still playing, amber/red = left behind.
// Point at a star to see the months you played them as pulses along the arm. Click it to fly in:
// its songs become planets. Artists you played less are dust along the arm.
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

const TURNS = 2;                 // how many times the timeline winds around the center
const INNER_RADIUS = 20;         // where your first play is
const OUTER_RADIUS = 240;        // where today is
const ARM_WIDTH = [10, 34];      // width of the arm at the start and at today
const MAX_PLANETS = 30;          // an artist's most played songs become planets, the rest an asteroid belt
const PLANET_LABELS = 8;         // how many planets get a name tag (the rest on hover)
const ORBIT_SPEED = 0.5;
const BREAK_MONTHS = 4;          // this many empty months in a row count as a break in your listening
const BREAK_ROOM = 1.5;          // a whole break takes as much of the arm as 1.5 months you listened
const QUIET_MONTH_ROOM = 0.3;    // a single empty month takes 30% of the room
const DAY = 86400;
// Star color by days since you last played the artist: hot blue now, cooling through violet and pink to amber and red
const HEAT = [[0, "#72d0ff"], [21, "#8fa8ff"], [90, "#c49bff"], [270, "#ff9fc6"], [730, "#ffb778"], [1825, "#e0775a"]];
const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  let data;
  try {
    data = await (await fetch("galaxy.json")).json();
  } catch {
    ui.showMessage("Couldn't load galaxy.json. Start the galaxy with: python galaxy.py");
    return;
  }
  if (!data.stars?.length) {
    ui.showMessage("No plays yet. Run python galaxy.py again after listening to some music.");
    return;
  }
  ui.setupHeader(data);

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
  const pointMaterials = [stars, soft, clouds];

  // Deep space all around
  const space = new THREE.Mesh(new THREE.SphereGeometry(OUTER_RADIUS * 20, 48, 24), backgroundMaterial());
  space.renderOrder = -1;
  scene.add(space);
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
  {
    const line = [];
    for (let i = 0; i <= 800; i++) line.push(onArm(i / 800));
    scene.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(line),
      new THREE.LineBasicMaterial({ color: "#6d7fa8", transparent: true, opacity: 0.14, depthWrite: false }),
    ));

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
    scene.add(makePoints(dust, stars));
  }

  // Stars: one per artist you've really listened to
  const maxHours = Math.max(...data.stars.map((a) => a.hours), 0.01);
  const starInfo = data.stars.map((artist, index) => {
    const rand = seededRandom(artist.name);
    const side = (rand() * 2 - 1) * 0.85;
    const height = (rand() - 0.5) * 3;
    const position = onArm(frac(artist.peak + (rand() - 0.5) * 20 * DAY), side, height); // somewhere in the peak month
    const weight = Math.sqrt(artist.hours / maxHours);
    return {
      kind: "star", index, artist, side, height, position, weight,
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

  // Listening pulses: a soft dot for every month you played an artist, along their lane in the arm
  function makePulses(info) {
    const busiest = Math.max(...info.artist.months.map(([, n]) => n));
    const pulses = { positions: [], tints: [], sizes: [] };
    for (const [month, n] of info.artist.months) {
      const strength = Math.sqrt(n / busiest);
      const p = onArm(frac(ui.monthStart(month) + 15 * DAY), info.side, info.height);
      pulses.positions.push(p.x, p.y, p.z);
      const c = info.color.clone().multiplyScalar((0.25 + 0.75 * strength) * info.shine);
      pulses.tints.push(c.r, c.g, c.b);
      pulses.sizes.push(2 + 5 * strength);
    }
    const points = makePoints(pulses, soft);
    scene.add(points);
    return points;
  }

  // Time along the arm: years, or every 3 months when you've listened for 2 years or less.
  // Breaks get their own label saying how long they were, plus the month you started listening again.
  const timeLabels = [];
  {
    const short = timeline.activeMonths <= 24;
    const labelled = new Set();
    const addTime = (month, text) => {
      if (labelled.has(month)) return;
      labelled.add(month);
      const l = label([text], "time");
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
      const gap = label([`${ui.format.duration(b.to - b.from + 1)} without plays`], "gap");
      gap.position.copy(onArm(frac(middle), 1.35));
      timeLabels.push(gap);
      if (b.to < ui.monthNumber(data.end)) addTime(b.to + 1, ui.format.month(ui.monthStart(b.to + 1)));
    }
    const first = label([`First play · ${ui.format.month(data.start)}`], "milestone");
    first.position.copy(onArm(0, 0, 5));
    const dot = document.createElement("span");
    dot.className = "pulse";
    const today = label([dot, "Today"], "milestone today");
    today.position.copy(onArm(1, 0, 5));
    timeLabels.push(first, today);
    scene.add(...timeLabels);
  }

  // Smooth edges, and one tone-mapping step for everything so glows stay soft
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
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

  function openSystem(info) {
    const { artist } = info;
    const group = new THREE.Group();
    group.position.copy(info.position);
    scene.add(group);
    const rand = seededRandom(`system-${artist.name}`);

    const sunRadius = 0.9 + 2.6 * info.weight;
    const sun = new THREE.Mesh(new THREE.SphereGeometry(sunRadius, 64, 32), sunMaterial(info.color.clone()));
    group.add(sun);

    const orbits = new THREE.Group();
    orbits.rotation.x = (rand() - 0.5) * 0.3;
    group.add(orbits);

    const planetSongs = artist.songs.slice(0, MAX_PLANETS).sort((a, b) => a.first - b.first); // inner = found first
    const maxPlays = Math.max(...planetSongs.map((s) => s.plays));
    const named = new Set(artist.songs.slice(0, PLANET_LABELS));
    const targets = [], meshes = new Map();
    let orbit = sunRadius * 1.8 + 0.8, previous = 0;
    for (const song of planetSongs) {
      const size = 0.35 + 1.0 * Math.sqrt(song.plays / maxPlays);
      orbit += previous + size + 0.6;
      previous = size;
      const ring = new THREE.EllipseCurve(0, 0, orbit, orbit).getPoints(160).map((p) => new THREE.Vector3(p.x, 0, p.y));
      orbits.add(new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(ring),
        new THREE.LineBasicMaterial({ color: info.color, transparent: true, opacity: 0.07, depthWrite: false }),
      ));
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
      planet.userData = { kind: "song", song, artist, size };
      planet.add(new THREE.Mesh(new THREE.SphereGeometry(size * 1.07, 48, 24), atmosphereMaterial(color.clone().offsetHSL(0, 0.1, 0.1), info.position.clone())));
      pivot.add(planet);
      planets.push({ pivot, speed: ORBIT_SPEED / Math.pow(orbit, 0.9) });
      targets.push(planet);
      meshes.set(song, planet);
      const tag = label([song.name], "planet");
      tag.position.set(0, size + 0.35, 0);
      tag.visible = named.has(song);
      planet.add(tag);
      planet.userData.tag = tag;
      planet.userData.named = named.has(song);
    }

    // Songs you played less: an asteroid belt
    let extent = orbit + previous;
    const beltSongs = artist.songs.slice(MAX_PLANETS);
    if (beltSongs.length) {
      const beltRadius = orbit + previous + 2;
      const belt = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(1, 0),
        new THREE.MeshStandardMaterial({ color: "#8d8479", roughness: 1, flatShading: true }),
        beltSongs.length,
      );
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
      beltSongs.forEach((song, i) => {
        const angle = (i / beltSongs.length) * Math.PI * 2 + rand() * 0.3;
        const r = beltRadius + (rand() - 0.5) * 1.6;
        p.set(Math.cos(angle) * r, (rand() - 0.5) * 0.5, Math.sin(angle) * r);
        q.setFromEuler(new THREE.Euler(rand() * 6, rand() * 6, rand() * 6));
        const size = 0.12 + 0.05 * Math.sqrt(song.plays);
        s.set(size * (0.8 + rand() * 0.5), size * (0.6 + rand() * 0.4), size);
        belt.setMatrixAt(i, m.compose(p, q, s));
      });
      belt.userData = { kind: "belt", songs: beltSongs, artist };
      orbits.add(belt);
      planets.push({ pivot: belt, speed: (ORBIT_SPEED * 0.4) / Math.sqrt(beltRadius) });
      targets.push(belt);
      extent = beltRadius + 1;
    }
    sunlight.position.copy(info.position);
    return { info, group, sun, targets, meshes, extent, pulses: makePulses(info) };
  }

  function closeSystem() {
    if (!system) return;
    scene.remove(system.group, system.pulses);
    dispose(system.group);
    system.pulses.geometry.dispose(); // its material is shared, so keep that
    planets.length = 0;
    system = null;
  }

  // Highlight a planet when you point at its song in the panel
  function highlightSong(song, on) {
    const planet = system?.meshes.get(song);
    if (!planet) return;
    planet.scale.setScalar(on ? 1.25 : 1);
    planet.userData.tag.visible = on || planet.userData.named;
    planet.userData.tag.element.classList.toggle("lit", on);
  }
  const openSong = (id) => window.open(`https://open.spotify.com/track/${id}`, "_blank", "noopener");

  // ---------- moving around ----------

  let flight = null;

  // A viewing angle from slightly above, keeping the direction you're looking from
  function niceDirection() {
    const flat = camera.position.clone().sub(controls.target).setY(0);
    if (flat.lengthSq() < 1e-6) flat.set(0, 0, 1);
    return flat.normalize().multiplyScalar(0.75).add(new THREE.Vector3(0, 0.62, 0)).normalize();
  }

  // Narrow (portrait) windows need to step back further to fit the same things in
  const fit = (distance) => distance * Math.max(1, 1.25 / camera.aspect);

  function flyTo(target, distance, dir = niceDirection(), seconds = 1.6) {
    distance = fit(distance);
    flight = { t: 0, seconds, target: target.clone(), distance, dir, fromTarget: controls.target.clone(), fromCamera: camera.position.clone() };
    controls.enabled = false;
    controls.autoRotate = false;
  }

  function visit(info) {
    closeSystem();
    system = openSystem(info);
    for (const l of timeLabels) l.visible = false;
    flyTo(info.position, system.extent * 1.7 + 4);
    ui.showCrumb(info.artist.name, goHome);
    ui.openPanel(info.artist, data, {
      color: `#${info.color.getHexString()}`,
      ago: daysAgo,
      onClose: goHome,
      onSongEnter: (song) => highlightSong(song, true),
      onSongLeave: (song) => highlightSong(song, false),
      onSongClick: (song) => openSong(song.id),
    });
  }

  function goHome() {
    closeSystem();
    for (const l of timeLabels) l.visible = true;
    flyTo(home.target, home.distance, home.dir);
    ui.hideCrumb();
    ui.closePanel();
  }
  window.addEventListener("keydown", (e) => { if (e.key === "Escape" && system) goHome(); });

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
      const d = screenDistance(info.position, x, y);
      if (d === null) continue;
      const reach = Math.max(12, (info.size * 0.2 * pixelsPerUnit) / camera.position.distanceTo(info.position));
      if (d < reach && d / reach < bestScore) { best = info; bestScore = d / reach; }
    }
    if (best) return best;
    for (let i = 0; i < dustPositions.length; i++) {
      const d = screenDistance(dustPositions[i], x, y);
      if (d !== null && d < 7 && d < bestScore) { best = { kind: "dust", artist: data.dust[i] }; bestScore = d; }
    }
    return best;
  }

  let hovered = null, hoverPulses = null, pointerAt = null;
  renderer.domElement.addEventListener("pointermove", (e) => { pointerAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener("pointerleave", () => { pointerAt = null; });

  function setHovered(item) {
    if (hovered?.kind === "star") setStarSize(hovered, 1);
    if (hovered?.planet) highlightSong(hovered.song, false);
    if (hoverPulses) { scene.remove(hoverPulses); hoverPulses.geometry.dispose(); hoverPulses = null; }
    hovered = item;
    if (!item) {
      ui.tooltip.hide();
      renderer.domElement.style.cursor = "";
      return;
    }
    if (item.kind === "star") {
      setStarSize(item, 1.35);
      if (system?.info !== item) hoverPulses = makePulses(item);
    }
    if (item.planet) highlightSong(item.song, true);
    ui.tooltip.show(item, { ago: daysAgo, visiting: system?.info === item });
    renderer.domElement.style.cursor = "pointer";
  }

  function updateHover() { // once per frame, not on every mouse event
    const item = pointerAt && !flight ? pick(...pointerAt) : null;
    const key = (i) => i && (i.kind === "song" ? `song-${i.song.id}` : `${i.kind}-${i.artist.name}`);
    if (key(item) !== key(hovered)) setHovered(item);
    if (hovered && pointerAt) ui.tooltip.move(...pointerAt);
  }

  // A click (not a drag) visits a star or opens a song in Spotify
  let downAt = null;
  renderer.domElement.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener("pointerup", (e) => {
    const moved = downAt ? Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) : Infinity;
    if (moved >= 5 || flight) return;
    const item = pick(e.clientX, e.clientY);
    if (!item) return;
    setHovered(null);
    if (item.kind === "star" && system?.info !== item) visit(item);
    else if (item.kind === "song") openSong(item.song.id);
    else if (item.kind === "dust") openSong(item.artist.top_song.id);
  });

  // ---------- animation ----------

  window.heavyRotation = { scene, camera, controls, starInfo, isFlying: () => !!flight, visit, goHome }; // handy in the browser console

  // Arrive from far away
  if (calm) {
    camera.position.copy(home.dir).multiplyScalar(fit(home.distance));
  } else {
    camera.position.copy(home.dir).applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.7).multiplyScalar(fit(home.distance) * 2.4);
    flyTo(home.target, home.distance, home.dir, 3.2);
  }
  ui.setupHint(renderer.domElement);

  // While the artist panel is open, shift the picture so the system sits in the free space:
  // left of the panel on wide screens, above it on phones (where the panel is a bottom sheet)
  const viewShift = { x: 0, y: 0 };
  function updateViewShift(dt) {
    const wide = window.innerWidth > 760;
    const wantedX = system && wide ? 180 : 0;
    const wantedY = system && !wide ? window.innerHeight * 0.22 : 0;
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
    if (system) system.sun.material.uniforms.time.value = now / 1000;

    if (flight) {
      flight.t = Math.min(flight.t + dt / flight.seconds, 1);
      const k = easeInOut(flight.t);
      controls.target.lerpVectors(flight.fromTarget, flight.target, k);
      camera.position.lerpVectors(flight.fromCamera, flight.target.clone().addScaledVector(flight.dir, flight.distance), k);
      if (flight.t === 1) {
        flight = null;
        controls.enabled = true;
      }
    }
    updateViewShift(dt);
    controls.update();
    updateHover();
    composer.render();
    labelRenderer.render(scene, camera);
    if (firstFrame) {
      firstFrame = false;
      ui.doneLoading();
    }
  });
}

main();
