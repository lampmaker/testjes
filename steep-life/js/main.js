// STEEP LIFE — a still life you can drink.
import * as THREE from '../vendor/three.module.js';
import { buildScene, CUP, cupInnerR, cupLevelY, LAYOUT } from './scene.js';
import { Post } from './post.js';
import { Liquid } from './liquid.js';
import { Steam, Stream } from './fx.js';
import { audio } from './audio.js';
import { TIME_SCALE } from './teas.js';
import { appraise } from './critic.js';
import { tween, wait, updateTweens, tweensActive, ease, clamp, lerp, damp, smoothstep, fmtTime } from './util.js';
import * as UI from './ui.js';
import * as TX from './textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const query = new URLSearchParams(location.search);
const MANUAL = query.has('manual');

// ------------------------------------------------------------------- renderer --
const canvas = document.getElementById('stage');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  if (!renderer.capabilities.isWebGL2) throw new Error('webgl2');
  if (!renderer.extensions.has('EXT_color_buffer_float') && !renderer.extensions.has('EXT_color_buffer_half_float')) throw new Error('float targets');
} catch (e) {
  document.getElementById('fallback').hidden = false;
  document.getElementById('title').hidden = true;
  throw e;
}
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NoToneMapping;

const world = buildScene(renderer);
const { scene, items, mat } = world;
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
const post = new Post(renderer);
const liquid = new Liquid(renderer);
scene.add(liquid.mesh);

const cupSteam = new Steam(0.22, 0.46, 0.0, 1.0);
const kettleSteam = new Steam(0.17, 0.36, 3.7, 0.75);
scene.add(cupSteam.mesh, kettleSteam.mesh);
const kStream = new Stream(mat.water, 0.0036), jStream = new Stream(mat.water, 0.005), mStream = new Stream(mat.milk, 0.0023);
mStream.speed = 0.12; jStream.speed = 0.16;
scene.add(kStream.mesh, jStream.mesh, mStream.mesh);

const cupI = items.cup, K = items.kettle, J = items.jug, CR = items.creamer, BAG = items.bag, SPOON = items.spoon;
const cupHome = cupI.home.clone();
const cupTopY = cupHome.y + CUP.H;

// what was spilled into the saucer, if anything
const spill = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.05, 48).rotateX(-Math.PI / 2),
  new THREE.MeshPhysicalMaterial({ color: 0x6b3a14, roughness: 0.03, transparent: true, opacity: 0, depthWrite: false }));
spill.position.set(cupHome.x, cupHome.y + 0.0042, cupHome.z); spill.visible = false; scene.add(spill);

// ---------------------------------------------------------------------- state --
function freshState() {
  return {
    seed: (Math.random() * 2 ** 31) | 0,
    kettle: { water: 0, temp: 19, on: false, boils: 0 },
    cup: { vol: 0, temp: 21, strength: 0, milk: 0, lemon: 0, sugar: 0, steepSec: 0, pourTemp: 0, poured: 0, tea: null, absorb: [0, 0, 0], eSum: 0, spill: 0 },
    bag: { state: 'none', tea: null, e: 0, wet: 0, boost: 0, dunk: 0 },
    stir: { active: false, x: 0, y: 0, tx: 0, ty: 0, angle: 0, linger: 0 },
    rec: { bags: 0, dunks: 0, milkFirst: false, curdled: false, stirred: false, galaxy: false, overflow: false, sips: 0, firstSipTemp: 0, waitSec: 0,
      wafels: 0, wafelWarm: false, wafelCold: false, watchTaps: 0, bagLeftIn: false, lemon: 0, bagUsed: null },
    turb: 0, omegaT: 0, galaxyT: 0, pourAt: 0, startAt: 0, snap: null, appraisal: null, readingShown: false,
    timed: [], dryCubes: [], usedBags: [], wafelOnCup: null, idealSaid: false, tempSaid: false, lastTick: 0,
  };
}
let G = freshState();
let phase = 'title';
let now = 0;                 // seconds of game time
let lastActive = -10;
let camMode = 'wide';
let msg = '', msgUntil = 0;
const say = (text, dur = 4.5) => { msg = text; msgUntil = now + dur; };
const active = () => { lastActive = now; };

let frameWaiters = [];
const nextFrame = () => new Promise((r) => frameWaiters.push(r));

// ---------------------------------------------------------------- pose helpers --
const _e = new THREE.Euler(), _v = V(), _p = V();
function lerpAngle(a, b, t) { let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI; if (d < -Math.PI) d += Math.PI * 2; return a + d * t; }
// place a pouring vessel so that its spout tip sits at P.tip when k = 1
function setPour(item, k, P) {
  _v.copy(item.spout).applyEuler(_e.set(0, 0, -P.tilt)).applyEuler(_e.set(0, P.yaw, 0));
  _p.copy(P.tip).sub(_v);
  item.group.position.lerpVectors(item.home, _p, k);
  item.group.position.y += Math.sin(k * Math.PI) * (P.lift || 0);
  item.group.rotation.y = lerpAngle(item.homeYaw, P.yaw, k);
  item.tilt.rotation.z = -P.tilt * k * k;
}
function tipWorld(item, out) { item.group.updateMatrixWorld(true); return item.tilt.localToWorld(out.copy(item.spout)); }
function dirOf(item, out) { return out.set(Math.cos(item.group.rotation.y), 0, -Math.sin(item.group.rotation.y)); }
const yawToward = (from, to) => Math.atan2(-(to.z - from.z), to.x - from.x);

const liquidY = () => cupLevelY(Math.min(G.cup.vol, 1.13));
const liquidR = () => cupInnerR(liquidY());
function toSim(wx, wz, out) { const R = liquidR(); out.x = (wx - cupI.group.position.x) / R; out.y = -(wz - cupI.group.position.z) / R; return out; }

// ---------------------------------------------------------------------- pours --
const pourP = { kettle: { tip: V(), yaw: 0, tilt: 0.7, lift: 0.03 }, jug: { tip: V(), yaw: 0, tilt: 1.0, lift: 0.05 }, creamer: { tip: V(), yaw: 0, tilt: 1.1, lift: 0.02 } };
function solvePour(id) {
  const P = pourP[id];
  if (id === 'kettle') {
    const d = _v.subVectors(cupHome, K.home).setY(0).normalize();
    P.yaw = Math.atan2(-d.z, d.x); P.tilt = 0.62 + 0.5 * (1 - G.kettle.water);
    P.tip.set(cupHome.x - d.x * 0.03, cupTopY + 0.07, cupHome.z - d.z * 0.03);
  } else if (id === 'jug') {
    const kh = K.home, d = _v.subVectors(kh, J.home).setY(0).normalize();
    P.yaw = Math.atan2(-d.z, d.x); P.tilt = 0.95 + 0.12 * G.kettle.water;
    P.tip.set(kh.x - d.x * 0.03, kh.y + 0.142 + 0.085, kh.z - d.z * 0.03);
  } else {
    const d = _v.subVectors(cupHome, CR.home).setY(0).normalize();
    P.yaw = Math.atan2(-d.z, d.x); P.tilt = 1.12;
    P.tip.set(cupHome.x - d.x * 0.018, cupTopY + 0.04, cupHome.z - d.z * 0.018);
  }
  return P;
}

