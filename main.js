import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createRider, BIKE } from './rider.js';
import { createWorld, TRACK_R } from './world.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  $('loading').hidden = true;
  $('fail').hidden = false;
  throw err;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1200);
camera.position.set(-6, 3, 18);

const world = createWorld(scene);
const rider = createRider();
scene.add(rider.root);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.55, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const controls = new OrbitControls(camera, renderer.domElement);
Object.assign(controls, { enableDamping: true, enabled: false, maxPolarAngle: 1.48, minDistance: 2, maxDistance: 45 });

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.resolution.set(w, h);
  camera.aspect = w / h;
  camera.fov = w < 640 ? 62 : 50;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();

/* ---------- 状态 ---------- */
const S = {
  kmh: reduceMotion ? 8 : 18,
  phi: 0.4,
  dist: 0,
  wheel: 0,
  fish: 0,
  open: 0,
  bulge: 0,
  wave: 0,
  waveT: 0,
  cam: 'chase',
  time: 'dusk',
};

/* ---------- 声音（需用户点击后才能发声） ---------- */
let actx;
const audio = () => {
  actx ??= new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === 'suspended') actx.resume();
  return actx;
};
function tone(freq, t0, dur, peak, type = 'sine', endFreq) {
  const a = audio();
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}
function ding() {
  const t = audio().currentTime;
  for (const off of [0, 0.17]) [2093, 2794, 4186].forEach((f, i) => tone(f, t + off, 1.3 - i * 0.3, 0.18 / (i + 1)));
  flash('叮叮！');
}
const gulp = () => tone(320, audio().currentTime, 0.28, 0.3, 'sine', 80);

/* ---------- 抛鱼 & 接鱼 ---------- */
const fishBodyGeo = new THREE.SphereGeometry(0.5, 16, 12);
const fishTailGeo = new THREE.ConeGeometry(0.09, 0.15, 4);
const fishMat = new THREE.MeshStandardMaterial({ color: '#b8c6d2', metalness: 0.85, roughness: 0.25 });
const flying = [];
const pos = new THREE.Vector3(), fwd = new THREE.Vector3(), out = new THREE.Vector3(), mouthW = new THREE.Vector3();

function throwFish() {
  if (flying.length > 4) return;
  const g = new THREE.Group();
  const body = new THREE.Mesh(fishBodyGeo, fishMat);
  body.scale.set(0.32, 0.11, 0.07);
  const tail = new THREE.Mesh(fishTailGeo, fishMat);
  tail.position.x = -0.2;
  tail.rotation.z = Math.PI / 2;
  tail.scale.z = 0.3;
  g.add(body, tail);
  g.traverse((o) => (o.castShadow = true));
  const start = pos.clone().addScaledVector(fwd, 7).addScaledVector(out, 2.6).setY(0.3);
  g.position.copy(start);
  scene.add(g);
  flying.push({ g, start, t: 0 });
}

