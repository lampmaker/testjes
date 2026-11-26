// The surface of the tea. A small GPU simulation:
//   dye   (R milk, G lemon, B tea liquor)  advected by an analytic swirl + curl field
//   waves (heightfield ripples)             from pours, plops and spoons
// composed each frame into an albedo and a normal map for a physical material.
import * as THREE from '../vendor/three.module.js';
import { FullScreen } from './post.js';

const DYE = /* glsl */`
varying vec2 vUv;
uniform sampler2D tPrev; uniform float uDt, uTime, uOmega, uTurb, uDiff, uRelax;
uniform vec3 uRelaxTo; uniform vec2 uSpoon, uSpoonVel; uniform float uSpoonOn;
uniform vec4 uSrcPos[3];   // x, y, radius, outward push
uniform vec4 uSrcVal[3];   // rgb added per second
vec2 curl(vec2 p, float t) {
  vec2 v = vec2(0.0); float c;
  c = cos( 3.1 * p.x + 1.7 * p.y + 0.31 * t      ) * 0.30; v += vec2( 1.7, -3.1) * c;
  c = cos(-2.3 * p.x + 3.9 * p.y + 0.23 * t + 1.3) * 0.22; v += vec2( 3.9,  2.3) * c;
  c = cos( 5.3 * p.x - 4.1 * p.y + 0.41 * t + 2.1) * 0.13; v += vec2(-4.1, -5.3) * c;
  c = cos(-6.7 * p.x - 5.9 * p.y + 0.37 * t + 4.2) * 0.09; v += vec2(-5.9,  6.7) * c;
  c = cos( 9.1 * p.x + 7.3 * p.y + 0.53 * t + 0.7) * 0.05; v += vec2( 7.3, -9.1) * c;
  return v;
}
vec2 velocity(vec2 p) {
  float r = length(p);
  vec2 v = uTurb * curl(p, uTime);
  v += uSpoonOn * uSpoonVel * exp(-dot(p - uSpoon, p - uSpoon) / 0.09) * 0.9;
  for (int i = 0; i < 3; i++) {
    vec2 d = p - uSrcPos[i].xy; float l = length(d) + 1e-4;
    v += (d / l) * uSrcPos[i].w * exp(-l * l / (uSrcPos[i].z * uSrcPos[i].z * 6.0));
  }
  v *= smoothstep(1.0, 0.78, r);
  // the cup turns as one body in the middle, drags at the wall: spirals follow
  v += uOmega * (1.25 - r * r) * vec2(-p.y, p.x);
  return v;
}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  vec2 q = p - uDt * velocity(p);
  float rq = length(q); if (rq > 0.985) q *= 0.985 / rq;
  vec2 uv = q * 0.5 + 0.5;
  vec2 e = vec2(1.0 / 256.0, 0.0);
  vec4 d = texture2D(tPrev, uv);
  vec4 avg = 0.25 * (texture2D(tPrev, uv + e.xy) + texture2D(tPrev, uv - e.xy) + texture2D(tPrev, uv + e.yx) + texture2D(tPrev, uv - e.yx));
  d = mix(d, avg, uDiff);
  for (int i = 0; i < 3; i++) {
    vec2 s = p - uSrcPos[i].xy;
    d.rgb += uSrcVal[i].rgb * uDt * exp(-dot(s, s) / (uSrcPos[i].z * uSrcPos[i].z));
  }
  d.rgb += (uRelaxTo - d.rgb) * uRelax;
  gl_FragColor = max(d, 0.0);
}`;