async function pourFrom(id, minFlow = 0.3) {
  const item = items[id];
  if (item.busy || phase !== 'play') return;
  if (id !== 'jug' && G.wafelOnCup) { say('There is a stroopwafel on the cup. Tap it to eat it first.'); return; }
  if (id !== 'jug' && cupI.busy) return;
  if (id === 'kettle' && G.kettle.water < 0.02) { say('The kettle is empty. Hold the stone jug to fill it.'); return; }
  if (id === 'jug' && G.kettle.water >= 0.995) { say('The kettle is full. It could not be fuller.'); return; }
  if (id === 'jug' && K.busy) return;
  item.busy = true;
  if (id === 'kettle' && G.kettle.on) { G.kettle.on = false; audio.click(); }
  if (id === 'jug') { K.busy = true; tween(0.45, (k) => { K.lid.position.set(-0.035 * k, 0.07 * k, 0.07 * k); K.lid.rotation.x = 0.5 * k; }); }
  audio.whoosh();
  const P = solvePour(id);
  await tween(0.62, (k) => setPour(item, k, P));
  item.flowing = true;
  let t = 0;
  while ((held(id) || t < minFlow) && canFlow(id) && phase === 'play') { t += await nextFrame(); setPour(item, 1, solvePour(id)); }
  item.flowing = false;
  await wait(0.22);
  await tween(0.6, (k) => setPour(item, 1 - k, P));
  if (id === 'jug') { await tween(0.35, (k) => { K.lid.position.set(-0.035 * (1 - k), 0.07 * (1 - k), 0.07 * (1 - k)); K.lid.rotation.x = 0.5 * (1 - k); }); audio.thunk(); K.busy = false; }
  else audio.thunk();
  item.busy = false;
}
function canFlow(id) {
  if (id === 'kettle') return G.kettle.water > 0.003;
  if (id === 'jug') return G.kettle.water < 1;
  return G.cup.milk < 1.2;
}

function addToCup(dv, temp) {
  const c = G.cup, v0 = c.vol;
  if (v0 + dv > 1.13) {
    if (!G.rec.overflow) { G.rec.overflow = true; say('It runneth over. The saucer is now also a vessel.'); }
    c.spill = Math.min(1, c.spill + dv * 2.2);
    dv = Math.max(0, 1.13 - v0);
  }
  if (dv <= 0) return;
  const v1 = v0 + dv;
  c.temp = v0 > 0.001 ? (c.temp * v0 + temp * dv) / v1 : temp;
  c.strength *= v0 / v1;
  c.lemon *= v0 / v1;
  c.vol = v1;
}

function flows(dt) {
  const c = G.cup, k = G.kettle, s = _sim;
  // kettle -> cup
  if (K.flowing && k.water > 0) {
    const dv = Math.min(0.27 * dt, k.water * 4);
    k.water = Math.max(0, k.water - dv / 4);
    if (c.poured < 0.01) { c.pourTemp = k.temp; G.pourAt = now; if (c.milk > 0.01) G.rec.milkFirst = true; }
    c.pourTemp = c.poured > 0.01 ? (c.pourTemp * c.poured + k.temp * dv) / (c.poured + dv) : k.temp;
    c.poured += dv;
    addToCup(dv, k.temp);
    G.turb = Math.max(G.turb, 0.42);
    toSim(kStream.hit.x, kStream.hit.z, s); clampSim(s, 0.6);
    liquid.addDrop(s.x + (Math.random() - 0.5) * 0.1, s.y + (Math.random() - 0.5) * 0.1, 0.16, 0.05);
    if (G.dryCubes.length) { for (const m of G.dryCubes) scene.remove(m); G.dryCubes.length = 0; }
  }
  // jug -> kettle
  if (J.flowing) {
    const dv = Math.min(0.24 * dt, 1 - k.water);
    k.temp = k.water + dv > 0 ? (k.temp * k.water + 15 * dv) / (k.water + dv) : 15;
    k.water = Math.min(1, k.water + dv);
  }
  // creamer -> cup
  if (CR.flowing) {
    const dv = 0.085 * dt, v0 = c.vol;
    if (c.poured < 0.01 && c.milk < 0.001) { /* milk first, noted when the water comes */ }
    c.milk += dv; addToCup(dv, 6);
    if (c.vol > 0.02) {
      toSim(mStream.hit.x, mStream.hit.z, s); clampSim(s, 0.6);
      liquid.addSource(s.x, s.y, 0.17, [2.9 / Math.max(0.25, c.vol), 0, 0], 0.55);
      liquid.addDrop(s.x, s.y, 0.12, 0.02);
      G.turb = Math.max(G.turb, 0.16);
    }
    if (c.lemon > 0.12 && !G.rec.curdled && v0 > 0.1) curdle();
  }
  const anyWater = (K.flowing && k.water > 0) || J.flowing;
  audio.pour(anyWater || CR.flowing, J.flowing ? k.water : clamp(c.vol), CR.flowing && !anyWater);
}
function curdle() { G.rec.curdled = true; say('Lemon, meet milk. Oh. Oh dear. It has curdled.', 5); }
const _sim = new THREE.Vector2();
function clampSim(s, r) { const l = s.length(); if (l > r) s.multiplyScalar(r / l); return s; }

// ------------------------------------------------------------------------ tea --
async function chooseTea(tin) {
  const b = G.bag, tea = tin.tea;
  if (b.state === 'flying' || b.state === 'lifting' || tin.busy || cupI.busy) return;
  if (G.wafelOnCup) { say('The stroopwafel is guarding the cup. Tap it to eat it first.'); return; }
  if (b.state === 'cup' && G.cup.vol > 0.05) { say('One bag at a time. Hold the tag to fish this one out first.'); return; }
  if (b.state === 'saucer') {       // the spent bag stays on the saucer as a small monument
    const ghost = BAG.body.clone(); ghost.material = BAG.paperMat.clone();
    ghost.position.copy(BAG.group.position); ghost.quaternion.copy(BAG.group.quaternion); scene.add(ghost); G.usedBags.push(ghost);
  }
  if (b.state !== 'cup') G.rec.bags++;            // swapping a dry bag does not count as a second one
  tin.busy = true; b.state = 'flying'; b.tea = tea; b.e = 0; b.wet = 0; b.boost = 0;
  G.rec.bagUsed = tea; G.idealSaid = false;
  if (!G.cup.tea || G.cup.eSum < 0.05) G.cup.tea = tea;
  BAG.paperMat.color.set(tea.leaf === 'black' ? 0xfff6e6 : tea.leaf === 'green' ? 0xf2f6dc : tea.leaf === 'flower' ? 0xe6e2f6 : 0xfdf3c8);
  if (BAG.tag.material.map) BAG.tag.material.map.dispose();
  BAG.tag.material.map = TX.tagTexture(tea); BAG.tag.material.needsUpdate = true;
  audio.tin();
  const lid = tin.lid;
  await tween(0.3, (k) => { lid.position.y = tin.lidHomeY + 0.05 * k; lid.rotation.z = 0.5 * k; lid.position.x = -0.02 * k; }, ease.out);
  const from = tin.top.clone(), over = V(cupHome.x - 0.012, cupTopY + 0.085, cupHome.z + 0.004);
  BAG.group.visible = BAG.tag.visible = BAG.string.mesh.visible = true;
  BAG.group.rotation.set(0, 0.5, 0);
  audio.paper();
  await tween(0.75, (k) => {
    BAG.group.position.lerpVectors(from, over, k); BAG.group.position.y += Math.sin(k * Math.PI) * 0.09 - (1 - k) * 0.03;
    BAG.tag.position.copy(BAG.group.position); BAG.tag.position.y += 0.085; BAG.tag.rotation.set(0, 0.3, 0);
  });
  tween(0.3, (k) => { lid.position.y = tin.lidHomeY + 0.05 * (1 - k); lid.rotation.z = 0.5 * (1 - k); lid.position.x = -0.02 * (1 - k); }).then(() => { audio.thunk(); tin.busy = false; });
  b.drop = 1;
  await tween(0.5, (k) => { b.drop = 1 - k; }, ease.inOut);
  b.drop = 0; b.state = 'cup';
  if (G.cup.vol > 0.1) { audio.plop(1.4); bagDrop(0.06); }
  say(`${tea.name}. ${tea.temp}°, ${fmtTime(tea.time)}, if you believe the tin.`, 3.5);
}
function bagDrop(strength) { const s = toSim(BAG.group.position.x, BAG.group.position.z, _sim); clampSim(s, 0.7); liquid.addDrop(s.x, s.y, 0.2, strength); }

