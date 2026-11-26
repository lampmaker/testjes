// The still life itself: table, cloth, light, and every object upon it.
import * as THREE from '../vendor/three.module.js';
import * as TX from './textures.js';
import { TEAS } from './teas.js';
import { mulberry } from './util.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const V2 = (x, y) => new THREE.Vector2(x, y);

// ---------------------------------------------------------------- dimensions --
export const CUP = { H: 0.06, rimR: 0.043, wall: 0.0026, floorY: 0.0085, fullY: 0.052 };
export function cupOuterR(y) {
  if (y < 0.005) return 0.0205 - 0.001 * Math.sin((y / 0.005) * Math.PI * 0.5);
  const t = Math.min(1, (y - 0.005) / (CUP.H - 0.005));
  const flare = 0.0016 * Math.max(0, (t - 0.82) / 0.18) ** 2;
  return 0.0195 + (CUP.rimR - 0.0195 - 0.0016) * Math.pow(Math.sin(t * Math.PI / 2), 0.75) + flare;
}
export const cupInnerR = (y) => cupOuterR(Math.max(y, CUP.floorY)) - CUP.wall;
// liquid level for a volume fraction (1 = a properly full cup)
export const cupLevelY = (vol) => CUP.floorY + (CUP.fullY - CUP.floorY) * Math.pow(Math.max(0, vol), 0.82);

export const LAYOUT = {
  cup: V3(-0.04, 0, 0.13),
  kettle: V3(0.225, 0, -0.065),
  jug: V3(0.4, 0, -0.21),
  creamer: V3(-0.205, 0, 0.075),
  sugar: V3(-0.325, 0, -0.01),
  plate: V3(0.245, 0, 0.215),
  lemon: V3(0.055, 0, 0.3),
  spoon: V3(-0.15, 0, 0.285),
  watch: V3(-0.3, 0, 0.215),
  tins: [V3(-0.385, 0, -0.2), V3(-0.292, 0, -0.262), V3(-0.196, 0, -0.218), V3(-0.1, 0, -0.268), V3(-0.006, 0, -0.226)],
  clothRight: 0.135,
  tableFront: 0.4,
};
const CLOTH_Y = 0.0022;
export const surfaceY = (x) => (x < LAYOUT.clothRight - 0.01 ? CLOTH_Y : 0);

// -------------------------------------------------------------------- helpers --
function lathe(points, segs = 72) {
  return new THREE.LatheGeometry(points.map((p) => V2(p[0], p[1])), segs);
}

// A tube with a radius that may vary along its length.
function taperTube(curve, r0, r1, segs = 32, radial = 10) {
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [], nor = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, p = curve.getPointAt(t), r = r0 + (r1 - r0) * t;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const n = frames.normals[i].clone().multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a));
      pos.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r); nor.push(n.x, n.y, n.z);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

function shadowed(mesh, cast = true, receive = true) {
  mesh.castShadow = cast; mesh.receiveShadow = receive;
  return mesh;
}

// A tube that is rebuilt every frame: tea-bag strings and poured streams.
export class DynamicTube {
  constructor(material, segs = 16, radial = 6) {
    this.segs = segs; this.radial = radial;
    const n = (segs + 1) * (radial + 1);
    this.pos = new Float32Array(n * 3); this.nor = new Float32Array(n * 3);
    const idx = [];
    for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this._p = V3(); this._q = V3(); this._t = V3(); this._n = V3(); this._b = V3();
  }
  // pointFn(s, out) writes the centre for s in 0..1; radiusFn(s) gives the radius.
  update(pointFn, radiusFn) {
    const { segs, radial, pos, nor, _p, _q, _t, _n, _b } = this;
    for (let i = 0; i <= segs; i++) {
      const s = i / segs;
      pointFn(s, _p); pointFn(Math.min(1, s + 0.02), _q);
      _t.subVectors(_q, _p);
      if (_t.lengthSq() < 1e-12) { pointFn(Math.max(0, s - 0.02), _q); _t.subVectors(_p, _q); }
      _t.normalize();
      _n.set(_t.y, -_t.x, 0.0001 + _t.z * 0.3).cross(_t).normalize();
      _b.crossVectors(_t, _n);
      const r = radiusFn(s);
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
        const k = (i * (radial + 1) + j) * 3;
        const nx = _n.x * c + _b.x * sn, ny = _n.y * c + _b.y * sn, nz = _n.z * c + _b.z * sn;
        pos[k] = _p.x + nx * r; pos[k + 1] = _p.y + ny * r; pos[k + 2] = _p.z + nz * r;
        nor[k] = nx; nor[k + 1] = ny; nor[k + 2] = nz;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.normal.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- environment --
// A dark room with one tall window: this is what the porcelain and copper reflect.
function buildEnvironment(renderer) {
  const s = new THREE.Scene();
  const basic = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(r, g, b), side: THREE.DoubleSide });
  s.add(new THREE.Mesh(new THREE.BoxGeometry(12, 7, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.02, 0.016, 0.012), side: THREE.BackSide })));
  // casement window, upper left, toward the viewer
  const pane = basic(13, 11.6, 9.8);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), pane);
    m.position.set(-5.2, 1.3 + j * 0.72, 0.6 + i * 0.72);
    m.rotation.y = Math.PI / 2;
    s.add(m);
  }
  // sky glow spilling round the window
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 4.5), basic(0.5, 0.52, 0.6));
  glow.position.set(-5.6, 2.4, 1.3); glow.rotation.y = Math.PI / 2; s.add(glow);
  // warm bounce from the right wall and from the table itself
  const bounce = new THREE.Mesh(new THREE.PlaneGeometry(7, 4), basic(0.3, 0.17, 0.08));
  bounce.position.set(5.6, 1.2, 0); bounce.rotation.y = -Math.PI / 2; s.add(bounce);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), basic(0.09, 0.055, 0.03));
  floor.position.y = -1.2; floor.rotation.x = -Math.PI / 2; s.add(floor);
  // a low ember of light behind the viewer, so dark glazes are never dead
  const ember = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.6), basic(0.5, 0.36, 0.24));
  ember.position.set(1.2, 1.4, 5.6); ember.rotation.y = Math.PI; s.add(ember);
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), basic(0.34, 0.3, 0.26));
  ceiling.position.set(-0.5, 3.4, 0.5); ceiling.rotation.x = Math.PI / 2; s.add(ceiling);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(s, 0.02);
  pmrem.dispose();
  return rt.texture;
}