const WAVE = /* glsl */`
varying vec2 vUv; uniform sampler2D tPrev; uniform vec4 uDrop[4]; uniform float uTexel;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  vec4 c = texture2D(tPrev, vUv);
  float n = texture2D(tPrev, vUv + vec2(0.0, uTexel)).r, s = texture2D(tPrev, vUv - vec2(0.0, uTexel)).r;
  float e = texture2D(tPrev, vUv + vec2(uTexel, 0.0)).r, w = texture2D(tPrev, vUv - vec2(uTexel, 0.0)).r;
  float h = 2.0 * c.r - c.g + 0.42 * (n + s + e + w - 4.0 * c.r);
  h *= 0.988;
  for (int i = 0; i < 4; i++) {
    vec2 d = p - uDrop[i].xy;
    h += uDrop[i].w * exp(-dot(d, d) / (uDrop[i].z * uDrop[i].z));
  }
  h *= smoothstep(1.04, 0.96, length(p));   // the wall soaks up what it does not reflect
  gl_FragColor = vec4(h, c.r, 0.0, 1.0);
}`;

const NORMAL = /* glsl */`
varying vec2 vUv; uniform sampler2D tWave; uniform float uTexel; uniform float uTime; uniform float uShimmer;
void main() {
  float n = texture2D(tWave, vUv + vec2(0.0, uTexel)).r, s = texture2D(tWave, vUv - vec2(0.0, uTexel)).r;
  float e = texture2D(tWave, vUv + vec2(uTexel, 0.0)).r, w = texture2D(tWave, vUv - vec2(uTexel, 0.0)).r;
  vec2 p = vUv * 2.0 - 1.0;
  // a faint living shimmer so the surface is never a dead mirror
  vec2 sh = vec2(sin(p.y * 9.0 + uTime * 1.3) + sin(p.x * 6.0 - uTime * 0.9), cos(p.x * 8.0 + uTime * 1.1) + sin(p.y * 5.0 + uTime * 0.7)) * uShimmer;
  // meniscus: the liquid climbs the porcelain
  float r = length(p);
  vec2 men = (p / max(r, 1e-3)) * smoothstep(0.9, 1.0, r) * 0.55;
  vec3 nn = normalize(vec3((w - e) * 2.6 + sh.x - men.x, (s - n) * 2.6 + sh.y - men.y, 1.0));
  gl_FragColor = vec4(nn * 0.5 + 0.5, 1.0);
}`;

