// Post-processing: HDR scene -> bloom -> filmic grade -> the "oil" pass,
// which lets the photoreal render dry into a painting when nobody touches it.
import * as THREE from '../vendor/three.module.js';

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export class FullScreen {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }
  static material(fragmentShader, uniforms) {
    return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false });
  }
  render(renderer, material, target = null) {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
  }
}

const DOWN = /* glsl */`
varying vec2 vUv; uniform sampler2D tMap; uniform vec2 uTexel; uniform float uThreshold;
void main() {
  vec3 c = texture2D(tMap, vUv + uTexel * vec2(-1., -1.)).rgb + texture2D(tMap, vUv + uTexel * vec2(1., -1.)).rgb
         + texture2D(tMap, vUv + uTexel * vec2(-1., 1.)).rgb + texture2D(tMap, vUv + uTexel * vec2(1., 1.)).rgb;
  c *= 0.25;
  if (uThreshold > 0.0) {
    float l = max(c.r, max(c.g, c.b));
    c *= smoothstep(uThreshold * 0.6, uThreshold * 1.6, l);
    c = min(c, vec3(12.0));
  }
  gl_FragColor = vec4(c, 1.0);
}`;

const UP = /* glsl */`
varying vec2 vUv; uniform sampler2D tLow; uniform sampler2D tCur; uniform vec2 uTexel;
void main() {
  vec3 c = texture2D(tLow, vUv + uTexel * vec2(-1., -1.)).rgb + texture2D(tLow, vUv + uTexel * vec2(1., -1.)).rgb
         + texture2D(tLow, vUv + uTexel * vec2(-1., 1.)).rgb + texture2D(tLow, vUv + uTexel * vec2(1., 1.)).rgb;
  gl_FragColor = vec4(c * 0.25 * 0.85 + texture2D(tCur, vUv).rgb, 1.0);
}`;

const GRADE = /* glsl */`
varying vec2 vUv; uniform sampler2D tScene; uniform sampler2D tBloom; uniform float uExposure; uniform float uBloom;
vec3 aces(vec3 x) {
  // Stephen Hill's fit of the ACES RRT+ODT
  const mat3 inM = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 outM = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  x = inM * x;
  vec3 a = x * (x + 0.0245786) - 0.000090537;
  vec3 b = x * (0.983729 * x + 0.4329510) + 0.238081;
  return clamp(outM * (a / b), 0.0, 1.0);
}
void main() {
  vec3 c = texture2D(tScene, vUv).rgb + texture2D(tBloom, vUv).rgb * uBloom;
  c = aces(c * uExposure);
  // old-master grade: umber shadows, candle-warm lights
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(c, c * vec3(1.06, 0.98, 0.86), smoothstep(0.0, 0.5, l) * 0.55);
  c += vec3(0.020, 0.012, 0.004) * (1.0 - smoothstep(0.0, 0.3, l));
  c = mix(vec3(l), c, 1.08);
  c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
  gl_FragColor = vec4(c, 1.0);
}`;

const PAINT = /* glsl */`
varying vec2 vUv; uniform sampler2D tMap; uniform vec2 uRes; uniform float uPaint; uniform float uTime; uniform float uPx; uniform float uFade;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
// distance to the nearest crack in a field of drying varnish
float cracks(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 9.0, d2 = 9.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = vec2(hash(i + g), hash(i + g + 17.3));
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return d2 - d1;
}
vec3 kuwahara(vec2 uv, float rad) {
  vec2 px = 1.0 / uRes;
  // brush direction wanders across the canvas
  float ang = vnoise(uv * vec2(uRes.x / uRes.y, 1.0) * 5.0) * 6.2832;
  mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
  vec3 acc = vec3(0.0); float wsum = 0.0;
  for (int k = 0; k < 4; k++) {
    vec2 sg = vec2((k == 0 || k == 3) ? -1.0 : 1.0, k < 2 ? -1.0 : 1.0);
    vec3 mean = vec3(0.0), sq = vec3(0.0);
    for (int i = 0; i < 3; i++) for (int j = 0; j < 3; j++) {
      vec2 o = rot * (vec2(float(i), float(j)) * rad * 0.5 * sg);
      vec3 c = texture2D(tMap, uv + o * px).rgb;
      mean += c; sq += c * c;
    }
    mean /= 9.0; sq = abs(sq / 9.0 - mean * mean);
    float var = sq.r + sq.g + sq.b;
    float w = 1.0 / (1.0 + pow(var * 1400.0, 3.0));
    acc += mean * w; wsum += w;
  }
  return acc / wsum;
}
void main() {
  vec3 src = texture2D(tMap, vUv).rgb;
  vec3 c = src;
  vec2 cuv = vUv * uRes / uPx;      // css-pixel space, so the canvas grain is the same size on every screen
  if (uPaint > 0.01) {
    float rad = uPaint * min(uRes.x * 0.62, uRes.y) / 190.0;
    vec3 k = kuwahara(vUv, rad);
    c = mix(src, k, clamp(uPaint * 1.6, 0.0, 1.0));
    // a little impasto: light catches the ridges of thick paint
    float lum = dot(c, vec3(0.3, 0.6, 0.1));
    float ridge = vnoise(cuv * 0.33 + lum * 3.0) - vnoise(cuv * 0.33 + lum * 3.0 + vec2(-0.8, 0.8));
    c += ridge * 0.085 * uPaint * (0.25 + lum);
    // linen weave
    float weave = sin(cuv.x * 2.1) * sin(cuv.y * 2.1);
    c *= 1.0 + weave * 0.05 * uPaint;
    // craquelure, in patches, mostly where the paint is light and thick
    float blotch = smoothstep(0.5, 0.78, vnoise(cuv * 0.005 + 3.1));
    float cr = cracks(cuv * 0.045 + vnoise(cuv * 0.02) * 0.6);
    float line = (1.0 - smoothstep(0.0, 0.03, cr)) * blotch * uPaint;
    c *= 1.0 - line * (0.1 + 0.2 * lum);
    // aged varnish
    c = mix(c, c * vec3(1.03, 0.985, 0.9), uPaint * 0.6);
  }
  // vignette: the corners of old paintings sink into the ground colour
  vec2 q = vUv - 0.5;
  float vig = smoothstep(0.86, 0.28, length(q * vec2(1.05, 1.18)));
  c *= mix(0.42, 1.0, vig);
  // grain
  c += (hash(cuv + fract(uTime) * 91.7) - 0.5) * 0.022;
  c *= uFade;
  gl_FragColor = vec4(c, 1.0);
}`;

