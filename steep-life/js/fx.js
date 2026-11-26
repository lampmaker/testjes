// Steam and poured streams.
import * as THREE from '../vendor/three.module.js';
import { DynamicTube } from './scene.js';

const STEAM_FRAG = /* glsl */`
varying vec2 vUv; uniform float uTime, uAmount, uSeed, uSpread; uniform vec3 uColor;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
void main() {
  float t = uTime * 0.22 + uSeed;
  vec2 q = vec2(vUv.x - 0.5, vUv.y);
  // the plume leans and curls as it climbs
  vec2 warp = vec2(fbm(q * 2.6 + vec2(0.0, -t * 1.9)), fbm(q * 2.6 + vec2(4.7, -t * 2.2))) - 0.5;
  vec2 s = q + warp * vec2(0.34, 0.12) * (0.25 + vUv.y);
  s.x += sin(vUv.y * 3.2 + t * 1.6) * 0.05 * vUv.y;
  float dens = fbm(vec2(s.x * 5.5, s.y * 2.6 - t * 3.1) + warp);
  dens = smoothstep(0.34, 0.82, dens);
  float wisps = fbm(vec2(s.x * 13.0, s.y * 5.0 - t * 4.6));
  dens *= 0.55 + 0.75 * wisps;
  float width = mix(0.07, 0.4, pow(vUv.y, 0.8)) * uSpread;
  float mask = smoothstep(width, width * 0.15, abs(s.x)) * smoothstep(0.0, 0.07, vUv.y) * smoothstep(1.0, 0.3, vUv.y);
  float a = dens * mask * uAmount;
  gl_FragColor = vec4(uColor * (0.75 + 0.5 * wisps), clamp(a, 0.0, 1.0));
}`;

export class Steam {
  constructor(width, height, seed = 0, spread = 1) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: STEAM_FRAG, transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uAmount: { value: 0 }, uSeed: { value: seed }, uSpread: { value: spread }, uColor: { value: new THREE.Color().setRGB(1.5, 1.32, 1.08) } },
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height).translate(0, height / 2, 0), this.material);
    this.mesh.renderOrder = 5;
    this.amount = 0;
  }
  update(time, camera) {
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uAmount.value = this.amount;
    this.mesh.visible = this.amount > 0.005;
    // upright billboard
    this.mesh.rotation.y = Math.atan2(camera.position.x - this.mesh.position.x, camera.position.z - this.mesh.position.z);
  }
}

// A falling thread of liquid from a spout to wherever it lands.
export class Stream {
  constructor(material, radius = 0.003) {
    this.tube = new DynamicTube(material, 18, 8);
    this.mesh = this.tube.mesh; this.mesh.visible = false; this.mesh.castShadow = true;
    this.radius = radius; this.flow = 0;               // 0..1, eased
    this.from = new THREE.Vector3(); this.dir = new THREE.Vector3(1, 0, 0); this.endY = 0;
    this.hit = new THREE.Vector3();
    this.speed = 0.22;
  }
  // from: spout tip, dir: horizontal pour direction, endY: where the liquid lands
  set(from, dir, endY) { this.from.copy(from); this.dir.copy(dir).setY(0).normalize(); this.endY = endY; }
  update(dt, time, on) {
    this.flow += ((on ? 1 : 0) - this.flow) * Math.min(1, dt * 9);
    this.mesh.visible = this.flow > 0.03;
    const g = 9.8, drop = Math.max(0.005, this.from.y - this.endY), T = Math.sqrt(2 * drop / g), v = this.speed;
    this.hit.set(this.from.x + this.dir.x * v * T, this.endY, this.from.z + this.dir.z * v * T);
    if (!this.mesh.visible) return;
    const { from, dir } = this, flow = this.flow, R = this.radius;
    this.tube.update((s, out) => {
      const t = s * T;
      const wob = Math.sin(time * 31 + s * 9) * 0.0006 * s;
      out.set(from.x + dir.x * v * t + wob, from.y - 0.5 * g * t * t, from.z + dir.z * v * t - wob);
    }, (s) => R * flow * (1 - 0.5 * s) * (0.92 + 0.08 * Math.sin(time * 43 + s * 17)));
  }
}