// ---------------------------------------------------------------------- build --
export function buildScene(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050403);
  scene.environment = buildEnvironment(renderer);
  scene.environmentIntensity = 0.55;

  const tex = {
    noise: TX.noiseTexture(3, 256, 6),
    noiseFine: TX.noiseTexture(4, 256, 24),
    blob: TX.blobTexture(),
    delft: TX.delftWrap({ motifs: 4, seed: 5 }),
    delftSmall: TX.delftWrap({ motifs: 6, seed: 8 }),
    delftDisc: TX.delftDisc(9),
    paper: TX.teabagPaper(),
  };
  const items = {};        // id -> { id, group, proxy, ... }
  const proxies = [];      // pick targets
  const world = { scene, items, proxies, tex };

  function addProxy(id, parent, geo, pos = V3(0, 0, 0)) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    m.visible = false; m.position.copy(pos); m.userData.id = id;
    parent.add(m); proxies.push(m);
    return m;
  }
  function addBlob(x, z, r, opacity = 0.6, parent = scene, y = null) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), new THREE.MeshBasicMaterial({
      map: tex.blob, transparent: true, opacity, depthWrite: false, color: 0x000000,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, (y ?? surfaceY(x)) + 0.0012, z);
    m.renderOrder = 1;
    parent.add(m);
    return m;
  }

  // ------------------------------------------------------------------ materials
  const mat = {
    porcelain: new THREE.MeshPhysicalMaterial({ color: 0xf6f1e7, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.06, sheen: 0.2 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd9ad4e, metalness: 1, roughness: 0.24 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb98d45, metalness: 1, roughness: 0.34, roughnessMap: tex.noise }),
    copper: new THREE.MeshPhysicalMaterial({ color: 0xc9774a, metalness: 1, roughness: 0.2, roughnessMap: tex.noise, clearcoat: 0.3, clearcoatRoughness: 0.2 }),
    bakelite: new THREE.MeshPhysicalMaterial({ color: 0x0c0a09, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.25 }),
    silver: new THREE.MeshStandardMaterial({ color: 0xe8e6de, metalness: 1, roughness: 0.3, envMapIntensity: 4 }),
    sugar: new THREE.MeshPhysicalMaterial({ color: 0xfbf8f0, roughness: 0.75, sheen: 1, sheenRoughness: 0.4, sheenColor: 0xffffff, bumpMap: tex.noiseFine, bumpScale: 0.6 }),
    milk: new THREE.MeshPhysicalMaterial({ color: 0xfdf9ee, roughness: 0.18, clearcoat: 0.6 }),
    water: new THREE.MeshPhysicalMaterial({ color: 0xa9c2cf, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.4, envMapIntensity: 1.3, depthWrite: false }),
    dark: new THREE.MeshStandardMaterial({ color: 0x0d0906, roughness: 0.9 }),
  };
  world.mat = mat;
  const porcelainWith = (map) => { const m = mat.porcelain.clone(); m.map = map; return m; };

  // ------------------------------------------------------------------- the room
  const wall = shadowed(new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.4), new THREE.MeshStandardMaterial({
    map: TX.plasterTexture(), roughness: 0.96, bumpMap: tex.noise, bumpScale: 1.2,
  })), false, true);
  wall.position.set(0, 0.7, -0.52);
  scene.add(wall);

  const woodMap = TX.woodTexture();
  const woodMat = new THREE.MeshPhysicalMaterial({ map: woodMap, roughness: 0.5, roughnessMap: tex.noise, clearcoat: 0.25, clearcoatRoughness: 0.4, bumpMap: woodMap, bumpScale: 0.5 });
  const table = shadowed(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.05, 0.94), woodMat), true, true);
  table.position.set(0, -0.025, -0.07);
  scene.add(table);
  const apron = shadowed(new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.6, 0.03), woodMat), false, true);
  apron.position.set(0, -0.35, 0.33);
  scene.add(apron);

  // the cloth: heavy green wool, falling over the front edge
  {
    const W = 1.05, D = 1.2, sx = 110, sz = 120;
    const g = new THREE.PlaneGeometry(W, D, sx, sz);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position, rnd = mulberry(77);
    const ph = [rnd() * 6, rnd() * 6, rnd() * 6, rnd() * 6];
    const zBack = -0.5, edge = LAYOUT.tableFront, rEdge = 0.012;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) / W + 0.5, v = p.getZ(i) / D + 0.5;   // 0..1
      let x = LAYOUT.clothRight - (1 - u) * W;
      const along = v * D;                                         // distance from the back
      let z = zBack + along, y = CLOTH_Y;
      // gentle rumples on the table, livelier toward the loose right-hand edge
      const edgeLoose = Math.max(0, 1 - (LAYOUT.clothRight - x) / 0.09);
      y += 0.0009 * (Math.sin(x * 23 + ph[0]) * Math.sin(z * 17 + ph[1]) + 1);
      y += edgeLoose * edgeLoose * 0.0035 * (0.6 + Math.sin(z * 14 + ph[2]));
      x += edgeLoose * 0.006 * Math.sin(z * 9 + ph[3]);
      const over = z - edge;
      if (over > 0) {
        const arc = rEdge * Math.PI / 2;
        if (over < arc) { const a = over / rEdge; z = edge + rEdge * Math.sin(a); y = CLOTH_Y - rEdge * (1 - Math.cos(a)); }
        else { z = edge + rEdge; y = CLOTH_Y - rEdge - (over - arc); }
        const hang = Math.min(1, over / 0.06);
        z += hang * (0.011 * Math.sin(x * 31 + ph[0]) + 0.006 * Math.sin(x * 67 + ph[1])) * (0.4 + over * 5);
      }
      p.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    const cloth = shadowed(new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({
      color: 0x12332b, roughness: 0.92, sheen: 0.35, sheenRoughness: 0.5, sheenColor: new THREE.Color(0x2f6b58),
      bumpMap: TX.weaveTexture(), bumpScale: 0.35, side: THREE.DoubleSide,
    })), true, true);
    scene.add(cloth);
  }

  // ----------------------------------------------------------------------- light
  const key = new THREE.SpotLight(0xffe3c0, 150, 8, 0.36, 0.55, 2);
  key.position.set(-1.75, 1.5, 1.45);
  key.target.position.set(0.05, 0.1, -0.12);
  key.map = TX.windowCookie();
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1.2; key.shadow.camera.far = 4.5;
  key.shadow.bias = -0.00025; key.shadow.normalBias = 0.004; key.shadow.radius = 4.5;
  scene.add(key, key.target);
  const fill = new THREE.HemisphereLight(0x93a6c8, 0x2a1a10, 0.32);
  scene.add(fill);
  const rim = new THREE.PointLight(0xff9a5c, 0.5, 3, 2);
  rim.position.set(0.9, 0.35, -0.3);
  scene.add(rim);
  world.lights = { key, fill, rim };

  // --------------------------------------------------------------- cup & saucer
  {
    const c = LAYOUT.cup, sy = surfaceY(c.x);
    const saucerPts = [[0, 0], [0.03, 0], [0.032, 0.002], [0.052, 0.0055], [0.074, 0.0125], [0.0755, 0.0142], [0.074, 0.0152],
      [0.05, 0.0082], [0.028, 0.0052], [0.0262, 0.0036], [0.024, 0.0034], [0, 0.0034]];
    const sg = lathe(saucerPts, 96);
    // planar-map the disc pattern
    const sp = sg.attributes.position, suv = sg.attributes.uv;
    for (let i = 0; i < sp.count; i++) suv.setXY(i, 0.5 + sp.getX(i) / 0.154, 0.5 + sp.getZ(i) / 0.154);
    const saucer = shadowed(new THREE.Mesh(sg, porcelainWith(tex.delftDisc)));
    saucer.position.set(c.x, sy, c.z);
    scene.add(saucer);
    const sRim = new THREE.Mesh(new THREE.TorusGeometry(0.0752, 0.0008, 8, 96), mat.gold);
    sRim.rotation.x = Math.PI / 2; sRim.position.y = 0.0148; saucer.add(sRim);
    addBlob(c.x, c.z, 0.09, 0.5);

    const cup = new THREE.Group();
    cup.position.set(c.x, sy + 0.0034, c.z);
    cup.rotation.y = -0.62;
    scene.add(cup);

    const N = 30, outer = [[0, 0.0012], [0.0185, 0.0012], [0.0195, 0]];
    for (let i = 0; i <= N; i++) { const y = (i / N) * CUP.H; outer.push([cupOuterR(y), y]); }
    const og = lathe(outer, 96);
    // v should follow height so the painted band sits level
    { const p = og.attributes.position, uv = og.attributes.uv; for (let i = 0; i < p.count; i++) uv.setY(i, p.getY(i) / CUP.H); }
    cup.add(shadowed(new THREE.Mesh(og, porcelainWith(tex.delft))));
    const inner = [[CUP.rimR, CUP.H], [CUP.rimR - 0.0013, CUP.H + 0.0009], [CUP.rimR - CUP.wall, CUP.H]];
    for (let i = N - 1; i >= 0; i--) { const y = CUP.floorY + (i / N) * (CUP.H - CUP.floorY); inner.push([cupInnerR(y), y]); }
    inner.push([0.012, CUP.floorY - 0.0006], [0, CUP.floorY - 0.0008]);
    const innerMesh = shadowed(new THREE.Mesh(lathe(inner, 96), mat.porcelain));
    cup.add(innerMesh);
    const rimGold = new THREE.Mesh(new THREE.TorusGeometry(CUP.rimR - 0.0013, 0.0011, 10, 96), mat.gold);
    rimGold.rotation.x = Math.PI / 2; rimGold.position.y = CUP.H + 0.0004; cup.add(rimGold);
    const hCurve = new THREE.CatmullRomCurve3([V3(0.039, 0.05, 0), V3(0.053, 0.0545, 0), V3(0.066, 0.047, 0), V3(0.066, 0.031, 0), V3(0.052, 0.018, 0), V3(0.03, 0.0135, 0)]);
    const handle = shadowed(new THREE.Mesh(taperTube(hCurve, 0.0036, 0.003, 40, 12), mat.porcelain));
    handle.scale.z = 0.72; cup.add(handle);
    // dregs disc, shown when the cup is empty at the end
    const dregs = new THREE.Mesh(new THREE.CircleGeometry(cupInnerR(CUP.floorY) * 0.98, 48), new THREE.MeshStandardMaterial({ transparent: true, opacity: 0, roughness: 0.6, depthWrite: false }));
    dregs.rotation.x = -Math.PI / 2; dregs.position.y = CUP.floorY + 0.0003; dregs.visible = false; cup.add(dregs);

    const proxy = addProxy('cup', cup, new THREE.CylinderGeometry(0.052, 0.04, 0.075, 16), V3(0, 0.036, 0));
    items.cup = { id: 'cup', group: cup, proxy, saucer, dregs, home: cup.position.clone(), homeRotY: cup.rotation.y, name: 'Cup, Delft porcelain' };
  }

  // --------------------------------------------------------------------- kettle
  {
    const k = LAYOUT.kettle;
    const base = shadowed(new THREE.Mesh(lathe([[0, 0], [0.074, 0], [0.078, 0.003], [0.078, 0.009], [0.072, 0.012], [0, 0.012]], 64), mat.bakelite));
    base.position.copy(k); scene.add(base);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.0032, 12, 8), new THREE.MeshStandardMaterial({ color: 0x1a0d04, emissive: 0xff8a2a, emissiveIntensity: 0 }));
    led.position.set(-0.058, 0.007, 0.052); base.add(led);
    const cord = new THREE.Mesh(taperTube(new THREE.CatmullRomCurve3([V3(0.07, 0.005, -0.02), V3(0.16, 0.004, -0.07), V3(0.3, 0.004, -0.05), V3(0.48, 0.004, -0.16), V3(0.75, 0.004, -0.2), V3(1.05, -0.05, -0.2)]), 0.0032, 0.0032, 60, 8), mat.bakelite);
    cord.position.copy(k); cord.castShadow = true; scene.add(cord);
    addBlob(k.x, k.z, 0.1, 0.5);

    const group = new THREE.Group();
    group.position.set(k.x, 0.012, k.z);
    group.rotation.y = -2.62;
    const tilt = new THREE.Group(); group.add(tilt); scene.add(group);
    const body = shadowed(new THREE.Mesh(lathe([[0, 0], [0.066, 0], [0.071, 0.003], [0.0775, 0.026], [0.079, 0.052], [0.075, 0.082], [0.064, 0.108], [0.05, 0.127], [0.043, 0.135], [0.042, 0.142], [0.0395, 0.1425]], 96), mat.copper));
    tilt.add(body);
    // collar where steel meets copper
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.0425, 0.0016, 8, 64), mat.brass);
    collar.rotation.x = Math.PI / 2; collar.position.y = 0.1415; tilt.add(collar);
    const lid = new THREE.Group(); tilt.add(lid);
    lid.add(shadowed(new THREE.Mesh(lathe([[0.041, 0.1405], [0.0412, 0.1445], [0.036, 0.151], [0.022, 0.1565], [0.008, 0.1585], [0, 0.1588]], 64), mat.copper)));
    const knob = shadowed(new THREE.Mesh(lathe([[0, 0.158], [0.005, 0.158], [0.0045, 0.164], [0.0105, 0.169], [0.012, 0.1745], [0.0085, 0.1795], [0, 0.181]], 32), mat.bakelite));
    lid.add(knob);
    const spoutCurve = new THREE.CatmullRomCurve3([V3(0.06, 0.046, 0), V3(0.094, 0.052, 0), V3(0.117, 0.082, 0), V3(0.129, 0.112, 0), V3(0.143, 0.134, 0)]);
    tilt.add(shadowed(new THREE.Mesh(taperTube(spoutCurve, 0.0135, 0.0062, 40, 16), mat.copper)));
    const spoutLip = new THREE.Mesh(new THREE.TorusGeometry(0.0062, 0.0011, 8, 24), mat.brass);
    spoutLip.position.set(0.143, 0.134, 0); spoutLip.rotation.set(Math.PI / 2, 0.55, 0); tilt.add(spoutLip);
    const handleCurve = new THREE.CatmullRomCurve3([V3(-0.046, 0.128, 0), V3(-0.086, 0.14, 0), V3(-0.118, 0.118, 0), V3(-0.122, 0.078, 0), V3(-0.1, 0.045, 0), V3(-0.074, 0.04, 0)]);
    const kh = shadowed(new THREE.Mesh(taperTube(handleCurve, 0.0085, 0.007, 40, 12), mat.bakelite));
    kh.scale.z = 1.25; tilt.add(kh);
    // the switch: a small brass rocker under the handle
    const sw = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.006, 0.016), mat.brass);
    sw.position.set(-0.079, 0.03, 0); tilt.add(sw);
    const proxy = addProxy('kettle', group, new THREE.CylinderGeometry(0.1, 0.1, 0.2, 14), V3(0, 0.09, 0));
    items.kettle = { id: 'kettle', group, tilt, lid, led, sw, proxy, base,
      home: group.position.clone(), homeYaw: group.rotation.y, spout: V3(0.143, 0.134, 0), name: 'Kettle, copper (electric)' };
  }

  // -------------------------------------------------------------- stoneware jug
  {
    const j = LAYOUT.jug;
    const group = new THREE.Group(); group.position.copy(j); group.rotation.y = -2.2;
    const tilt = new THREE.Group(); group.add(tilt); scene.add(group);
    const pts = [[0, 0], [0.056, 0], [0.062, 0.004], [0.079, 0.045], [0.085, 0.085], [0.08, 0.125], [0.062, 0.165], [0.049, 0.19], [0.047, 0.203], [0.053, 0.224], [0.0545, 0.228],
      [0.051, 0.2275], [0.0445, 0.204], [0.045, 0.19], [0.0, 0.175]];
    const g = lathe(pts, 96);
    // pinch a pouring lip at +x
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (y > 0.196) {
        const a = Math.atan2(z, x), f = Math.pow(Math.max(0, Math.cos(a)), 10) * Math.min(1, (y - 0.196) / 0.03);
        const r = Math.hypot(x, z), nr = r + 0.02 * f;
        p.setXYZ(i, x * nr / r, y + 0.006 * f, z * nr / r);
      }
    }
    g.computeVertexNormals();
    { const uv = g.attributes.uv; for (let i = 0; i < p.count; i++) uv.setY(i, Math.min(1, p.getY(i) / 0.228)); }
    const jm = new THREE.MeshPhysicalMaterial({ map: TX.stonewareTexture(), roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.3, bumpMap: tex.noiseFine, bumpScale: 0.8 });
    tilt.add(shadowed(new THREE.Mesh(g, jm)));
    const hc = new THREE.CatmullRomCurve3([V3(-0.048, 0.2, 0), V3(-0.085, 0.215, 0), V3(-0.118, 0.19, 0), V3(-0.122, 0.14, 0), V3(-0.105, 0.095, 0), V3(-0.082, 0.085, 0)]);
    const h = shadowed(new THREE.Mesh(taperTube(hc, 0.0095, 0.008, 40, 12), jm)); h.scale.z = 1.3; tilt.add(h);
    const waterDisc = new THREE.Mesh(new THREE.CircleGeometry(0.0445, 32), new THREE.MeshPhysicalMaterial({ color: 0x1a2226, roughness: 0.02, metalness: 0.3 }));
    waterDisc.rotation.x = -Math.PI / 2; waterDisc.position.y = 0.2; tilt.add(waterDisc);
    addBlob(j.x, j.z, 0.085, 0.5);
    const proxy = addProxy('jug', group, new THREE.CylinderGeometry(0.1, 0.095, 0.25, 14), V3(-0.01, 0.12, 0));
    items.jug = { id: 'jug', group, tilt, proxy, home: group.position.clone(), homeYaw: group.rotation.y, spout: V3(0.0745, 0.233, 0), name: 'Jug of water, stoneware' };
  }

  // -------------------------------------------------------------------- creamer
  {
    const c = LAYOUT.creamer, sy = surfaceY(c.x);
    const group = new THREE.Group(); group.position.set(c.x, sy, c.z); group.rotation.y = 0.5;
    const tilt = new THREE.Group(); group.add(tilt); scene.add(group);
    const pts = [[0, 0.001], [0.019, 0.001], [0.021, 0], [0.023, 0.003], [0.033, 0.022], [0.0345, 0.036], [0.03, 0.052], [0.0275, 0.06], [0.0295, 0.07], [0.0305, 0.0725],
      [0.0285, 0.0722], [0.0255, 0.06], [0.028, 0.052], [0.032, 0.036], [0.0, 0.03]];
    const g = lathe(pts, 72);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (y > 0.056) {
        const a = Math.atan2(z, x), f = Math.pow(Math.max(0, Math.cos(a)), 8) * Math.min(1, (y - 0.056) / 0.014);
        const r = Math.hypot(x, z), nr = r + 0.013 * f;
        p.setXYZ(i, x * nr / r, y + 0.004 * f, z * nr / r);
      }
    }
    g.computeVertexNormals();
    { const uv = g.attributes.uv; for (let i = 0; i < p.count; i++) uv.setY(i, Math.min(1, p.getY(i) / 0.0725)); }
    tilt.add(shadowed(new THREE.Mesh(g, porcelainWith(tex.delftSmall))));
    const hc = new THREE.CatmullRomCurve3([V3(-0.027, 0.062, 0), V3(-0.042, 0.066, 0), V3(-0.052, 0.054, 0), V3(-0.05, 0.036, 0), V3(-0.034, 0.024, 0)]);
    const h = shadowed(new THREE.Mesh(taperTube(hc, 0.003, 0.0026, 30, 10), mat.porcelain)); h.scale.z = 0.8; tilt.add(h);
    const milk = new THREE.Mesh(new THREE.CircleGeometry(0.0268, 32), mat.milk);
    milk.rotation.x = -Math.PI / 2; milk.position.y = 0.057; tilt.add(milk);
    addBlob(c.x, c.z, 0.036, 0.5);
    const proxy = addProxy('creamer', group, new THREE.CylinderGeometry(0.05, 0.045, 0.09, 12), V3(0, 0.04, 0));
    items.creamer = { id: 'creamer', group, tilt, milk, proxy, home: group.position.clone(), homeYaw: group.rotation.y, spout: V3(0.0435, 0.0755, 0), name: 'Creamer (contains: milk)' };
  }

  // ----------------------------------------------------------------- sugar bowl
  {
    const c = LAYOUT.sugar, sy = surfaceY(c.x);
    const group = new THREE.Group(); group.position.set(c.x, sy, c.z); scene.add(group);
    const pts = [[0, 0.001], [0.024, 0.001], [0.026, 0], [0.028, 0.003], [0.043, 0.022], [0.0465, 0.036], [0.0455, 0.045], [0.0465, 0.0475],
      [0.0445, 0.0472], [0.0432, 0.036], [0.04, 0.024], [0, 0.02]];
    const g = lathe(pts, 72);
    { const p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < p.count; i++) uv.setY(i, Math.min(1, p.getY(i) / 0.0475)); }
    group.add(shadowed(new THREE.Mesh(g, porcelainWith(tex.delftSmall))));
    const rimG = new THREE.Mesh(new THREE.TorusGeometry(0.0455, 0.0009, 8, 72), mat.gold);
    rimG.rotation.x = Math.PI / 2; rimG.position.y = 0.0476; group.add(rimG);
    const cubeGeo = new THREE.BoxGeometry(0.0125, 0.0125, 0.0125);
    const rnd = mulberry(101);
    const spots = [[0, 0.03, 0], [0.018, 0.031, 0.008], [-0.017, 0.03, 0.01], [0.004, 0.031, -0.02], [-0.014, 0.031, -0.014], [0.02, 0.03, -0.012], [-0.002, 0.031, 0.021],
      [0.007, 0.043, 0.003], [-0.01, 0.043, -0.005], [0.002, 0.0435, -0.014], [-0.004, 0.044, 0.013], [0, 0.0555, 0]];
    for (const s of spots) {
      const cube = shadowed(new THREE.Mesh(cubeGeo, mat.sugar));
      cube.position.set(s[0], s[1], s[2]);
      cube.rotation.set((rnd() - 0.5) * 0.7, rnd() * 3, (rnd() - 0.5) * 0.7);
      group.add(cube);
    }
    addBlob(c.x, c.z, 0.042, 0.5);
    const proxy = addProxy('sugar', group, new THREE.CylinderGeometry(0.055, 0.05, 0.075, 12), V3(0, 0.034, 0));
    items.sugar = { id: 'sugar', group, proxy, cubeGeo, name: 'Sugar, in cubes' };
  }

  // ----------------------------------------------------------------------- tins
  world.tins = [];
  TEAS.forEach((tea, i) => {
    const p = LAYOUT.tins[i], sy = surfaceY(p.x), R = 0.037, Ht = 0.088;
    const group = new THREE.Group(); group.position.set(p.x, sy, p.z);
    group.rotation.y = Math.PI + (i - 2) * -0.06 + Math.sin(i * 7.3) * 0.12;
    scene.add(group);
    const bodyMat = new THREE.MeshPhysicalMaterial({ map: TX.tinLabel(tea), metalness: 0.55, roughness: 0.42, roughnessMap: tex.noise, clearcoat: 0.35, clearcoatRoughness: 0.35 });
    group.add(shadowed(new THREE.Mesh(new THREE.CylinderGeometry(R, R, Ht, 64, 1, true).translate(0, Ht / 2, 0), bodyMat)));
    const mouth = new THREE.Mesh(new THREE.CircleGeometry(R - 0.001, 40), mat.dark);
    mouth.rotation.x = -Math.PI / 2; mouth.position.y = Ht - 0.006; group.add(mouth);
    const lid = new THREE.Group(); lid.position.y = Ht - 0.012; group.add(lid);
    lid.add(shadowed(new THREE.Mesh(lathe([[R + 0.0008, 0], [R + 0.0016, 0.003], [R + 0.0016, 0.015], [R + 0.0002, 0.018], [0.012, 0.0205], [0.0105, 0.0205], [0.0095, 0.027], [0.006, 0.0295], [0, 0.03]], 64), mat.brass)));
    addBlob(p.x, p.z, 0.05, 0.5);
    const proxy = addProxy('tin:' + tea.id, group, new THREE.CylinderGeometry(0.044, 0.044, 0.125, 12), V3(0, 0.06, 0));
    const item = { id: 'tin:' + tea.id, tea, group, lid, lidHomeY: lid.position.y, proxy, top: V3(p.x, sy + Ht, p.z), name: `${tea.name} — ${tea.temp}°, ${fmtMin(tea.time)}` };
    items[item.id] = item; world.tins.push(item);
  });

  // --------------------------------------------------------- plate & stroopwafels
  {
    const c = LAYOUT.plate;
    const pts = [[0, 0], [0.04, 0], [0.043, 0.002], [0.066, 0.0055], [0.088, 0.011], [0.0895, 0.0125], [0.088, 0.0135], [0.064, 0.0078], [0.042, 0.0048], [0.0, 0.0044]];
    const g = lathe(pts, 96);
    { const p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, 0.5 + p.getX(i) / 0.183, 0.5 + p.getZ(i) / 0.183); }
    const plate = shadowed(new THREE.Mesh(g, porcelainWith(tex.delftDisc)));
    plate.position.copy(c); scene.add(plate);
    addBlob(c.x, c.z, 0.105, 0.5);
    const wt = TX.wafelTextures();
    const top = new THREE.MeshStandardMaterial({ map: wt.map, bumpMap: wt.bump, bumpScale: 2.2, roughness: 0.62 });
    const side = new THREE.MeshStandardMaterial({ color: 0xb06a22, roughness: 0.5 });
    const wg = new THREE.CylinderGeometry(0.0465, 0.0465, 0.0058, 56);
    world.wafels = [];
    const rest = [[-0.006, 0.0078, 0.004, 0.2, 0], [0.007, 0.0142, -0.004, 1.4, 0], [0.0, 0.0206, 0.006, 2.3, 0]];
    rest.forEach((r, i) => {
      const w = shadowed(new THREE.Mesh(wg, [side, top, top]));
      w.position.set(c.x + r[0], r[1], c.z + r[2]); w.rotation.y = r[3];
      scene.add(w);
      const proxy = addProxy('wafel:' + i, w, new THREE.CylinderGeometry(0.055, 0.055, 0.03, 12));
      const item = { id: 'wafel:' + i, index: i, group: w, proxy, home: w.position.clone(), homeRotY: r[3], state: 'plate', warmth: 0, name: 'Stroopwafel' };
      items[item.id] = item; world.wafels.push(item);
    });
  }

  // ---------------------------------------------------------------------- lemon
  {
    const c = LAYOUT.lemon, sy = surfaceY(c.x);
    const pulp = TX.lemonPulp();
    const skin = new THREE.MeshPhysicalMaterial({ color: 0xe9c22c, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.4, bumpMap: TX.lemonSkinBump(), bumpScale: 0.5 });
    const flesh = new THREE.MeshPhysicalMaterial({ map: pulp, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.15, side: THREE.DoubleSide });
    const group = new THREE.Group(); group.position.set(c.x, sy, c.z); scene.add(group);
    // the half lemon, cut face toward the light
    const half = new THREE.Group();
    const hg = new THREE.SphereGeometry(0.029, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2);
    { const p = hg.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setY(i, y * 1.25 + 0.011 * Math.pow(Math.max(0, y / 0.029), 6)); } hg.computeVertexNormals(); }
    half.add(shadowed(new THREE.Mesh(hg, skin)));
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.029, 40), flesh); face.rotation.x = Math.PI / 2; half.add(face);
    half.position.set(0.035, 0.0275, -0.012); half.rotation.set(Math.PI / 2 + 0.38, 0, 0.5);
    half.rotation.order = 'YXZ'; half.rotation.y = -0.5;
    group.add(half);
    // wedges
    const wedgeGeo = new THREE.SphereGeometry(0.027, 20, 24, 0, Math.PI / 3.1);
    { const p = wedgeGeo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) * 1.3); wedgeGeo.computeVertexNormals(); }
    const faceGeo = new THREE.CircleGeometry(0.027, 24, Math.PI / 2, Math.PI); faceGeo.scale(1, 1.3, 1);
    const wedges = [];
    const mk = () => {
      const w = new THREE.Group();
      w.add(shadowed(new THREE.Mesh(wedgeGeo, skin)));
      const f1 = new THREE.Mesh(faceGeo, flesh); w.add(f1);
      const f2 = new THREE.Mesh(faceGeo, flesh); f2.rotation.y = Math.PI / 3.1; w.add(f2);
      return w;
    };
    const wp = [[-0.03, 0.0125, 0.012, 0.3], [-0.012, 0.0125, 0.04, -0.9]];
    for (const s of wp) {
      const w = mk();
      // lie on the rind: axis horizontal, rind down
      const holder = new THREE.Group();
      w.rotation.set(0, -Math.PI / 6.2 + Math.PI, Math.PI / 2); // axis along x, wedge opening upward
      holder.add(w); holder.position.set(s[0], 0.027, s[1]); holder.rotation.y = s[3];
      holder.position.y = 0.0268;
      group.add(holder);
      wedges.push({ group: holder, home: holder.position.clone(), homeRotY: s[3] });
    }
    addBlob(c.x + 0.03, c.z - 0.008, 0.042, 0.45);
    const proxy = addProxy('lemon', group, new THREE.BoxGeometry(0.13, 0.06, 0.1), V3(0.005, 0.03, 0.012));
    items.lemon = { id: 'lemon', group, wedges, proxy, name: 'Lemon, partly consumed' };
  }

  // ---------------------------------------------------------------------- spoon
  {
    const c = LAYOUT.spoon, sy = surfaceY(c.x);
    const shape = new THREE.Shape();
    // outline in the XY plane: bowl at +x end, handle toward -x
    shape.moveTo(-0.075, 0.0032);
    shape.quadraticCurveTo(-0.082, 0, -0.075, -0.0032);
    shape.lineTo(-0.02, -0.0016);
    shape.quadraticCurveTo(0.004, -0.002, 0.014, -0.0095);
    shape.quadraticCurveTo(0.03, -0.0135, 0.043, -0.0075);
    shape.quadraticCurveTo(0.05, 0, 0.043, 0.0075);
    shape.quadraticCurveTo(0.03, 0.0135, 0.014, 0.0095);
    shape.quadraticCurveTo(0.004, 0.002, -0.02, 0.0016);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.0009, bevelEnabled: true, bevelThickness: 0.0004, bevelSize: 0.0004, bevelSegments: 2, curveSegments: 20, steps: 1 });
    g.rotateX(-Math.PI / 2);   // lie flat: thickness along +y
    // subdivide is unnecessary: bend by vertex
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      let y = p.getY(i);
      const bx = (x - 0.03) / 0.02, bz = z / 0.0125;
      const bowl = Math.max(0, 1 - bx * bx - bz * bz);
      y -= bowl * 0.0048;                                   // the bowl
      if (x < 0.008) y += Math.pow((0.008 - x) / 0.083, 1.6) * 0.012;  // handle rises
      p.setY(i, y + 0.0048);
    }
    g.computeVertexNormals();
    const spoon = shadowed(new THREE.Mesh(g, mat.silver));
    const group = new THREE.Group(); group.add(spoon);
    group.position.set(c.x, sy + 0.0005, c.z); group.rotation.y = 0.42;
    scene.add(group);
    addBlob(c.x, c.z, 0.05, 0.4).scale.set(1.9, 0.6, 1);
    const proxy = addProxy('spoon', group, new THREE.BoxGeometry(0.15, 0.03, 0.045), V3(-0.012, 0.01, 0));
    items.spoon = { id: 'spoon', group, proxy, home: group.position.clone(), homeRot: group.rotation.clone(), name: 'Spoon, silver' };
  }

  // ---------------------------------------------------------------------- watch
  {
    const c = LAYOUT.watch, sy = surfaceY(c.x);
    const group = new THREE.Group(); group.position.set(c.x, sy, c.z); group.rotation.y = 0.35; scene.add(group);
    group.add(shadowed(new THREE.Mesh(lathe([[0, 0], [0.024, 0], [0.0285, 0.003], [0.029, 0.0062], [0.027, 0.0085], [0.0255, 0.0072], [0, 0.0072]], 64), mat.gold)));
    const dial = new THREE.Mesh(new THREE.CircleGeometry(0.0255, 48), new THREE.MeshPhysicalMaterial({ map: TX.watchDial(), roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03 }));
    dial.rotation.x = -Math.PI / 2; dial.position.y = 0.0074; group.add(dial);
    const hand = new THREE.Group(); hand.position.y = 0.0082; group.add(hand);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.0013, 0.0005, 0.02), new THREE.MeshStandardMaterial({ color: 0x141c3a, metalness: 0.9, roughness: 0.3 }));
    blade.position.z = -0.0075; hand.add(blade);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.0017, 0.0017, 0.001, 12), mat.gold); hand.add(hub);
    // crown and bow
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.005, 12), mat.gold);
    crown.rotation.x = Math.PI / 2; crown.position.set(0, 0.0045, -0.0315); group.add(crown);
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.0055, 0.0009, 8, 24), mat.gold);
    bow.position.set(0, 0.004, -0.039); bow.rotation.x = Math.PI / 2 - 0.3; group.add(bow);
    // chain
    const chain = new THREE.CatmullRomCurve3([V3(0, 0.002, -0.044), V3(0.018, 0.0015, -0.07), V3(0.05, 0.0015, -0.075), V3(0.066, 0.0015, -0.05), V3(0.095, 0.0015, -0.046), V3(0.118, 0.0015, -0.07)]);
    const linkGeo = new THREE.TorusGeometry(0.0024, 0.00055, 6, 12);
    const links = new THREE.InstancedMesh(linkGeo, mat.gold, 44);
    const d = new THREE.Object3D();
    for (let i = 0; i < 44; i++) {
      const t = i / 43, pt = chain.getPointAt(t), tg = chain.getTangentAt(t);
      d.position.copy(pt); d.rotation.set(i % 2 ? Math.PI / 2 : 0.35, Math.atan2(tg.x, tg.z) + Math.PI / 2, 0); d.rotation.order = 'YXZ';
      d.updateMatrix(); links.setMatrixAt(i, d.matrix);
    }
    links.castShadow = true; group.add(links);
    addBlob(c.x, c.z, 0.042, 0.55);
    const proxy = addProxy('watch', group, new THREE.CylinderGeometry(0.036, 0.036, 0.03, 12), V3(0, 0.01, 0));
    items.watch = { id: 'watch', group, hand, proxy, name: 'Pocket watch (runs fast in here)' };
  }

  // ------------------------------------------------------------------- tea bag
  {
    const bag = new THREE.Group(); bag.visible = false; scene.add(bag);
    const g = new THREE.BoxGeometry(0.043, 0.05, 0.011, 12, 12, 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const nx = p.getX(i) / 0.0215, ny = p.getY(i) / 0.025;
      const f = Math.sqrt(Math.max(0, (1 - nx ** 4) * (1 - ny ** 4)));
      p.setZ(i, p.getZ(i) * (0.1 + 0.9 * f));
    }
    g.computeVertexNormals();
    const paperMat = new THREE.MeshStandardMaterial({ map: tex.paper, roughness: 0.9 });
    const body = shadowed(new THREE.Mesh(g, paperMat));
    bag.add(body);
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.019, 0.0235), new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide }));
    tag.castShadow = true; tag.visible = false; scene.add(tag);
    const string = new DynamicTube(new THREE.MeshStandardMaterial({ color: 0xe9e2d0, roughness: 0.9 }), 18, 5);
    string.mesh.visible = false; string.mesh.castShadow = true; scene.add(string.mesh);
    const proxy = addProxy('bag', tag, new THREE.SphereGeometry(0.022, 8, 6));
    const proxy2 = addProxy('bag', bag, new THREE.SphereGeometry(0.03, 8, 6));
    items.bag = { id: 'bag', group: bag, body, paperMat, tag, string, proxy, proxy2, name: 'Tea bag' };
  }

  function fmtMin(sec) { const m = sec / 60; return `${Number.isInteger(m) ? m : m.toFixed(1)} min`; }

  return world;
}