function dunk() {
  const b = G.bag;
  if (b.state !== 'cup' || b.dunk > 0) return;
  b.dunk = 1; G.rec.dunks++;
}
async function removeBag(quiet = false) {
  const b = G.bag;
  if (b.state !== 'cup') return;
  b.state = 'lifting';
  const start = BAG.group.position.clone(), up = V(cupI.group.position.x - 0.012, cupTopY + 0.075, cupI.group.position.z + 0.004);
  const tagStart = BAG.tag.position.clone();
  await tween(0.55, (k) => {
    BAG.group.position.lerpVectors(start, up, k); BAG.group.rotation.set(0, 0.5, 0.12 * (1 - k));
    BAG.tag.position.lerpVectors(tagStart, _v.copy(BAG.group.position).setY(BAG.group.position.y + 0.085), k);
  }, ease.out);
  if (b.wet > 0.05 && G.cup.vol > 0.03) for (let i = 0; i < 3; i++) { await wait(0.24); audio.drip(); bagDrop(0.035); }
  const rest = V(cupHome.x - 0.052, cupHome.y + 0.0105, cupHome.z + 0.042);
  const p0 = BAG.group.position.clone(), t0 = BAG.tag.position.clone(), tagRest = V(cupHome.x - 0.094, cupHome.y - 0.0008, cupHome.z + 0.088);
  await tween(0.6, (k) => {
    BAG.group.position.lerpVectors(p0, rest, k); BAG.group.position.y += Math.sin(k * Math.PI) * 0.02;
    BAG.group.rotation.set(-1.32 * k, 0.5 + 0.4 * k, 0);
    BAG.tag.position.lerpVectors(t0, tagRest, k); BAG.tag.rotation.set(-Math.PI / 2 * k, 0, 0.3 + 0.5 * k);
  });
  b.state = 'saucer';
  if (!quiet) say(b.wet > 0.05 ? 'The bag retires to the saucer, as is tradition.' : 'An unused bag, returned with dignity.', 3);
}

// -------------------------------------------------------------- small additions --
async function throwSugar() {
  if (G.wafelOnCup) { say('The stroopwafel is in the way. Tap it to eat it first.'); return; }
  if (cupI.busy) return;
  const c = G.cup;
  const cube = new THREE.Mesh(items.sugar.cubeGeo, mat.sugar); cube.castShadow = true; scene.add(cube);
  const from = _v.copy(items.sugar.group.position).clone(); from.y += 0.065;
  const wet = c.vol > 0.05, n = G.dryCubes.length;
  const to = V(cupHome.x + (wet ? (Math.random() - 0.5) * 0.02 : ((n % 3) - 1) * 0.012), wet ? cupHome.y + liquidY() : cupHome.y + CUP.floorY + 0.007 + Math.floor(n / 3) * 0.0125, cupHome.z + (wet ? (Math.random() - 0.5) * 0.02 : ((n * 7) % 3 - 1) * 0.008));
  audio.clink(0.35);
  await tween(0.55, (k) => {
    cube.position.lerpVectors(from, to, k); cube.position.y += Math.sin(k * Math.PI) * 0.1;
    cube.rotation.set(k * 5, k * 3, k * 2);
  }, ease.linear);
  c.sugar++;
  if (G.cup.vol > 0.05) {
    scene.remove(cube); audio.plop(1); G.turb = Math.max(G.turb, 0.1);
    const s = toSim(to.x, to.z, _sim); liquid.addDrop(s.x, s.y, 0.2, 0.11);
  } else { G.dryCubes.push(cube); audio.clink(0.7); }
  if (c.sugar === 4) say('Four. No judgement. (There will be judgement.)');
  if (c.sugar === 8) say('Eight. The spoon is beginning to worry.');
  if (c.sugar === 12) say('Twelve. This is now a sculpture.');
}

async function squeezeLemon() {
  const L = items.lemon;
  if (L.busy) return;
  if (G.wafelOnCup) { say('The stroopwafel is in the way. Tap it to eat it first.'); return; }
  if (cupI.busy) return;
  L.busy = true;
  const w = L.wedges[0].group, home = L.wedges[0].home, homeRot = L.wedges[0].homeRotY;
  const over = L.group.worldToLocal(V(cupHome.x + 0.004, cupTopY + 0.05, cupHome.z + 0.004));
  audio.whoosh();
  await tween(0.5, (k) => { w.position.lerpVectors(home, over, k); w.position.y += Math.sin(k * Math.PI) * 0.03; w.rotation.set(0, lerp(homeRot, 0.4, k), Math.PI * k); });
  await tween(0.45, (k) => { const q = Math.sin(k * Math.PI); w.scale.set(1 + 0.12 * q, 1 - 0.3 * q, 1 - 0.3 * q); }, ease.linear);
  w.scale.set(1, 1, 1);
  const c = G.cup;
  G.rec.lemon++;
  if (c.vol > 0.05) {
    c.lemon = Math.min(1.2, c.lemon + 0.36 / Math.max(0.4, c.vol));
    const a = Math.random() * 6.28, sx = Math.cos(a) * 0.25, sy = Math.sin(a) * 0.25;
    G.timed.push({ x: sx, y: sy, radius: 0.22, rgb: [0, 16, 0], push: 0.25, ttl: 0.45 });
    for (let i = 0; i < 3; i++) { audio.drip(); liquid.addDrop(sx + (Math.random() - 0.5) * 0.3, sy + (Math.random() - 0.5) * 0.3, 0.1, 0.04); await wait(0.11); }
    if (c.milk / c.vol > 0.02 && !G.rec.curdled) curdle();
    else if (c.tea && c.tea.id === 'pea' && c.strength > 0.15 && G.rec.lemon === 1) say('The blue turns violet. Nobody in the gallery can explain it. (It is the acid.)', 5.5);
  } else { audio.drip(); say('A squeeze of lemon into an empty cup. Bold underpainting.', 3.5); c.lemon = Math.min(1.2, c.lemon + 0.2); }
  await tween(0.5, (k) => { w.position.lerpVectors(over, home, k); w.position.y += Math.sin(k * Math.PI) * 0.03; w.rotation.set(0, lerp(0.4, homeRot, k), Math.PI * (1 - k)); });
  L.busy = false;
}

