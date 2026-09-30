// Shaders and materials for Heavy Rotation.
// Colors are linear; the OutputPass in galaxy.js tone-maps everything once and turns it into screen colors,
// which keeps overlapping glows soft instead of blowing out to white.
import * as THREE from "three";

// Size in world units -> pixels, shared by all glowing points. Faint below 2px instead of flickering,
// and (with nearFade) dimmer when very close to the camera, so nearby dust doesn't turn into big bright blobs.
const pointVertex = /* glsl */ `
  attribute float size;
  attribute vec3 tint;
  attribute float seed;
  attribute float spike;
  uniform float scale;
  uniform float nearFade;
  varying vec3 vTint;
  varying float vSeed;
  varying float vSpike;
  varying float vFade;
  void main() {
    vTint = tint;
    vSeed = seed;
    vSpike = spike;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float pixels = size * scale / -mvPosition.z;
    vFade = clamp(pixels / 2.0, 0.0, 1.0) * mix(1.0, clamp(120.0 / pixels, 0.2, 1.0), nearFade);
    gl_PointSize = clamp(pixels, 2.0, 600.0);
    gl_Position = projectionMatrix * mvPosition;
  }`;

function pointsMaterial(fragmentShader, extraUniforms = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { scale: { value: 1 }, time: { value: 0 }, nearFade: { value: 1 }, ...extraUniforms },
    vertexShader: pointVertex,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// Stars: a small bright core, a soft glow, and faint cross spikes on the biggest ones (spike 0-1).
// seed (0-1) makes each star twinkle at its own pace.
export function starMaterial() {
  return pointsMaterial(/* glsl */ `
    uniform float time;
    varying vec3 vTint;
    varying float vSeed;
    varying float vSpike;
    varying float vFade;
    void main() {
      vec2 uv = gl_PointCoord * 2.0 - 1.0;
      float r = length(uv);
      if (r > 1.0) discard;
      float phase = vSeed;
      float core = exp(-r * r * 70.0);
      float glow = exp(-r * 5.0) * (1.0 - r);
      float spikes = (exp(-abs(uv.x) * 40.0) + exp(-abs(uv.y) * 40.0)) * pow(1.0 - r, 4.0) * vSpike;
      float twinkle = 1.0 + 0.04 * sin(time * (0.5 + phase) + phase * 40.0);
      vec3 coreColor = mix(vTint, vec3(1.0), 0.4);
      vec3 color = (coreColor * core * 1.15 + vTint * glow * 0.5 + vTint * spikes * 0.3) * twinkle * vFade;
      gl_FragColor = vec4(color, 1.0);
    }`);
}

// Soft round glow: dust, background stars, listening pulses
export function softMaterial() {
  return pointsMaterial(/* glsl */ `
    varying vec3 vTint;
    varying float vFade;
    void main() {
      float r = length(gl_PointCoord * 2.0 - 1.0);
      if (r > 1.0) discard;
      float g = exp(-r * r * 5.0) * (1.0 - r);
      gl_FragColor = vec4(vTint * g * vFade, 1.0);
    }`);
}

// Gas clouds: a cloud texture, turned differently for each cloud
export function cloudMaterial(texture) {
  return pointsMaterial(/* glsl */ `
    uniform sampler2D map;
    varying vec3 vTint;
    varying float vSeed;
    void main() {
      float a = vSeed * 6.2831;
      vec2 uv = mat2(cos(a), -sin(a), sin(a), cos(a)) * (gl_PointCoord - 0.5) + 0.5;
      gl_FragColor = vec4(vTint * texture2D(map, uv).a, 1.0);
    }`, { map: { value: texture }, nearFade: { value: 0 } }); // clouds are meant to be big
}

export function makePoints({ positions, tints, sizes, seeds, spikes }, material) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("tint", new THREE.Float32BufferAttribute(tints, 3));
  geometry.setAttribute("size", new THREE.Float32BufferAttribute(sizes, 1));
  const zeros = () => new Array(sizes.length).fill(0);
  geometry.setAttribute("seed", new THREE.Float32BufferAttribute(seeds ?? zeros(), 1));
  geometry.setAttribute("spike", new THREE.Float32BufferAttribute(spikes ?? zeros(), 1));
  return new THREE.Points(geometry, material);
}