const COMPOSE = /* glsl */`
varying vec2 vUv; uniform sampler2D tDye; uniform vec3 uAbsorb, uAbsorbAcid, uPorcelain;
uniform float uDepth, uStars, uPhase, uTime;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float starLayer(vec2 p, float ang) {
  float r = length(p);
  float a = ang * (1.25 - r * r);
  vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * p * 34.0;
  vec2 i = floor(q), f = fract(q) - 0.5;
  float h = hash(i);
  vec2 o = (vec2(hash(i + 3.1), hash(i + 7.7)) - 0.5) * 0.6;
  float tw = 0.6 + 0.4 * sin(uTime * (2.0 + h * 5.0) + h * 40.0);
  return step(0.86, h) * smoothstep(0.16, 0.0, length(f - o)) * tw * (0.4 + 0.6 * hash(i + 11.3));
}
void main() {
  vec2 p = vUv * 2.0 - 1.0; float r = length(p);
  vec4 d = texture2D(tDye, vUv);
  float milk = d.r, acid = clamp(d.g, 0.0, 1.0), tea = d.b * 1.6;
  float bowl = 0.2 + 0.8 * sqrt(max(0.0, 1.0 - r * r * 0.94));
  float depth = uDepth * bowl;
  vec3 ab = mix(uAbsorb, uAbsorbAcid, smoothstep(0.0, 0.55, acid));
  vec3 trans = exp(-ab * tea * depth * 1.9);
  vec3 col = uPorcelain * mix(vec3(1.0), vec3(0.78, 0.9, 0.93), depth * 0.55) * trans;
  // milk scatters: the liquor goes opaque and creamy
  vec3 cream = vec3(0.95, 0.9, 0.8) * exp(-ab * tea * 0.17);
  float m = 1.0 - exp(-milk * 3.4);
  // lemon meets milk: it curdles, in a refined way
  float curd = smoothstep(0.02, 0.12, milk * acid);
  float fleck = step(0.45, hash(floor(p * 38.0 + 3.0 * vec2(sin(uTime * 0.2), cos(uTime * 0.17)))));
  m = mix(m, m * (0.35 + 0.95 * fleck), curd);
  col = mix(col, cream, clamp(m, 0.0, 1.0));
  // when stirred, the cup briefly contains a galaxy (two cross-faded layers that shear with the flow)
  if (uStars > 0.003) {
    float A = 2.4, t = uPhase / A;
    float f1 = fract(t), f2 = fract(t + 0.5);
    float s = starLayer(p, (f1 - 0.5) * A) * (1.0 - abs(f1 * 2.0 - 1.0)) + starLayer(p * 1.07 + 0.3, (f2 - 0.5) * A) * (1.0 - abs(f2 * 2.0 - 1.0));
    float dark = 1.0 - smoothstep(0.05, 0.5, dot(col, vec3(0.33)));
    col += vec3(1.0, 0.93, 0.78) * s * uStars * (0.35 + 0.65 * dark) * 9.0 * smoothstep(1.0, 0.8, r);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class Liquid {
  constructor(renderer) {
    this.renderer = renderer;
    this.fs = new FullScreen();
    const half = (n, filter = THREE.LinearFilter) => new THREE.WebGLRenderTarget(n, n, { type: THREE.HalfFloatType, minFilter: filter, magFilter: filter, depthBuffer: false });
    this.dye = [half(256), half(256)];
    this.wave = [half(96), half(96)];
    this.albedo = half(256);
    this.normal = new THREE.WebGLRenderTarget(192, 192, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    const v4 = () => new THREE.Vector4(0, 0, 0.1, 0);
    this.mDye = FullScreen.material(DYE, {
      tPrev: { value: null }, uDt: { value: 0 }, uTime: { value: 0 }, uOmega: { value: 0 }, uTurb: { value: 0.02 }, uDiff: { value: 0.02 }, uRelax: { value: 0 },
      uRelaxTo: { value: new THREE.Vector3() }, uSpoon: { value: new THREE.Vector2() }, uSpoonVel: { value: new THREE.Vector2() }, uSpoonOn: { value: 0 },
      uSrcPos: { value: [v4(), v4(), v4()] }, uSrcVal: { value: [v4(), v4(), v4()] },
    });
    this.mWave = FullScreen.material(WAVE, { tPrev: { value: null }, uDrop: { value: [v4(), v4(), v4(), v4()] }, uTexel: { value: 1 / 96 } });
    this.mNormal = FullScreen.material(NORMAL, { tWave: { value: null }, uTexel: { value: 1 / 96 }, uTime: { value: 0 }, uShimmer: { value: 0.004 } });
    this.mCompose = FullScreen.material(COMPOSE, {
      tDye: { value: null }, uAbsorb: { value: new THREE.Vector3(0.5, 1.5, 4) }, uAbsorbAcid: { value: new THREE.Vector3(0.4, 1.2, 3.5) },
      uPorcelain: { value: new THREE.Vector3(0.9, 0.88, 0.83) }, uDepth: { value: 1 }, uStars: { value: 0 }, uPhase: { value: 0 }, uTime: { value: 0 },
    });
    this.material = new THREE.MeshPhysicalMaterial({
      map: this.albedo.texture, normalMap: this.normal.texture, normalScale: new THREE.Vector2(1, 1),
      roughness: 0.02, metalness: 0, ior: 1.34, specularIntensity: 1, envMapIntensity: 1.6,
      emissive: 0xffffff, emissiveMap: this.albedo.texture, emissiveIntensity: 0.07,
    });
    this.mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 72).rotateX(-Math.PI / 2), this.material);
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
    // simulation parameters, set by the game each frame
    this.omega = 0; this.turb = 0.02; this.relax = 0; this.relaxTo = new THREE.Vector3();
    this.spoon = { on: 0, x: 0, y: 0, vx: 0, vy: 0 };
    this.phase = 0; this.stars = 0; this.depth = 1; this.shimmer = 0.004;
    this.sources = []; this.drops = [];
    this.reset();
  }
  reset() {
    const r = this.renderer, prev = r.getRenderTarget(), cc = new THREE.Color(); r.getClearColor(cc); const ca = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    for (const t of [...this.dye, ...this.wave]) { r.setRenderTarget(t); r.clear(); }
    r.setClearColor(cc, ca); r.setRenderTarget(prev);
    this.omega = 0; this.phase = 0; this.stars = 0;
  }
  setTea(absorb, absorbAcid) {
    this.mCompose.uniforms.uAbsorb.value.fromArray(absorb);
    this.mCompose.uniforms.uAbsorbAcid.value.fromArray(absorbAcid);
  }
  // p in disc coordinates (-1..1). rgb = dye per second. push = outward billow.
  addSource(x, y, radius, rgb, push = 0) { if (this.sources.length < 3) this.sources.push({ x, y, radius, rgb, push }); }
  addDrop(x, y, radius, strength) { if (this.drops.length < 4) this.drops.push({ x, y, radius, strength }); }

  step(dt, time) {
    const r = this.renderer, fs = this.fs;
    const prevTarget = r.getRenderTarget();
    this.phase += this.omega * dt;
    // dye
    const u = this.mDye.uniforms;
    u.tPrev.value = this.dye[0].texture; u.uDt.value = dt; u.uTime.value = time;
    u.uOmega.value = this.omega; u.uTurb.value = this.turb; u.uRelax.value = Math.min(0.5, this.relax * dt); u.uRelaxTo.value.copy(this.relaxTo);
    u.uDiff.value = Math.min(0.5, 0.012 + Math.abs(this.omega) * 0.012 + this.turb * 0.05);
    u.uSpoon.value.set(this.spoon.x, this.spoon.y); u.uSpoonVel.value.set(this.spoon.vx, this.spoon.vy); u.uSpoonOn.value = this.spoon.on;
    for (let i = 0; i < 3; i++) {
      const s = this.sources[i];
      if (s) { u.uSrcPos.value[i].set(s.x, s.y, s.radius, s.push); u.uSrcVal.value[i].set(s.rgb[0], s.rgb[1], s.rgb[2], 0); }
      else { u.uSrcPos.value[i].set(0, 0, 0.1, 0); u.uSrcVal.value[i].set(0, 0, 0, 0); }
    }
    fs.render(r, this.mDye, this.dye[1]); this.dye.reverse();
    // waves: a few substeps so ripples cross the cup briskly
    const steps = Math.max(1, Math.min(5, Math.round(dt * 170)));
    for (let k = 0; k < steps; k++) {
      const w = this.mWave.uniforms;
      w.tPrev.value = this.wave[0].texture;
      for (let i = 0; i < 4; i++) {
        const d = k === 0 ? this.drops[i] : null;
        if (d) w.uDrop.value[i].set(d.x, d.y, d.radius, d.strength); else w.uDrop.value[i].set(0, 0, 0.1, 0);
      }
      fs.render(r, this.mWave, this.wave[1]); this.wave.reverse();
    }
    this.sources.length = 0; this.drops.length = 0;
    // compose
    const n = this.mNormal.uniforms; n.tWave.value = this.wave[0].texture; n.uTime.value = time; n.uShimmer.value = this.shimmer;
    fs.render(r, this.mNormal, this.normal);
    const c = this.mCompose.uniforms; c.tDye.value = this.dye[0].texture; c.uDepth.value = this.depth; c.uStars.value = this.stars; c.uPhase.value = this.phase; c.uTime.value = time;
    fs.render(r, this.mCompose, this.albedo);
    r.setRenderTarget(prevTarget);
  }
}
