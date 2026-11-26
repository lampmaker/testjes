// Every surface in the painting is drawn here, by hand-written procedure.
// No image files: the whole still life is made of code and patience.
import * as THREE from '../vendor/three.module.js';
import { mulberry, clamp, lerp } from './util.js';

export const SERIF = '"Cormorant Garamond", "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function tex(canvas, { srgb = true, repeat = null, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

// --- tileable value noise ----------------------------------------------------
function lattice(n, seed) {
  const r = mulberry(seed);
  const g = new Float32Array(n * n);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return g;
}
function sampleLattice(g, n, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let fx = x - xi, fy = y - yi;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const x0 = ((xi % n) + n) % n, y0 = ((yi % n) + n) % n;
  const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
  const a = g[y0 * n + x0], b = g[y0 * n + x1], c = g[y1 * n + x0], d = g[y1 * n + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
// Returns Float32Array (w*h) of fbm in 0..1; tiles if fx, fy are integers.
function fbmField(w, h, { fx = 4, fy = 4, octaves = 5, seed = 1, gain = 0.5 } = {}) {
  const out = new Float32Array(w * h);
  let amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const nx = fx * (1 << o), ny = fy * (1 << o);
    const n = Math.max(nx, ny);
    const g = lattice(n, seed * 131 + o * 17);
    for (let y = 0; y < h; y++) {
      const v = (y / h) * ny;
      for (let x = 0; x < w; x++) out[y * w + x] += amp * sampleLattice(g, n, (x / w) * nx, v);
    }
    norm += amp; amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

function paintField(ctx, w, h, fn) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const c = fn(x, y, i);
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c.length > 3 ? c[3] : 255;
  }
  ctx.putImageData(img, 0, 0);
}

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// --- generic ------------------------------------------------------------------
export function noiseTexture(seed = 3, size = 256, f = 6) {
  const [c, ctx] = makeCanvas(size, size);
  const n = fbmField(size, size, { fx: f, fy: f, octaves: 5, seed });
  paintField(ctx, size, size, (x, y) => { const v = n[y * size + x] * 255; return [v, v, v]; });
  return tex(c, { srgb: false, repeat: [1, 1] });
}

export function blobTexture() {
  const [c, ctx] = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.75)');
  g.addColorStop(0.8, 'rgba(0,0,0,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return tex(c, { srgb: false });
}

// Window light: a tall casement, panes softened as if by old glass.
export function windowCookie() {
  const S = 512;
  const [c, ctx] = makeCanvas(S, S);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S);
  ctx.filter = 'blur(4px)';
  const cols = 3, rows = 4, x0 = 96, y0 = 56, w = 320, h = 400, m = 20;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const pw = (w - m * (cols - 1)) / cols, ph = (h - m * (rows - 1)) / rows;
    const b = 215 + Math.round(40 * Math.sin(i * 2.1 + j * 1.3) ** 2);
    ctx.fillStyle = `rgb(${b},${b},${b})`;
    ctx.fillRect(x0 + i * (pw + m), y0 + j * (ph + m), pw, ph);
  }
  ctx.filter = 'none';
  // soft outer falloff so the cookie edge never shows
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.5);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  return tex(c, { srgb: true });
}

// --- room ---------------------------------------------------------------------
export function plasterTexture() {
  const S = 1024;
  const [c, ctx] = makeCanvas(S, S);
  const a = fbmField(S, S, { fx: 3, fy: 3, octaves: 6, seed: 11 });
  const b = fbmField(S, S, { fx: 24, fy: 5, octaves: 3, seed: 12 });
  paintField(ctx, S, S, (x, y) => {
    const i = y * S + x;
    const v = 0.62 + (a[i] - 0.5) * 0.55 + (b[i] - 0.5) * 0.16;
    return [clamp(142 * v, 0, 255), clamp(118 * v, 0, 255), clamp(92 * v, 0, 255)];
  });
  return tex(c, { repeat: [1, 1] });
}