async function tapWafel(item) {
  if (item.busy || item.state === 'eaten') return;
  const g = item.group;
  if (item.state === 'plate') {
    // only the top one may be taken
    const top = [...world.wafels].reverse().find((w) => w.state === 'plate');
    if (top !== item) return tapWafel(top);
    const hot = G.cup.vol > 0.3 && G.cup.temp > 45;
    if (hot && !G.wafelOnCup && !cupI.busy && !G.stir.active && !K.busy && !CR.busy) {
      item.busy = true; item.state = 'flying'; G.wafelOnCup = item;
      const from = g.position.clone(), to = V(cupHome.x, cupTopY + 0.0042, cupHome.z);
      audio.whoosh();
      await tween(0.7, (k) => { g.position.lerpVectors(from, to, k); g.position.y += Math.sin(k * Math.PI) * 0.07; g.rotation.y = item.homeRotY + k * 2; });
      audio.clink(0.3); item.state = 'cup'; item.busy = false;
      say('A stroopwafel belongs on the cup. Give the steam a moment; then tap it.', 5);
      return;
    }
    return eatWafel(item, false);
  }
  if (item.state === 'cup') return eatWafel(item, item.warmth > 0.55);
}
async function eatWafel(item, warm) {
  item.busy = true; item.state = 'eaten'; item.proxy.userData.off = true;
  const g = item.group, from = g.position.clone();
  const to = camera.position.clone().add(V(0.02, -0.26, -0.3));
  if (G.wafelOnCup === item) G.wafelOnCup = null;
  await tween(0.65, (k) => { g.position.lerpVectors(from, to, k); g.rotation.x = k * 0.9; }, ease.in);
  g.visible = false;
  audio.crunch(warm);
  G.rec.wafels++;
  if (warm) { G.rec.wafelWarm = true; say('Warm. The syrup has given in. This is the correct way and you knew it.', 5); }
  else { G.rec.wafelCold = true; say(item.warmth > 0.15 ? 'Almost warm. Patience is also an ingredient.' : 'A cold stroopwafel, eaten with purpose.', 4); }
  item.busy = false;
}

// ----------------------------------------------------------------------- sips --
async function sip() {
  const c = G.cup;
  if (cupI.busy || K.busy || CR.busy || G.bag.state === 'flying' || G.bag.state === 'lifting') return;
  if (G.wafelOnCup) { say('The stroopwafel is in the way. Tap it to eat it first.'); return; }
  if (c.vol < 0.03) { say(c.sugar ? 'A cup of dry sugar is not yet a drink.' : 'The cup is empty. Tea first, then drinking. That is the order.'); return; }
  cupI.busy = true;
  if (!G.snap) capture();                       // the painter finishes just before the first sip
  if (G.rec.sips === 0) { G.rec.firstSipTemp = c.temp; G.rec.waitSec = (now - (G.pourAt || now)) * TIME_SCALE; }
  if (G.bag.state === 'cup') G.rec.bagLeftIn = true;
  G.rec.sips++;
  const g = cupI.group, from = cupHome.clone();
  const to = camera.position.clone().add(V(0, -0.2, -0.16));
  audio.whoosh();
  await tween(0.85, (k) => { g.position.lerpVectors(from, to, k); g.position.y += Math.sin(k * Math.PI) * 0.04; g.rotation.x = 0.55 * k * k; }, ease.in);
  audio.sip();
  await wait(0.8);
  const t = c.temp;
  c.vol = c.vol - 0.24 < 0.07 ? 0 : c.vol - 0.24;
  if (t > 78) say('Hot. Far too hot. The painting winces on your behalf.');
  else if (t > 68) say('Hot, but you are brave.');
  else if (t >= 50) { say(c.strength > 1.36 && c.tea ? 'The right temperature. The strength is another conversation.' : 'Exactly right. Remember this moment.'); audio.ahh(); }
  else if (t >= 36) say('Lukewarm. It happens to the best of us.');
  else say('Stone cold. A tea for the very busy.');
  await wait(0.35);
  await tween(0.85, (k) => { g.position.lerpVectors(to, from, k); g.position.y += Math.sin(k * Math.PI) * 0.04; g.rotation.x = 0.55 * (1 - k) * (1 - k); }, ease.out);
  g.position.copy(from); g.rotation.x = 0;
  audio.clink(0.55);
  cupI.busy = false;
  if (c.vol <= 0) beginReading();
}

async function beginReading() {
  if (phase !== 'play') return;
  phase = 'reading';
  if (G.bag.state === 'cup') await removeBag(true);
  const rec = record();
  G.appraisal = appraise(rec);
  if (!rec.tea) { G.appraisal.shape = 'nothing at all'; G.appraisal.fortune = 'No leaves, no fortune. The future remains refreshingly unwritten.'; }
  else {
    const leaf = { black: [38, 24, 12], green: [34, 48, 16], herb: [96, 78, 22], flower: [30, 28, 78] }[rec.tea.leaf];
    const d = cupI.dregs; if (d.material.map) d.material.map.dispose();
    d.material.map = TX.dregsTexture(G.seed, leaf); d.material.needsUpdate = true; d.visible = true;
    tween(1.8, (k) => { d.material.opacity = 0.95 * k; });
  }
  camMode = 'peer';
  await wait(1.7);
  if (phase !== 'reading') return;
  G.readingShown = true;
  UI.showFortune(G.appraisal.shape, G.appraisal.fortune);
  audio.chime(3);
  document.getElementById('btnFinish').textContent = 'Hang it in the gallery';
}

// ---------------------------------------------------------- record & the placard --
function record() {
  const c = G.cup, r = G.rec;
  return {
    seed: G.seed, tea: c.eSum > 0.01 ? c.tea : null, bagUsed: r.bagUsed, strength: c.strength, steepSec: c.steepSec, pourTemp: c.pourTemp, poured: c.poured,
    milk: c.poured + c.milk > 0 ? c.milk / (c.poured + c.milk) : 0, sugar: c.sugar, lemon: r.lemon, curdled: r.curdled, milkFirst: r.milkFirst,
    stirred: r.stirred, galaxy: r.galaxy, overflow: r.overflow, reboiled: G.kettle.boils, sips: r.sips, firstSipTemp: r.firstSipTemp, waitSec: r.waitSec,
    bagLeftIn: r.bagLeftIn, dunks: r.dunks, bags: r.bags, wafels: r.wafels, wafelWarm: r.wafelWarm, wafelCold: r.wafelCold && !r.wafelWarm, watchTaps: r.watchTaps,
    totalSec: now - G.startAt,
  };
}

function capture() {
  const savedPaint = post.paint, savedFade = post.fade;
  post.paint = 1; post.fade = 1;
  UI.setTip('');
  updateCamera(0, true);
  renderFrame();
  const cw = canvas.width, ch = canvas.height, target = clamp(cw / ch, 0.8, 1.42);
  let sw = cw, sh = ch;
  if (cw / ch > target) sw = Math.round(ch * target); else sh = Math.round(cw / target);
  _v.copy(cupHome).setY(cupHome.y + 0.1).project(camera);
  const px = (_v.x * 0.5 + 0.5) * cw, py = (-_v.y * 0.5 + 0.5) * ch;
  const sx = clamp(px - sw * 0.46, 0, cw - sw), sy = clamp(py - sh * 0.5, 0, ch - sh);
  const mk = (w) => {
    const o = document.createElement('canvas'); o.width = w; o.height = Math.round(w * sh / sw);
    const x = o.getContext('2d'); x.imageSmoothingQuality = 'high';
    x.drawImage(canvas, sx, sy, sw, sh, 0, 0, o.width, o.height);
    return o;
  };
  G.snap = { image: mk(Math.min(1280, sw)).toDataURL('image/jpeg', 0.9), thumb: mk(440).toDataURL('image/jpeg', 0.78) };
  post.paint = savedPaint; post.fade = savedFade;
}

function finish() {
  if (phase !== 'play' && phase !== 'reading') return;
  if (!G.snap) capture();
  const a = G.appraisal || appraise(record());
  const entry = { title: a.title, medium: a.medium, review: a.review, verdict: a.verdict, estimate: a.estimate, critic: a.critic, paper: a.paper,
    shape: a.shape, fortune: G.readingShown ? a.fortune : null, year: new Date().getFullYear(), image: G.snap.image, thumb: G.snap.thumb };
  phase = 'placard';
  UI.hide('fortune', true); UI.setHint(''); UI.setTip('');
  document.getElementById('btnFinish').hidden = true;
  UI.showPlacard(entry); UI.saveToGallery(entry);
  audio.chime(4);
}