// 接到鱼时的小火花
const sparks = [];
const sparkMat = new THREE.PointsMaterial({ color: '#ffe3a0', size: 0.08, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
function burst(at) {
  const n = 28, p = new Float32Array(n * 3), v = [];
  for (let i = 0; i < n; i++) {
    p.set([at.x, at.y, at.z], i * 3);
    v.push(new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(3));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const pts = new THREE.Points(geo, sparkMat.clone());
  scene.add(pts);
  sparks.push({ pts, v, life: 1 });
}

function updateFish(dt) {
  rider.mouth.getWorldPosition(mouthW);
  let openT = 0;
  for (let i = flying.length - 1; i >= 0; i--) {
    const f = flying[i];
    f.t = Math.min(1, f.t + dt / 1.25);
    const e = f.t;
    f.g.position.lerpVectors(f.start, mouthW, e).y += Math.sin(Math.PI * e) * 3.2;
    f.g.rotation.z += dt * 9;
    f.g.rotation.y += dt * 3;
    openT = Math.max(openT, THREE.MathUtils.smoothstep(e, 0.35, 0.8));
    if (e >= 1) {
      scene.remove(f.g);
      flying.splice(i, 1);
      S.fish++;
      S.bulge = 1;
      burst(mouthW);
      if (actx) gulp();
      flash(S.fish === 1 ? '接住了！' : `第 ${S.fish} 条！`);
    }
  }
  S.open += (openT - S.open) * (1 - Math.exp(-dt * 14));
  S.bulge = Math.max(0, S.bulge - dt * 0.28);
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.life -= dt * 1.4;
    const arr = s.pts.geometry.attributes.position.array;
    s.v.forEach((v, k) => {
      v.y -= 4 * dt;
      arr[k * 3] += v.x * dt;
      arr[k * 3 + 1] += v.y * dt;
      arr[k * 3 + 2] += v.z * dt;
    });
    s.pts.geometry.attributes.position.needsUpdate = true;
    s.pts.material.opacity = Math.max(0, s.life);
    if (s.life <= 0) {
      scene.remove(s.pts);
      s.pts.geometry.dispose();
      sparks.splice(i, 1);
    }
  }
}

/* ---------- 机位 ---------- */
const look = new THREE.Vector3(), want = new THREE.Vector3(), lookWant = new THREE.Vector3();
const UPV = new THREE.Vector3(0, 1, 0);
function setCam(name) {
  S.cam = name;
  controls.enabled = name === 'orbit';
  if (name === 'orbit') controls.target.copy(look);
  document.querySelectorAll('[data-cam]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.cam === name));
}
renderer.domElement.addEventListener('pointerdown', () => S.cam !== 'orbit' && setCam('orbit'), { capture: true });
renderer.domElement.addEventListener('wheel', () => S.cam !== 'orbit' && setCam('orbit'), { capture: true, passive: true });

function updateCamera(t, dt) {
  const k = 1 - Math.exp(-dt * 3.5);
  if (S.cam === 'orbit') {
    lookWant.copy(pos).addScaledVector(UPV, 1.1);
    const d = lookWant.sub(controls.target);
    camera.position.add(d);
    controls.target.add(d);
    look.copy(controls.target);
    controls.update();
    return;
  }
  lookWant.copy(pos).addScaledVector(UPV, 1.1);
  if (S.cam === 'chase') want.copy(pos).addScaledVector(fwd, -4.4).addScaledVector(out, 0.9).addScaledVector(UPV, 2.0), lookWant.addScaledVector(fwd, 1.6);
  if (S.cam === 'front') want.copy(pos).addScaledVector(fwd, 3.6).addScaledVector(out, 0.6).addScaledVector(UPV, 1.55), lookWant.addScaledVector(UPV, 0.25);
  if (S.cam === 'side') want.copy(pos).addScaledVector(out, 4.6).addScaledVector(fwd, 0.4).addScaledVector(UPV, 1.3);
  if (S.cam === 'cine') {
    const a = t * (reduceMotion ? 0.05 : 0.16);
    want.set(Math.cos(a) * 6, 1.6 + Math.sin(t * 0.27) * 1.3, Math.sin(a) * 6).add(pos);
  }
  camera.position.lerp(want, k);
  look.lerp(lookWant, k * 1.6);
  camera.lookAt(look);
}

/* ---------- 界面 ---------- */
let flashTimer;
function flash(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.classList.remove('show'), 1300);
}
function setTime(name) {
  S.time = name;
  world.setPreset(name);
  document.querySelectorAll('[data-time]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.time === name));
}
const wave = () => {
  S.waveT = 2.6;
  flash('你好呀！');
};
document.querySelectorAll('[data-time]').forEach((b) => b.addEventListener('click', () => setTime(b.dataset.time)));
document.querySelectorAll('[data-cam]').forEach((b) => b.addEventListener('click', () => setCam(b.dataset.cam)));
$('fish').addEventListener('click', throwFish);
$('bell').addEventListener('click', ding);
$('wave').addEventListener('click', wave);
const speed = $('speed');
speed.value = S.kmh;
const showSpeed = () => ($('speedOut').textContent = `${S.kmh} km/h`);
speed.addEventListener('input', () => {
  S.kmh = Number(speed.value);
  showSpeed();
});
showSpeed();

const camKeys = { 1: 'chase', 2: 'front', 3: 'side', 4: 'cine', 5: 'orbit' };
const times = ['day', 'dusk', 'night'];
addEventListener('keydown', (e) => {
  if (e.target.closest('button, input') || e.repeat) return;
  const key = e.key.toLowerCase();
  if (key === ' ') e.preventDefault(), throwFish();
  else if (key === 'b') ding();
  else if (key === 'h') wave();
  else if (key === 't') setTime(times[(times.indexOf(S.time) + 1) % 3]);
  else if (camKeys[key]) setCam(camKeys[key]);
});

/* ---------- 主循环 ---------- */
const clock = new THREE.Clock();
const wheelC = 2 * Math.PI * BIKE.wheelR;
let hudAcc = 0, first = true;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  const v = S.kmh / 3.6;

  S.phi += (v / TRACK_R) * dt;
  S.dist += v * dt;
  S.wheel += (v * dt) / BIKE.wheelR;
  pos.set(Math.cos(S.phi) * TRACK_R, 0, Math.sin(S.phi) * TRACK_R);
  fwd.set(-Math.sin(S.phi), 0, Math.cos(S.phi));
  out.set(Math.cos(S.phi), 0, Math.sin(S.phi));
  rider.root.position.copy(pos);
  rider.root.rotation.y = Math.atan2(-fwd.z, fwd.x);
  // 真实的过弯倾角：tanθ = v² / (g·R)
  const leanAngle = Math.atan((v * v) / (9.81 * TRACK_R));
  rider.lean.rotation.x += (leanAngle - rider.lean.rotation.x) * (1 - Math.exp(-dt * 3));

  S.waveT = Math.max(0, S.waveT - dt);
  S.wave += ((S.waveT > 0 ? 1 : 0) - S.wave) * (1 - Math.exp(-dt * 6));

  rider.update({
    wheelAngle: S.wheel,
    crankAngle: (S.wheel * BIKE.cog) / BIKE.chainring,
    t, wave: S.wave, open: S.open, bulge: S.bulge, night: world.P.lamp,
  });
  updateFish(dt);
  updateCamera(t, dt);
  world.update(t, dt, pos, camera);
  renderer.toneMappingExposure = world.P.exposure;
  bloom.strength = world.P.bloom;

  hudAcc += dt;
  if (hudAcc > 0.12) {
    hudAcc = 0;
    $('hSpeed').textContent = S.kmh.toFixed(0);
    $('hCad').textContent = ((v / wheelC) * 60 * (BIKE.cog / BIKE.chainring)).toFixed(0);
    $('hLean').textContent = THREE.MathUtils.radToDeg(leanAngle).toFixed(1);
    $('hDist').textContent = (S.dist / 1000).toFixed(2);
    $('hLap').textContent = Math.floor(S.dist / (2 * Math.PI * TRACK_R));
    $('hFish').textContent = S.fish;
  }

  composer.render();
  if (first) {
    first = false;
    $('loading').hidden = true;
    look.copy(pos).setY(1.1);
  }
  requestAnimationFrame(frame);
}
setTime('dusk');
setCam('chase');
requestAnimationFrame(frame);