export function woodTexture() {
  const W = 1024, H = 512;
  const [c, ctx] = makeCanvas(W, H);
  const grain = fbmField(W, H, { fx: 3, fy: 48, octaves: 5, seed: 21 });
  const big = fbmField(W, H, { fx: 2, fy: 3, octaves: 3, seed: 22 });
  paintField(ctx, W, H, (x, y) => {
    const i = y * W + x;
    const plank = Math.floor(y / (H / 4));
    const seam = Math.min(1, Math.abs((y % (H / 4)) - 2) / 3);
    const ring = 0.5 + 0.5 * Math.sin((grain[i] * 22 + big[i] * 9 + plank * 1.7) * 2.2);
    let v = 0.45 + 0.4 * grain[i] + 0.16 * ring + (big[i] - 0.5) * 0.3 + (plank % 2) * 0.05;
    v *= 0.55 + 0.45 * seam;
    return [clamp(96 * v, 0, 255), clamp(60 * v, 0, 255), clamp(34 * v, 0, 255)];
  });
  return tex(c, { repeat: [1, 1] });
}

export function weaveTexture() {
  const S = 128;
  const [c, ctx] = makeCanvas(S, S);
  const n = fbmField(S, S, { fx: 16, fy: 16, octaves: 2, seed: 31 });
  paintField(ctx, S, S, (x, y) => {
    const u = (x / S) * Math.PI * 2 * 16, v = (y / S) * Math.PI * 2 * 16;
    const warp = Math.sin(u) * (Math.sin(v * 0.5) > 0 ? 1 : 0.3);
    const weft = Math.sin(v) * (Math.sin(u * 0.5) > 0 ? 0.3 : 1);
    const h = 128 + 70 * Math.max(warp, weft) + (n[y * S + x] - 0.5) * 60;
    return [h, h, h];
  });
  return tex(c, { srgb: false, repeat: [40, 40] });
}

// --- porcelain ------------------------------------------------------------------
const COBALT = [28, 52, 128];
function cobalt(a) { return `rgba(${COBALT[0]},${COBALT[1]},${COBALT[2]},${a})`; }

function brush(ctx, pts, width, alpha, rnd) {
  // a wobbly multi-pass stroke, like a loaded brush on bisque
  for (let pass = 0; pass < 3; pass++) {
    ctx.beginPath();
    ctx.lineWidth = width * (1 - pass * 0.25);
    ctx.strokeStyle = cobalt(alpha * (0.45 + pass * 0.25));
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const j = () => (rnd() - 0.5) * width * 0.5;
    ctx.moveTo(pts[0][0] + j(), pts[0][1] + j());
    for (let i = 1; i < pts.length - 1; i += 2) {
      ctx.quadraticCurveTo(pts[i][0] + j(), pts[i][1] + j(), pts[i + 1][0] + j(), pts[i + 1][1] + j());
    }
    ctx.stroke();
  }
}

function tulip(ctx, x, y, s, rnd) {
  // stem
  brush(ctx, [[x, y], [x + 6 * s, y - 30 * s], [x, y - 62 * s]], 3.2 * s, 0.9, rnd);
  // leaves
  for (const d of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x, y - 6 * s);
    ctx.quadraticCurveTo(x + d * 30 * s, y - 22 * s, x + d * 24 * s, y - 52 * s);
    ctx.quadraticCurveTo(x + d * 10 * s, y - 28 * s, x, y - 6 * s);
    ctx.fillStyle = cobalt(0.55 + rnd() * 0.2); ctx.fill();
  }
  // bloom: three petals
  const by = y - 62 * s;
  for (const d of [-1, 0, 1]) {
    ctx.beginPath();
    ctx.moveTo(x + d * 4 * s, by + 4 * s);
    ctx.quadraticCurveTo(x + d * 20 * s - 9 * s, by - 16 * s, x + d * 11 * s, by - 34 * s);
    ctx.quadraticCurveTo(x + d * 20 * s + 9 * s, by - 16 * s, x + d * 4 * s, by + 4 * s);
    ctx.fillStyle = cobalt(d === 0 ? 0.92 : 0.7); ctx.fill();
  }
}