function newCanvas() {
  // put everything back where the painter left it
  for (const m of [...G.dryCubes, ...G.usedBags]) scene.remove(m);
  for (const w of world.wafels) { w.group.position.copy(w.home); w.group.rotation.set(0, w.homeRotY, 0); w.group.visible = true; w.state = 'plate'; w.warmth = 0; w.busy = false; w.proxy.userData.off = false; }
  BAG.group.visible = BAG.tag.visible = BAG.string.mesh.visible = false;
  cupI.dregs.visible = false; cupI.dregs.material.opacity = 0;
  cupI.group.position.copy(cupHome); cupI.group.rotation.x = 0; cupI.busy = false;
  spill.visible = false;
  liquid.reset();
  G = freshState(); G.startAt = now;
  camMode = 'wide'; phase = 'play'; msg = '';
  const bf = document.getElementById('btnFinish'); bf.textContent = 'Sign & hang it'; bf.hidden = false;
  UI.hide('placard'); UI.hide('fortune', true);
  say('A fresh canvas. The kettle has been emptied by museum staff.', 4);
}

// ------------------------------------------------------------------ simulation --
function simulate(dt) {
  const c = G.cup, k = G.kettle, b = G.bag;
  // kettle
  if (k.on) {
    k.temp += (84 / (11 + 15 * k.water)) * (k.temp > 93 ? 0.55 : 1) * dt;
    const tea = b.tea;
    if (tea && tea.temp < 99 && !G.tempSaid && k.temp >= tea.temp - 1 && c.poured < 0.01) { G.tempSaid = true; say(`${tea.temp}° — the ${tea.name} likes it about here. Hold the kettle to pour.`, 5); audio.note(7); }
    if (k.temp >= 100) {
      k.temp = 100; k.on = false; k.boils++; audio.click(); audio.sing();
      say(k.boils === 1 ? 'Boiled. The kettle sings, briefly, and is embarrassed about it.' : 'Boiled. Again.', 4.5);
    }
  } else k.temp += (20 - k.temp) * 0.0035 * dt;
  flows(dt);
  // the cup cools; a stroopwafel lid slows it
  if (c.vol > 0.01) c.temp += (21 - c.temp) * 0.0091 * (G.wafelOnCup ? 0.45 : 1) * dt;
  // steeping
  let teaRate = 0;
  if (b.state === 'cup' && c.vol > 0.15 && c.poured > 0.05) {
    const tea = b.tea, tdt = dt * TIME_SCALE;
    c.steepSec += tdt;
    const f = Math.pow(clamp((c.temp - 22) / (tea.temp - 22), 0, 1.2), 1.5);
    const de = ((1.6 - b.e) / (0.74 * tea.time)) * f * tdt * (1 + b.boost);
    b.e += de;
    const ds = de / Math.max(0.6, c.vol);
    c.strength += ds; teaRate = ds / dt;
    for (let i = 0; i < 3; i++) c.absorb[i] += tea.absorb[i] * de;
    c.eSum += de;
    b.wet = Math.min(1, b.wet + dt * 0.6); b.boost *= Math.exp(-dt * 1.2);
    if (!G.idealSaid && c.steepSec >= tea.time) { G.idealSaid = true; say(`${fmtTime(tea.time)}. The ${tea.name} is ready when you are. It will carry on without you.`, 5.5); audio.chime(2); }
    if (now - G.lastTick > 1) { G.lastTick = now; audio.tick(); }
    const s = toSim(BAG.group.position.x, BAG.group.position.z, _sim); clampSim(s, 0.7);
    liquid.addSource(s.x, s.y, 0.3, [0, 0, teaRate / 1.6 / 0.09], 0.02);
  }
  if (c.eSum > 0.001) liquid.setTea(c.absorb.map((v) => v / c.eSum), b.tea ? b.tea.absorbAcid : c.tea.absorbAcid);
  else if (b.tea) liquid.setTea(b.tea.absorb, b.tea.absorbAcid);
  // dunking
  if (b.dunk > 0) {
    const before = b.dunk; b.dunk = Math.max(0, b.dunk - dt * 1.9);
    if (before > 0.25 && b.dunk <= 0.25 && c.vol > 0.1) { audio.plop(1.5); bagDrop(0.07); b.boost += 0.9; G.turb = Math.max(G.turb, 0.12); b.e += (1.6 - b.e) * 0.012; }
    if (G.rec.dunks === 6 && b.dunk === 0 && before > 0) say('Six dunks. The bag has asked not to be contacted.');
  }
  // timed dye sources (lemon)
  for (const s of G.timed) { liquid.addSource(s.x, s.y, s.radius, s.rgb, s.push); s.ttl -= dt; }
  G.timed = G.timed.filter((s) => s.ttl > 0);
  // stirring
  const st = G.stir;
  if (st.active && c.vol > 0.05) {
    const px = st.x, py = st.y;
    st.x = damp(st.x, st.tx, 22, dt); st.y = damp(st.y, st.ty, 22, dt);
    const vx = (st.x - px) / Math.max(dt, 1e-3), vy = (st.y - py) / Math.max(dt, 1e-3);
    const r2 = Math.max(0.06, st.x * st.x + st.y * st.y);
    const w = clamp((st.x * vy - st.y * vx) / r2, -9, 9);
    G.omegaT = damp(G.omegaT, w, 3.5, dt);
    st.angle += Math.abs(w) * dt;
    if (st.angle > 6.3) G.rec.stirred = true;
    liquid.spoon.on = 1; liquid.spoon.x = st.x; liquid.spoon.y = st.y; liquid.spoon.vx = vx; liquid.spoon.vy = vy;
    const sp = Math.hypot(vx, vy);
    if (sp > 0.3) liquid.addDrop(st.x, st.y, 0.13, Math.min(0.02, 0.004 * sp));
    liquid.omega = damp(liquid.omega, G.omegaT, 2.2, dt);
  } else {
    liquid.spoon.on = 0; G.omegaT *= Math.exp(-dt * 2);
    liquid.omega *= Math.exp(-dt / 3.4);
  }
  liquid.stars = damp(liquid.stars, c.vol > 0.2 ? smoothstep(2.4, 4.6, Math.abs(liquid.omega)) : 0, 1.8, dt);
  if (liquid.stars > 0.5) { G.galaxyT += dt; if (G.galaxyT > 0.8 && !G.rec.galaxy) { G.rec.galaxy = true; say('For a moment, the cup contains a galaxy. Carry on.', 5); audio.chime(4); } }
  // stroopwafel on the cup
  if (G.wafelOnCup && G.wafelOnCup.state === 'cup') {
    const w = G.wafelOnCup, before = w.warmth;
    w.warmth = Math.min(1, w.warmth + (dt / 11) * smoothstep(40, 75, c.temp));
    if (before < 0.55 && w.warmth >= 0.55) { say('The stroopwafel has softened. Tap it. Now. Before it changes its mind.', 5); audio.note(8); }
  }
  // liquid parameters
  G.turb *= Math.exp(-dt * 2.4);
  liquid.relaxTo.set(c.vol > 0.01 ? clamp(c.milk / c.vol, 0, 1.3) : 0, Math.min(1, c.lemon), c.strength / 1.6);
  liquid.relax = 0.035 + Math.abs(liquid.omega) * 0.32 + G.turb * 1.3;
  liquid.turb = 0.012 + smoothstep(35, 95, c.temp) * 0.04 + G.turb;
  liquid.shimmer = 0.003 + G.turb * 0.05 + Math.abs(liquid.omega) * 0.002;
  liquid.depth = clamp(c.vol, 0.12, 1.1);
  if (c.spill > 0.01) { spill.visible = true; spill.material.opacity = Math.min(0.75, c.spill); }
}