// A soft, lumpy cloud drawn from many blurry blobs (white with varying alpha; the shader colors it)
export function cloudTexture(rand) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 70; i++) {
    const angle = rand() * Math.PI * 2;
    const dist = Math.pow(rand(), 0.7) * size * 0.3;
    const x = size / 2 + Math.cos(angle) * dist;
    const y = size / 2 + Math.sin(angle) * dist;
    const r = size * (0.06 + rand() * 0.16);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${0.05 + rand() * 0.06})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  // fade out towards the edge so the square never shows
  ctx.globalCompositeOperation = "destination-in";
  const edge = ctx.createRadialGradient(size / 2, size / 2, size * 0.2, size / 2, size / 2, size / 2);
  edge.addColorStop(0, "rgba(0,0,0,1)");
  edge.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// 3D value noise, shared by the background and the sun
const noise = /* glsl */ `
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float sum = 0.0, amp = 0.5;
    for (int i = 0; i < 5; i++) { sum += amp * noise(p); p *= 2.03; amp *= 0.5; }
    return sum;
  }`;

// Deep blue space with faint purple and teal nebulae, drawn on a huge sphere around everything
export function backgroundMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      ${noise}
      void main() {
        vec3 d = normalize(vDir);
        float a = fbm(d * 1.7 + 3.1);
        float b = fbm(d * 3.1 - 7.3);
        vec3 color = vec3(0.004, 0.006, 0.014)
          + vec3(0.030, 0.016, 0.052) * smoothstep(0.42, 0.85, a)
          + vec3(0.008, 0.030, 0.042) * smoothstep(0.48, 0.9, b);
        gl_FragColor = vec4(color, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  });
}

// A sun with a slowly moving, grainy surface that gets darker towards its edge
export function sunMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, tint: { value: color } },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vPos;
      void main() {
        vPos = position;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
      }`,
    fragmentShader: /* glsl */ `
      uniform float time;
      uniform vec3 tint;
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vPos;
      ${noise}
      void main() {
        float facing = max(dot(normalize(vNormal), normalize(vView)), 0.0);
        float grain = fbm(normalize(vPos) * 4.0 + vec3(time * 0.05));
        vec3 color = mix(tint, vec3(1.0), 0.25) * (0.75 + 0.5 * grain) * (0.35 + 0.65 * pow(facing, 0.6)) * 1.3;
        gl_FragColor = vec4(color, 1.0);
      }`,
  });
}

// A thin glowing edge around planets, brighter on the side facing the sun
export function atmosphereMaterial(color, sunPosition) {
  return new THREE.ShaderMaterial({
    uniforms: { tint: { value: color }, sun: { value: sunPosition } },
    vertexShader: /* glsl */ `
      uniform vec3 sun;
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vToSun;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mvPosition.xyz);
        vToSun = normalize((viewMatrix * vec4(sun, 1.0)).xyz - mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 tint;
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vToSun;
      void main() {
        vec3 n = normalize(vNormal);
        float rim = pow(1.0 - max(dot(n, normalize(vView)), 0.0), 3.0);
        float lit = 0.25 + 0.75 * max(dot(n, normalize(vToSun)), 0.0);
        gl_FragColor = vec4(tint * rim * lit * 1.1, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// Soft gas-giant bands: a few overlapping waves, so every planet gets its own pattern
export function planetTexture(color, rand) {
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const waves = Array.from({ length: 4 }, () => ({ f: 2 + rand() * 14, p: rand() * 6.28, a: 0.3 + rand() * 0.7 }));
  const dark = color.clone().offsetHSL(0, -0.1, -0.22);
  const light = color.clone().offsetHSL((rand() - 0.5) * 0.08, -0.05, 0.12);
  for (let y = 0; y < 256; y++) {
    const t = y / 255;
    let v = 0;
    for (const w of waves) v += Math.sin(t * w.f * Math.PI + w.p) * w.a;
    const mix = 0.5 + 0.5 * Math.tanh(v * 0.9);
    ctx.fillStyle = dark.clone().lerp(light, mix).getStyle();
    ctx.fillRect(0, y, 8, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