function windmill(ctx, x, y, s, rnd) {
  ctx.fillStyle = cobalt(0.8);
  ctx.beginPath();
  ctx.moveTo(x - 13 * s, y); ctx.lineTo(x - 8 * s, y - 44 * s); ctx.lineTo(x + 8 * s, y - 44 * s); ctx.lineTo(x + 13 * s, y);
  ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.arc(x, y - 46 * s, 9 * s, Math.PI, 0); ctx.fill();
  for (let k = 0; k < 4; k++) {
    const a = 0.5 + k * Math.PI / 2;
    const ex = x + Math.cos(a) * 40 * s, ey = y - 48 * s + Math.sin(a) * 40 * s;
    brush(ctx, [[x, y - 48 * s], [(x + ex) / 2, (y - 48 * s + ey) / 2], [ex, ey]], 2.6 * s, 0.9, rnd);
    const px = -Math.sin(a) * 9 * s, py = Math.cos(a) * 9 * s;
    ctx.fillStyle = cobalt(0.35);
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * 12 * s, y - 48 * s + Math.sin(a) * 12 * s);
    ctx.lineTo(ex, ey); ctx.lineTo(ex + px, ey + py);
    ctx.lineTo(x + Math.cos(a) * 12 * s + px, y - 48 * s + Math.sin(a) * 12 * s + py);
    ctx.closePath(); ctx.fill();
  }
  // ground wash
  ctx.fillStyle = cobalt(0.25);
  ctx.beginPath(); ctx.ellipse(x, y + 3 * s, 46 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill();
}

function scrollBand(ctx, W, y, amp, n, rnd, alpha = 0.8) {
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) * (W / n);
    ctx.beginPath();
    ctx.arc(x, y, amp, Math.PI, 0);
    ctx.lineWidth = 3; ctx.strokeStyle = cobalt(alpha * (0.7 + rnd() * 0.3)); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y - amp * 0.2, 2.6, 0, Math.PI * 2); ctx.fillStyle = cobalt(alpha); ctx.fill();
  }
}