// -------------------------------------------------------- per-frame object poses --
const _bagP = V(), _tagP = V(), _rim = V(), _mid = V();
const spoonQ = new THREE.Quaternion().setFromUnitVectors(V(1, 0, 0), V(-0.32, -0.84, -0.44).normalize());
const spoonHomeQ = SPOON.group.quaternion.clone();
function updateObjects(dt) {
  const c = G.cup, k = G.kettle, b = G.bag, cg = cupI.group;
  // liquid surface follows the cup, even when it leaves the painting
  const y = liquidY(), R = liquidR(), tiltX = cg.rotation.x;
  liquid.mesh.visible = c.vol > 0.012;
  liquid.mesh.scale.set(R, 1, R);
  liquid.mesh.position.set(cg.position.x, cg.position.y + y * Math.cos(tiltX), cg.position.z + y * Math.sin(tiltX));
  liquid.mesh.rotation.x = tiltX;
  // tea bag in the cup: floats high when dry, settles as it soaks
  if (b.state === 'cup' || (b.state === 'flying' && b.drop !== undefined && b.drop < 1)) {
    const floorRest = CUP.floorY + 0.022, floatY = Math.max(floorRest, y - 0.01 - 0.012 * b.wet);
    const dunkUp = Math.sin((1 - b.dunk) * Math.PI) * 0.024 * (b.dunk > 0 ? 1 : 0);
    _bagP.set(cg.position.x - 0.012, cg.position.y + floatY + dunkUp, cg.position.z + 0.004);
    const lean = 0.42;
    if (b.state === 'cup') { BAG.group.position.copy(_bagP); BAG.group.rotation.set(-0.15, 0.5, lean); }
    else { BAG.group.position.lerp(_bagP, 1 - b.drop); BAG.group.rotation.set(-0.15 * (1 - b.drop), 0.5, lean * (1 - b.drop)); }
    // the tag hangs over the rim, toward the viewer
    const a = 2.25;       // angle round the rim
    _rim.set(cg.position.x + Math.cos(a) * (CUP.rimR - 0.001), cg.position.y + CUP.H + 0.0018, cg.position.z + Math.sin(a) * (CUP.rimR - 0.001));
    _tagP.set(cg.position.x + Math.cos(a) * (CUP.rimR + 0.006), cg.position.y + CUP.H - 0.03 + dunkUp * 0.9, cg.position.z + Math.sin(a) * (CUP.rimR + 0.006));
    if (b.state === 'cup') { BAG.tag.position.copy(_tagP); BAG.tag.rotation.set(0.12, -0.55, 0.06); }
    else { BAG.tag.position.lerp(_tagP, 1 - b.drop); BAG.tag.rotation.set(0.12 * (1 - b.drop), lerp(0.3, -0.55, 1 - b.drop), 0); }
  }
  if (BAG.string.mesh.visible) {
    const top = _v.set(0, 0.025, 0).applyEuler(BAG.group.rotation).add(BAG.group.position);
    const tagTop = _mid.set(0, 0.0115, 0).applyEuler(BAG.tag.rotation).add(BAG.tag.position);
    const overRim = b.state === 'cup' ? 1 : (b.state === 'flying' && b.drop !== undefined ? 1 - b.drop : 0);
    const ax = top.x, ay = top.y, az = top.z, bx = tagTop.x, by = tagTop.y, bz = tagTop.z;
    const mx = lerp((ax + bx) / 2, _rim.x, overRim), my = lerp((ay + by) / 2 - (b.state === 'saucer' ? -0.004 : 0.0), _rim.y, overRim), mz = lerp((az + bz) / 2, _rim.z, overRim);
    BAG.string.update((s, out) => {
      const u = 1 - s; // quadratic through the rim point
      out.set(u * u * ax + 2 * u * s * (2 * mx - (ax + bx) / 2) + s * s * bx, u * u * ay + 2 * u * s * (2 * my - (ay + by) / 2) + s * s * by, u * u * az + 2 * u * s * (2 * mz - (az + bz) / 2) + s * s * bz);
    }, () => 0.00045);
    const wet = b.wet, tea = b.tea;
    if (tea) BAG.body.material.color.lerpColors(_c1.set(0xffffff), _c2.setRGB(...wetTint(tea)), wet * 0.85);
  }
  BAG.proxy.userData.off = BAG.proxy2.userData.off = b.state !== 'cup';
  // spoon
  const st = G.stir;
  if (st.active || st.linger > 0) {
    if (!st.active) st.linger -= dt;
    const Rr = Math.max(0.012, R * 0.86);
    _p.set(cg.position.x + st.x * Rr, cg.position.y + Math.max(CUP.floorY + 0.008, y - 0.006), cg.position.z - st.y * Rr);
    _v.set(0.03, 0, 0).applyQuaternion(spoonQ);
    _p.sub(_v);
    SPOON.group.position.lerp(_p, 1 - Math.exp(-dt * 20));
    SPOON.group.quaternion.slerp(spoonQ, 1 - Math.exp(-dt * 14));
    if (!st.active && st.linger <= 0) returnSpoon();
  }
  // kettle
  K.led.material.emissiveIntensity = k.on ? 2.6 + Math.sin(now * 3) * 0.3 : 0;
  K.sw.rotation.z = k.on ? -0.35 : 0.2;
  if (k.on) { K.tilt.position.x = Math.sin(now * 61) * 0.00025 * smoothstep(60, 100, k.temp); K.lid.position.y = Math.abs(Math.sin(now * 23)) * 0.0012 * smoothstep(92, 100, k.temp); }
  // streams
  const d = _dir;
  tipWorld(K, _v); kStream.set(_v, dirOf(K, d), cupHome.y + Math.max(CUP.floorY, y)); kStream.update(dt, now, K.flowing && k.water > 0);
  tipWorld(J, _v); jStream.set(_v, dirOf(J, d), K.home.y + 0.03 + 0.09 * k.water); jStream.update(dt, now, !!J.flowing);
  tipWorld(CR, _v); mStream.set(_v, dirOf(CR, d), cupHome.y + Math.max(CUP.floorY, y)); mStream.update(dt, now, !!CR.flowing);
  // steam
  const lidded = G.wafelOnCup && G.wafelOnCup.state === 'cup';
  cupSteam.mesh.position.set(cg.position.x, cg.position.y + y + 0.004, cg.position.z);
  cupSteam.amount = damp(cupSteam.amount, c.vol > 0.05 && !cupI.busy ? smoothstep(34, 88, c.temp) * (lidded ? 0.12 : 1) * 0.95 : 0, 1.6, dt);
  cupSteam.update(now, camera);
  tipWorld(K, _v); kettleSteam.mesh.position.copy(_v);
  kettleSteam.amount = damp(kettleSteam.amount, k.water > 0.02 ? smoothstep(62, 100, k.temp) * (k.on ? 1 : 0.5) : 0, 1.2, dt);
  kettleSteam.update(now, camera);
  // watch: one revolution is six minutes of tea
  items.watch.hand.rotation.y = -(c.steepSec / 360) * Math.PI * 2;
  audio.kettle(clamp((k.temp - 20) / 80), k.on);
}
const _c1 = new THREE.Color(), _c2 = new THREE.Color(), _dir = V();
function wetTint(tea) { const a = tea.absorb; return [Math.exp(-a[0] * 0.9) * 0.8, Math.exp(-a[1] * 0.9) * 0.78, Math.exp(-a[2] * 0.9) * 0.75]; }
function returnSpoon() {
  const st = G.stir; st.linger = 0;
  const p0 = SPOON.group.position.clone(), q0 = SPOON.group.quaternion.clone();
  SPOON.busy = true;
  tween(0.5, (k) => { SPOON.group.position.lerpVectors(p0, SPOON.home, k); SPOON.group.position.y += Math.sin(k * Math.PI) * 0.05; SPOON.group.quaternion.slerpQuaternions(q0, spoonHomeQ, k); })
    .then(() => { SPOON.busy = false; audio.clink(0.25); });
}