export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    this.fs = new FullScreen();
    this.paint = 1; this.exposure = 0.88; this.bloom = 0.16; this.fade = 1;
    this.mDown = FullScreen.material(DOWN, { tMap: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0 } });
    this.mUp = FullScreen.material(UP, { tLow: { value: null }, tCur: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.mGrade = FullScreen.material(GRADE, { tScene: { value: null }, tBloom: { value: null }, uExposure: { value: 1 }, uBloom: { value: 0.2 } });
    this.mPaint = FullScreen.material(PAINT, { tMap: { value: null }, uRes: { value: new THREE.Vector2() }, uPaint: { value: 0 }, uTime: { value: 0 }, uPx: { value: 1 }, uFade: { value: 1 } });
    this.sceneRT = null; this.ldr = null; this.down = []; this.up = [];
  }
  setSize(w, h, px) {
    this.w = w; this.h = h; this.px = px;
    const dispose = (t) => t && t.dispose();
    dispose(this.sceneRT); dispose(this.ldr); this.down.forEach(dispose); this.up.forEach(dispose);
    const hdr = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, { ...hdr, depthBuffer: true, samples: 4 });
    this.ldr = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    this.down = []; this.up = [];
    let cw = w, ch = h;
    for (let i = 0; i < 5; i++) {
      cw = Math.max(2, Math.floor(cw / 2)); ch = Math.max(2, Math.floor(ch / 2));
      this.down.push(new THREE.WebGLRenderTarget(cw, ch, hdr));
      if (i < 4) this.up.push(new THREE.WebGLRenderTarget(cw, ch, hdr));
    }
  }
  render(scene, camera, time) {
    const r = this.renderer, fs = this.fs;
    r.setRenderTarget(this.sceneRT);
    r.render(scene, camera);
    // bloom pyramid
    let src = this.sceneRT;
    for (let i = 0; i < this.down.length; i++) {
      const d = this.down[i];
      this.mDown.uniforms.tMap.value = src.texture;
      this.mDown.uniforms.uTexel.value.set(0.5 / d.width, 0.5 / d.height);
      this.mDown.uniforms.uThreshold.value = i === 0 ? 1.7 : 0;
      fs.render(r, this.mDown, d);
      src = d;
    }
    let low = this.down[this.down.length - 1];
    for (let i = this.up.length - 1; i >= 0; i--) {
      this.mUp.uniforms.tLow.value = low.texture;
      this.mUp.uniforms.tCur.value = this.down[i].texture;
      this.mUp.uniforms.uTexel.value.set(0.5 / low.width, 0.5 / low.height);
      fs.render(r, this.mUp, this.up[i]);
      low = this.up[i];
    }
    this.mGrade.uniforms.tScene.value = this.sceneRT.texture;
    this.mGrade.uniforms.tBloom.value = low.texture;
    this.mGrade.uniforms.uExposure.value = this.exposure;
    this.mGrade.uniforms.uBloom.value = this.bloom;
    fs.render(r, this.mGrade, this.ldr);
    const u = this.mPaint.uniforms;
    u.tMap.value = this.ldr.texture; u.uRes.value.set(this.w, this.h); u.uPaint.value = this.paint;
    u.uTime.value = time; u.uPx.value = this.px; u.uFade.value = this.fade;
    fs.render(r, this.mPaint, null);
  }
}