// Wraps around a lathe: u around the cup, v from foot (bottom) to rim (top).
export function delftWrap({ motifs = 4, seed = 5, band = true } = {}) {
  const W = 1536, H = 384;
  const [c, ctx] = makeCanvas(W, H);
  const rnd = mulberry(seed);
  ctx.fillStyle = '#f3efe6'; ctx.fillRect(0, 0, W, H);
  // glaze pooling: very faint blue-grey cloudiness
  const n = fbmField(W / 4, H / 4, { fx: 8, fy: 2, octaves: 3, seed: seed + 1 });
  const [nc, nctx] = makeCanvas(W / 4, H / 4);
  paintField(nctx, W / 4, H / 4, (x, y) => { const v = n[y * (W / 4) + x]; return [200, 208, 222, v * 38]; });
  ctx.drawImage(nc, 0, 0, W, H);
  if (band) {
    ctx.fillStyle = cobalt(0.85); ctx.fillRect(0, 34, W, 5);
    ctx.fillStyle = cobalt(0.55); ctx.fillRect(0, 46, W, 2);
    scrollBand(ctx, W, 78, 15, motifs * 8, rnd, 0.7);
    ctx.fillStyle = cobalt(0.7); ctx.fillRect(0, H - 70, W, 3);
  }
  for (let i = 0; i < motifs; i++) {
    const x = (i + 0.5) * (W / motifs);
    if (i % 2 === 0) windmill(ctx, x, H - 96, 2.0, rnd); else tulip(ctx, x, H - 86, 2.0, rnd);
    // flanking sprigs
    for (const d of [-1, 1]) {
      const sx = x + d * W / motifs / 2;
      for (let k = 0; k < 5; k++) {
        ctx.beginPath();
        ctx.arc(sx + (rnd() - 0.5) * 34, H - 150 - k * 22 + (rnd() - 0.5) * 12, 3 + rnd() * 3.5, 0, Math.PI * 2);
        ctx.fillStyle = cobalt(0.45 + rnd() * 0.4); ctx.fill();
      }
    }
  }
  const t = tex(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// Top-down disc pattern for saucer and plate (mapped by position, see scene.js).
export function delftDisc(seed = 9) {
  const S = 1024, C = S / 2;
  const [c, ctx] = makeCanvas(S, S);
  const rnd = mulberry(seed);
  ctx.fillStyle = '#f3efe6'; ctx.fillRect(0, 0, S, S);
  const ring = (r, w, a) => { ctx.beginPath(); ctx.arc(C, C, r, 0, Math.PI * 2); ctx.lineWidth = w; ctx.strokeStyle = cobalt(a); ctx.stroke(); };
  ring(S * 0.475, 7, 0.85); ring(S * 0.45, 2.5, 0.6); ring(S * 0.2, 3, 0.7);
  const N = 12;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    ctx.save(); ctx.translate(C, C); ctx.rotate(a);
    // petal sprays between well and rim
    for (const d of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, -S * 0.23);
      ctx.quadraticCurveTo(d * 46, -S * 0.31, d * 8, -S * 0.41);
      ctx.quadraticCurveTo(d * 4, -S * 0.31, 0, -S * 0.23);
      ctx.fillStyle = cobalt(0.5 + rnd() * 0.3); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(0, -S * 0.425, 6, 0, Math.PI * 2); ctx.fillStyle = cobalt(0.85); ctx.fill();
    ctx.restore();
  }
  return tex(c);
}

// Salt-glazed stoneware for the water jug: grey, pebbly, cobalt banding.
export function stonewareTexture() {
  const W = 1024, H = 512;
  const [c, ctx] = makeCanvas(W, H);
  const n = fbmField(W, H, { fx: 12, fy: 6, octaves: 5, seed: 41 });
  const sp = fbmField(W, H, { fx: 96, fy: 48, octaves: 2, seed: 42 });
  paintField(ctx, W, H, (x, y) => {
    const i = y * W + x;
    const v = 0.78 + (n[i] - 0.5) * 0.36 + (sp[i] - 0.5) * 0.22;
    return [clamp(176 * v, 0, 255), clamp(166 * v, 0, 255), clamp(148 * v, 0, 255)];
  });
  const rnd = mulberry(43);
  ctx.globalAlpha = 0.9;
  for (const y of [120, 132, 330, 342]) { ctx.fillStyle = cobalt(0.75); ctx.fillRect(0, y, W, 5); }
  // incised rosettes on the belly
  for (let i = 0; i < 6; i++) {
    const x = (i + 0.5) * (W / 6), y = 232;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * 30, y + Math.sin(a) * 30, 20, 9, a, 0, Math.PI * 2);
      ctx.fillStyle = cobalt(0.5 + rnd() * 0.3); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fillStyle = cobalt(0.9); ctx.fill();
  }
  ctx.globalAlpha = 1;
  const t = tex(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// --- tea tins --------------------------------------------------------------------
export function tinLabel(tea) {
  const W = 1024, H = 400;
  const [c, ctx] = makeCanvas(W, H);
  const [r, g, b] = hexToRgb(tea.tin);
  const n = fbmField(W / 2, H / 2, { fx: 10, fy: 4, octaves: 4, seed: tea.name.length * 7 });
  const [nc, nctx] = makeCanvas(W / 2, H / 2);
  paintField(nctx, W / 2, H / 2, (x, y) => {
    const v = 0.82 + (n[y * (W / 2) + x] - 0.5) * 0.5;
    return [clamp(r * v, 0, 255), clamp(g * v, 0, 255), clamp(b * v, 0, 255)];
  });
  ctx.drawImage(nc, 0, 0, W, H);
  // gilt hoops
  ctx.fillStyle = 'rgba(214,178,96,0.9)';
  ctx.fillRect(0, 18, W, 5); ctx.fillRect(0, H - 23, W, 5);
  // label cartouche centred at u = 0.5
  const cx = W / 2, cy = H / 2, lw = 330, lh = 290;
  ctx.fillStyle = tea.ink;
  ctx.globalAlpha = 0.96;
  ctx.beginPath();
  ctx.ellipse(cx, cy, lw / 2, lh / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = tea.tin; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(cx, cy, lw / 2 - 12, lh / 2 - 12, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.ellipse(cx, cy, lw / 2 - 19, lh / 2 - 19, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = tea.tin; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const words = tea.name.toUpperCase().split(' ');
  const size = words.length > 1 ? 50 : (tea.name.length > 7 ? 46 : 58);
  ctx.font = `600 ${size}px ${SERIF}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
  if (words.length > 1) { ctx.fillText(words[0], cx, cy - 40); ctx.fillText(words[1], cx, cy + 8); }
  else ctx.fillText(words[0], cx, cy - 16);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.font = `italic 500 30px ${SERIF}`;
  ctx.fillText(tea.sub, cx, cy + (words.length > 1 ? 52 : 34));
  ctx.font = `600 27px ${SERIF}`;
  const mins = tea.time / 60;
  ctx.fillText(`${tea.temp}°  ·  ${Number.isInteger(mins) ? mins : mins.toFixed(1)} min`, cx, cy + (words.length > 1 ? 90 : 76));
  // little ornament
  ctx.beginPath(); ctx.moveTo(cx - 44, cy - 92); ctx.lineTo(cx + 44, cy - 92); ctx.lineWidth = 1.5; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy - 92, 4, 0, Math.PI * 2); ctx.fill();
  const t = tex(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export function tagTexture(tea) {
  const [c, ctx] = makeCanvas(128, 160);
  ctx.fillStyle = tea.ink; ctx.fillRect(0, 0, 128, 160);
  ctx.strokeStyle = tea.tin; ctx.lineWidth = 5; ctx.strokeRect(9, 9, 110, 142);
  ctx.fillStyle = tea.tin; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `600 ${tea.name.length > 9 ? 20 : 26}px ${SERIF}`;
  const words = tea.name.toUpperCase().split(' ');
  words.forEach((w, i) => ctx.fillText(w, 64, 76 + (i - (words.length - 1) / 2) * 28));
  ctx.beginPath(); ctx.arc(64, 26, 5, 0, Math.PI * 2); ctx.fill();
  return tex(c);
}

export function teabagPaper() {
  const S = 256;
  const [c, ctx] = makeCanvas(S, S);
  const n = fbmField(S, S, { fx: 6, fy: 6, octaves: 4, seed: 61 });
  const sp = fbmField(S, S, { fx: 48, fy: 48, octaves: 2, seed: 62 });
  paintField(ctx, S, S, (x, y) => {
    const i = y * S + x;
    const leaf = sp[i] > 0.56 ? (sp[i] - 0.56) * 4.5 : 0; // the leaves showing through the paper
    const v = 0.9 + (n[i] - 0.5) * 0.25 - leaf * 0.75;
    return [clamp(226 * v, 0, 255), clamp(212 * v, 0, 255), clamp(186 * v, 0, 255)];
  });
  return tex(c);
}

// --- edible things ----------------------------------------------------------------
export function wafelTextures() {
  const S = 512, C = S / 2;
  const [c, ctx] = makeCanvas(S, S);
  const [bc, bctx] = makeCanvas(S, S);
  const n = fbmField(S, S, { fx: 5, fy: 5, octaves: 5, seed: 71 });
  const fine = fbmField(S, S, { fx: 60, fy: 60, octaves: 2, seed: 72 });
  const col = ctx.getImageData(0, 0, S, S), bmp = bctx.getImageData(0, 0, S, S);
  const cell = 30;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4, k = y * S + x;
    // diamond lattice: rotate 45 degrees
    const u = (x + y) / cell, v = (x - y) / cell;
    const du = Math.abs((u % 1 + 1) % 1 - 0.5), dv = Math.abs((v % 1 + 1) % 1 - 0.5);
    const ridge = Math.max(clamp((du - 0.3) / 0.14), clamp((dv - 0.3) / 0.14)); // 1 on ridges
    const r = Math.hypot(x - C, y - C) / C;
    const edgeToast = clamp((r - 0.72) / 0.28);
    let shade = 0.74 + ridge * 0.3 + (n[k] - 0.5) * 0.4 + (fine[k] - 0.5) * 0.14 - edgeToast * 0.24;
    col.data[i] = clamp(205 * shade, 0, 255);
    col.data[i + 1] = clamp(140 * shade * (0.92 + ridge * 0.08), 0, 255);
    col.data[i + 2] = clamp(62 * shade * shade, 0, 255);
    col.data[i + 3] = 255;
    const h = 60 + ridge * 170 + (fine[k] - 0.5) * 50;
    bmp.data[i] = bmp.data[i + 1] = bmp.data[i + 2] = h; bmp.data[i + 3] = 255;
  }
  ctx.putImageData(col, 0, 0); bctx.putImageData(bmp, 0, 0);
  return { map: tex(c), bump: tex(bc, { srgb: false }) };
}

export function lemonPulp() {
  const S = 512, C = S / 2;
  const [c, ctx] = makeCanvas(S, S);
  const n = fbmField(S, S, { fx: 40, fy: 40, octaves: 3, seed: 81 });
  paintField(ctx, S, S, (x, y) => {
    const dx = x - C, dy = y - C, r = Math.hypot(dx, dy) / C, a = Math.atan2(dy, dx);
    const k = n[y * S + x];
    if (r > 0.93) return [226, 186, 40];                 // zest
    if (r > 0.82) return [244, 236, 204];                // pith
    const seg = Math.abs(Math.sin(a * 5));               // 10 segments
    const membrane = clamp((0.16 - seg) / 0.1) + clamp((0.09 - r) / 0.05);
    const v = 0.86 + (k - 0.5) * 0.5 + 0.1 * Math.sin(r * 40 + k * 20);
    const m = clamp(membrane);
    return [lerp(238 * v, 248, m), lerp(206 * v, 240, m), lerp(64 * v, 196, m)];
  });
  return tex(c);
}

export function lemonSkinBump() {
  const S = 256;
  const [c, ctx] = makeCanvas(S, S);
  const n = fbmField(S, S, { fx: 48, fy: 48, octaves: 2, seed: 82 });
  paintField(ctx, S, S, (x, y) => { const v = n[y * S + x] > 0.5 ? 200 : 110 + n[y * S + x] * 120; return [v, v, v]; });
  return tex(c, { srgb: false, repeat: [3, 2] });
}

// --- the watch ---------------------------------------------------------------------
export function watchDial() {
  const S = 512, C = S / 2;
  const [c, ctx] = makeCanvas(S, S);
  const g = ctx.createRadialGradient(C, C, 20, C, C, C);
  g.addColorStop(0, '#f6efdc'); g.addColorStop(1, '#e6d9b8');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = '#2a2018'; ctx.fillStyle = '#2a2018';
  ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(C, C, C - 22, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2, major = i % 10 === 0;
    const r0 = C - (major ? 62 : 40), r1 = C - 26;
    ctx.lineWidth = major ? 5 : 1.6;
    ctx.beginPath(); ctx.moveTo(C + Math.sin(a) * r0, C - Math.cos(a) * r0); ctx.lineTo(C + Math.sin(a) * r1, C - Math.cos(a) * r1); ctx.stroke();
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `600 62px ${SERIF}`;
  const numerals = ['VI', 'I', 'II', 'III', 'IV', 'V'];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.fillText(numerals[i], C + Math.sin(a) * (C - 108), C - Math.cos(a) * (C - 108));
  }
  ctx.font = `italic 500 30px ${SERIF}`;
  ctx.fillText('minutes of tea', C, C + 62);
  return tex(c);
}

// --- the dregs (tasseography) --------------------------------------------------------
// A blob of leaf-specks, loosely steered into a shape by a few attractor points.
export function dregsTexture(seed, leafColor = [38, 24, 12]) {
  const S = 256, C = S / 2;
  const [c, ctx] = makeCanvas(S, S);
  const rnd = mulberry(seed);
  const attractors = [];
  const n = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, r = rnd() * 0.45;
    attractors.push([C + Math.cos(a) * r * C, C + Math.sin(a) * r * C, 26 + rnd() * 40]);
  }
  for (let i = 0; i < 620; i++) {
    const at = attractors[Math.floor(rnd() * attractors.length)];
    const a = rnd() * Math.PI * 2, d = Math.pow(rnd(), 0.7) * at[2] * (0.7 + rnd());
    const x = at[0] + Math.cos(a) * d, y = at[1] + Math.sin(a) * d;
    if (Math.hypot(x - C, y - C) > C * 0.86) continue;
    ctx.save(); ctx.translate(x, y); ctx.rotate(rnd() * Math.PI);
    ctx.fillStyle = `rgba(${leafColor[0] + rnd() * 30},${leafColor[1] + rnd() * 20},${leafColor[2] + rnd() * 10},${0.5 + rnd() * 0.5})`;
    ctx.beginPath(); ctx.ellipse(0, 0, 2 + rnd() * 6, 1.1 + rnd() * 2.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  // tide line left by the last sip
  ctx.strokeStyle = `rgba(${leafColor[0] + 60},${leafColor[1] + 40},${leafColor[2] + 20},0.22)`;
  ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(C, C, C * 0.8, rnd() * 6, rnd() * 6 + 3.5); ctx.stroke();
  return tex(c);
}

// --- the moth ---------------------------------------------------------------------
// One wing; the other is its mirror. Every proper still life has an insect in it.
export function mothWing() {
  const S = 128;
  const [c, ctx] = makeCanvas(S, S);
  const path = () => {
    ctx.beginPath(); ctx.moveTo(4, 70);
    ctx.bezierCurveTo(30, 8, 96, 2, 124, 26);
    ctx.bezierCurveTo(118, 62, 96, 88, 70, 96);
    ctx.bezierCurveTo(74, 112, 52, 126, 30, 120);
    ctx.bezierCurveTo(14, 108, 6, 90, 4, 70); ctx.closePath();
  };
  path();
  const g = ctx.createRadialGradient(10, 70, 4, 40, 60, 120);
  g.addColorStop(0, '#5b4630'); g.addColorStop(0.45, '#b9976a'); g.addColorStop(0.7, '#7a5a3a'); g.addColorStop(1, '#d8c39a');
  ctx.fillStyle = g; ctx.fill();
  ctx.save(); path(); ctx.clip();
  ctx.strokeStyle = 'rgba(48,32,18,0.55)'; ctx.lineWidth = 3;
  for (const r of [46, 70, 94]) { ctx.beginPath(); ctx.arc(4, 70, r, -1.3, 0.9); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(240,226,190,0.5)'; ctx.lineWidth = 1.5;
  for (let i = 0; i < 9; i++) { const a = -1.15 + i * 0.24; ctx.beginPath(); ctx.moveTo(4, 70); ctx.lineTo(4 + Math.cos(a) * 130, 70 + Math.sin(a) * 130); ctx.stroke(); }
  ctx.fillStyle = '#1d1410'; ctx.beginPath(); ctx.arc(84, 36, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e9d9a8'; ctx.beginPath(); ctx.arc(84, 36, 4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  return tex(c);
}

export { makeCanvas, fbmField, hexToRgb };