// --------------------------------------------------------------------- camera --
const CAM = {
  wide: { pos: V(0, 0.42, 1.25), tgt: V(0.02, 0.075, 0), halfW: 0.5, narrowW: 0.47 },
  lean: { pos: V(0.0, 0.43, 0.9), tgt: V(0.0, 0.065, 0.05), halfW: 0.36, narrowW: 0.3, narrowX: -0.035 },
  peer: { pos: V(cupHome.x, 0.4, cupHome.z + 0.2), tgt: V(cupHome.x, 0.03, cupHome.z), halfW: 0.09 },
};
const camPos = CAM.wide.pos.clone(), camTgt = CAM.wide.tgt.clone();
const pointer = { nx: 0, ny: 0, x: 0, y: 0 };
let parX = 0, parY = 0;
const _tg = V();
function updateCamera(dt, flat = false) {
  if (phase === 'play') camMode = (J.busy || (G.cup.vol < 0.02 && G.bag.state === 'none' && G.cup.milk < 0.01 && !G.dryCubes.length)) ? 'wide' : 'lean';
  const m = CAM[camMode];
  const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
  const narrow = camera.aspect < 0.8;
  _v.subVectors(m.pos, m.tgt);
  const d = Math.max(_v.length(), (narrow && m.narrowW ? m.narrowW : m.halfW) / tanH);
  _tg.copy(m.tgt); if (narrow && m.narrowX) _tg.x += m.narrowX;
  _v.normalize().multiplyScalar(d).add(_tg);
  const kk = dt > 0 ? 1 - Math.exp(-dt * 1.9) : 0;
  camPos.lerp(_v, kk); camTgt.lerp(_tg, kk);
  parX = flat ? 0 : damp(parX, pointer.nx, 3, dt); parY = flat ? 0 : damp(parY, pointer.ny, 3, dt);
  camera.position.set(camPos.x + parX * 0.035, camPos.y + parY * 0.018 + Math.sin(now * 0.4) * 0.0015, camPos.z);
  camera.lookAt(camTgt);
}

// ---------------------------------------------------------------------- input --
const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
let press = null;
const held = (id) => !!press && press.id === id;
function pickAt(x, y) {
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(world.proxies, false);
  for (const h of hits) if (!h.object.userData.off) return h.object.userData.id;
  return null;
}
const plane = new THREE.Plane(V(0, 1, 0), 0), _hit = V();
function stirTarget(x, y) {
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  plane.constant = -(cupI.group.position.y + liquidY());
  if (!raycaster.ray.intersectPlane(plane, _hit)) return;
  const s = toSim(_hit.x, _hit.z, _sim), l = s.length(), st = G.stir;
  if (l > 0.74) {
    s.multiplyScalar(0.74 / l);
    if (now - (st.lastClink || 0) > 0.22 && Math.hypot(s.x - st.tx, s.y - st.ty) > 0.05) { st.lastClink = now; audio.clink(0.5 + Math.random() * 0.4); }
  }
  st.tx = s.x; st.ty = s.y;
}
const VERBS = { kettle: 'tap: switch · hold: pour', jug: 'hold to fill the kettle', creamer: 'hold to pour', sugar: 'tap for a cube', lemon: 'tap to squeeze', cup: 'tap: sip · circles: stir', bag: 'tap: dunk · hold: lift out', spoon: 'draw circles in the cup', watch: '' };
function tipFor(id) {
  const it = items[id]; if (!it) return '';
  let verb = VERBS[id] ?? '';
  if (id.startsWith('tin:')) verb = 'tap to choose';
  if (id.startsWith('wafel:')) verb = it.state === 'cup' ? (it.warmth > 0.55 ? 'warm — tap to eat' : 'warming… tap to eat anyway') : 'tap';
  return verb ? `${it.name}  ·  ${verb}` : it.name;
}

function onDown(e) {
  if (phase !== 'play' || e.button > 0) return;
  audio.init();
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
  pointer.x = e.clientX; pointer.y = e.clientY;
  const id = pickAt(e.clientX, e.clientY);
  press = { id, x: e.clientX, y: e.clientY, t: now, moved: false, hold: false, stirring: false };
  active(); UI.setTip('');
  if (id === 'jug' || id === 'creamer') { press.hold = true; pourFrom(id, id === 'jug' ? 0.5 : 0.28); }
}
function onMove(e) {
  pointer.x = e.clientX; pointer.y = e.clientY;
  pointer.nx = (e.clientX / innerWidth) * 2 - 1; pointer.ny = -((e.clientY / innerHeight) * 2 - 1);
  if (phase !== 'play') return;
  if (press) {
    active();
    if (!press.moved && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 9) press.moved = true;
    if (press.id === 'cup' && press.moved && !press.hold && !cupI.busy && !G.wafelOnCup && !SPOON.busy) {
      if (!press.stirring) { press.stirring = true; G.stir.active = true; G.stir.linger = 0.7; stirTarget(e.clientX, e.clientY); if (!(G.stir.x || G.stir.y)) { G.stir.x = G.stir.tx; G.stir.y = G.stir.ty; } if (G.cup.vol > 0.05) audio.clink(0.3); }
      stirTarget(e.clientX, e.clientY);
    }
  } else if (e.pointerType === 'mouse') {
    const id = pickAt(e.clientX, e.clientY);
    canvas.classList.toggle('hot', !!id);
    UI.setTip(id ? tipFor(id) : '', e.clientX, e.clientY);
    if (id) active();
  }
}
function onUp() {
  if (!press) return;
  const p = press; press = null;
  if (p.stirring) { G.stir.active = false; G.stir.linger = 0.7; return; }
  if (phase !== 'play' || p.hold || !p.id) return;
  if (now - p.t < 0.6 && !p.moved) tap(p.id);
}
function tap(id) {
  active();
  if (id.startsWith('tin:')) return chooseTea(items[id]);
  if (id.startsWith('wafel:')) return tapWafel(items[id]);
  switch (id) {
    case 'kettle': return toggleKettle();
    case 'sugar': return throwSugar();
    case 'lemon': return squeezeLemon();
    case 'cup': return sip();
    case 'bag': return dunk();
    case 'spoon': return say(G.cup.vol > 0.05 ? 'Draw circles in the cup. The spoon will catch on.' : 'A spoon, waiting for something to stir.');
    case 'watch': G.rec.watchTaps++; return say(G.cup.steepSec > 0 ? `${fmtTime(G.cup.steepSec)} of tea-time. Time runs fast inside paintings.` : 'The watch waits for water. One turn of the hand is six minutes of tea.');
    default: return null;
  }
}
function toggleKettle() {
  const k = G.kettle;
  if (K.flowing) return;
  if (k.water < 0.02) { say('The kettle is empty. Hold the stone jug to fill it.'); audio.click(); return; }
  k.on = !k.on; audio.click();
  if (k.on && k.temp > 97) { k.temp = 96.5; }
  if (k.on) G.tempSaid = false;
}
// holds that begin after a moment: pouring the kettle, lifting the bag
function updateHolds() {
  if (!press || press.hold || press.moved || phase !== 'play') return;
  if (press.id === 'kettle' && now - press.t > 0.24) { press.hold = true; pourFrom('kettle', 0.25); }
  if (press.id === 'bag' && now - press.t > 0.42) { press.hold = true; removeBag(); }
}
canvas.addEventListener('pointerdown', onDown);
window.addEventListener('pointermove', onMove);
window.addEventListener('pointerup', onUp);
window.addEventListener('pointercancel', onUp);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------------------------------------------------------------- hints & hud --
function hintText() {
  if (phase !== 'play') return '';
  if (now < msgUntil) return msg;
  const k = G.kettle, c = G.cup, b = G.bag;
  if (c.poured < 0.02) {
    if (k.water < 0.05) return 'Hold the stoneware jug to fill the kettle.';
    if (!k.on && k.temp < 60) return 'Tap the kettle to switch it on.';
    if (b.state === 'none') return k.on ? 'While it grumbles: tap a tin to choose your tea.' : 'Tap a tin to choose your tea.';
    if (k.on) return b.tea.temp < 99 ? `${b.tea.name} likes ${b.tea.temp}°. Hold the kettle to pour when it feels right.` : 'Wait for the boil. Or do not. Hold the kettle to pour.';
    return 'Hold the kettle to pour.';
  }
  if (c.vol < 0.5 && c.poured < 0.5 && G.rec.sips === 0) return 'Keep holding the kettle. A proper cup is a full cup.';
  if (b.state === 'cup') return 'Steeping. Tap the tag to dunk · hold the tag to lift the bag out.';
  if (G.rec.sips === 0) return 'Hold the creamer for milk · tap sugar, lemon, stroopwafel · draw circles in the cup to stir · tap the cup to sip.';
  return 'Tap the cup to sip. It leaves the painting for a moment; this is normal.';
}
function project(v, out) { _v.copy(v).project(camera); out.x = (_v.x * 0.5 + 0.5) * innerWidth; out.y = (-_v.y * 0.5 + 0.5) * innerHeight; return out; }
const _s2 = { x: 0, y: 0 }, _w = V();
function updateHud() {
  if (phase !== 'play') { UI.setHud('hudKettle', ''); UI.setHud('hudCup', ''); return; }
  const k = G.kettle, c = G.cup, b = G.bag;
  if (k.water > 0.01 && !J.busy) {
    project(_w.copy(K.group.position).setY(K.group.position.y + 0.215), _s2);
    UI.setHud('hudKettle', `${Math.round(k.temp)}°${k.on ? ' <i>heating</i>' : ''} · ${(k.water * 1.0).toFixed(1)} L`, clamp(_s2.x, 80, innerWidth - 80), Math.max(34, _s2.y));
  } else UI.setHud('hudKettle', '');
  if (c.vol > 0.03 && !cupI.busy) {
    project(_w.copy(cupHome).setY(cupTopY + (G.wafelOnCup ? 0.05 : 0.075)), _s2);
    const parts = [];
    if (c.steepSec > 0) parts.push((b.state === 'cup' ? '<i>steeping</i> ' : '') + fmtTime(c.steepSec));
    parts.push(`${Math.round(c.temp)}°`);
    UI.setHud('hudCup', parts.join(' · '), _s2.x, _s2.y);
  } else UI.setHud('hudCup', '');
}

// ----------------------------------------------------------------------- loop --
let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
function resize() {
  const w = innerWidth, h = innerHeight;
  const W = Math.max(2, Math.round(w * pixelRatio)), H = Math.max(2, Math.round(h * pixelRatio));
  renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  post.setSize(W, H, pixelRatio);
  camera.aspect = w / h; camera.fov = w / h < 0.8 ? 40 : 30; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
camPos.copy(CAM.wide.pos);

function update(dt) {
  now += dt;
  const fw = frameWaiters; frameWaiters = []; for (const r of fw) r(dt);
  updateTweens(dt);
  updateHolds();
  if (phase === 'play' || phase === 'reading') simulate(dt);
  updateObjects(dt);
  updateCamera(dt);
  liquid.step(dt, now);
  if (tweensActive() || K.flowing || J.flowing || CR.flowing || G.stir.active) active();
  // idle: the paint dries. touch: it wakes.
  const idle = now - lastActive;
  const target = phase === 'title' ? 1 : phase === 'placard' ? 0.9 : phase === 'reading' ? 0.3 : (idle < 2.6 ? 0 : 0.74);
  post.paint = damp(post.paint, target, target < post.paint ? 5 : 0.55, dt);
  UI.setHint(hintText());
  updateHud();
}
function renderFrame() { post.render(scene, camera, now); }

let last = performance.now(), slow = 0, frames = 0;
function loop(t) {
  const real = (t - last) / 1000; last = t;
  const dt = Math.min(0.05, Math.max(0.001, real));
  update(dt); renderFrame();
  // if the machine is struggling, quietly paint on a smaller canvas
  frames++;
  if (frames > 40 && !document.hidden) { slow = real > 0.034 ? slow + 1 : Math.max(0, slow - 2); if (slow > 45 && pixelRatio > 0.7) { pixelRatio = Math.max(0.7, pixelRatio - 0.25); slow = 0; resize(); } }
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------------- ui --
function begin() {
  if (phase !== 'title') return;
  audio.init();
  phase = 'play'; G.startAt = now; active();
  UI.hide('title');
  document.getElementById('bar').hidden = false;
  document.getElementById('btnFinish').hidden = false;
}
UI.on('btnBegin', begin);
UI.on('btnFinish', finish);
UI.on('btnAgain', newCanvas);
UI.on('btnSave', () => UI.saveCard());
UI.on('btnShare', async (e) => { const r = await UI.shareCard(); if (r === 'copied') { const b = e.target; b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Share'; }, 1600); } });
UI.on('btnGallery', () => UI.showGallery());
UI.on('btnHelp', () => UI.show('help'));
UI.on('btnSound', (e) => { audio.init(); audio.setMuted(!audio.muted); e.currentTarget.classList.toggle('off', audio.muted); });
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => UI.hide(b.closest('.overlay').id)));
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && phase === 'title') begin();
  if (e.key === 'm') document.getElementById('btnSound').click();
  if (e.key === 'Escape') for (const id of ['help', 'gallery']) UI.hide(id);
});
if (query.has('mute')) { audio.setMuted(true); document.getElementById('btnSound').classList.add('off'); }

// labels on the tins use the display serif; redraw them once it has arrived
if (document.fonts && document.fonts.load) {
  Promise.race([document.fonts.load('600 40px "Cormorant Garamond"'), new Promise((r) => setTimeout(r, 2500))]).then(() => {
    if (!document.fonts.check('600 40px "Cormorant Garamond"')) return;
    for (const tin of world.tins) { const m = tin.group.children[0].material; m.map.dispose(); m.map = TX.tinLabel(tin.tea); m.needsUpdate = true; }
  }).catch(() => {});
}

// test hooks: drive the painting without a human
window.__steep = {
  get G() { return G; }, get phase() { return phase; }, world, liquid, post, camera, items,
  begin, tap, finish, newCanvas, record, sip,
  press(id) { press = { id, x: 0, y: 0, t: now, moved: false, hold: false, stirring: false }; if (id === 'jug' || id === 'creamer') { press.hold = true; pourFrom(id, 0.3); } },
  release() { onUp(); },
  stir(on, x = 0, y = 0) { G.stir.active = on; G.stir.tx = x; G.stir.ty = y; if (!on) G.stir.linger = 0.5; },
  async advance(seconds, step = 1 / 30, each = null) {
    for (let t = 0; t < seconds; t += step) { if (each) each(t); update(step); await null; await null; await null; }
    renderFrame();
  },
  render: renderFrame,
};

update(0.016); renderFrame();
if (query.has('skip')) begin();
if (!MANUAL) requestAnimationFrame((t) => { last = t; requestAnimationFrame(loop); });
window.__ready = true;
