// Everything that is not paint: captions, the placard, the gallery, the share card.
import { SERIF } from './textures.js';

const $ = (id) => document.getElementById(id);
const STORE = 'steep-life.gallery.v1';

// ------------------------------------------------------------------- captions --
let hintText = '', hintTimer = 0;
export function setHint(text) {
  if (text === hintText) return;
  hintText = text;
  const el = $('hint');
  el.classList.add('swap');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { el.textContent = text; el.classList.remove('swap'); }, 320);
}
export function setTip(text, x, y) {
  const el = $('tip');
  if (!text) { el.classList.remove('on'); return; }
  el.textContent = text;
  el.style.left = Math.max(90, Math.min(innerWidth - 90, x)) + 'px'; el.style.top = Math.max(44, y) + 'px';
  el.classList.add('on');
}
export function setHud(id, html, x, y) {
  const el = $(id);
  if (!html) { el.classList.remove('on'); return; }
  if (el._html !== html) { el.innerHTML = html; el._html = html; }
  el.style.left = x + 'px'; el.style.top = y + 'px';
  el.classList.add('on');
}

export function show(id) { const el = $(id); el.classList.remove('out'); el.hidden = false; }
export function hide(id, instant = false) {
  const el = $(id);
  if (el.hidden) return;
  if (instant) { el.hidden = true; return; }
  el.classList.add('out');
  setTimeout(() => { el.hidden = true; el.classList.remove('out'); }, 700);
}
export const on = (id, fn) => $(id).addEventListener('click', (e) => { e.stopPropagation(); fn(e); });

export function showFortune(shape, text) {
  $('fortuneShape').textContent = `The leaves have settled into ${shape}.`;
  $('fortuneText').textContent = text;
  show('fortune');
}

// -------------------------------------------------------------------- placard --
let current = null;
export function showPlacard(entry) {
  current = entry;
  $('shot').src = entry.image;
  $('pTitle').textContent = entry.title;
  $('pYear').textContent = entry.year;
  $('pMedium').textContent = entry.medium;
  $('pReview').textContent = entry.review;
  $('pCritic').textContent = `— ${entry.critic}, ${entry.paper}`;
  $('pVerdict').textContent = entry.verdict;
  $('pEstimate').textContent = entry.estimate;
  $('pDregs').textContent = entry.fortune ? `The dregs resembled ${entry.shape}. ${entry.fortune}` : 'The dregs were not consulted.';
  $('btnShare').hidden = !(navigator.share || navigator.clipboard);
  show('placard');
  $('placard').scrollTop = 0;
}

// -------------------------------------------------------------------- gallery --
export function loadGallery() {
  try { return JSON.parse(localStorage.getItem(STORE) || '[]'); } catch (e) { return []; }
}
export function saveToGallery(entry) {
  const list = loadGallery();
  list.unshift({ ...entry, image: entry.thumb, thumb: undefined });
  // keep the collection small enough for local storage; the oldest works are deaccessioned
  while (list.length > 18) list.pop();
  for (let tries = 0; tries < 6; tries++) {
    try { localStorage.setItem(STORE, JSON.stringify(list)); return; } catch (e) { list.pop(); }
  }
}
export function showGallery() {
  const list = loadGallery(), grid = $('gGrid');
  grid.textContent = '';
  $('gCount').textContent = list.length ? `${list.length} work${list.length > 1 ? 's' : ''}, all by you` : '';
  if (!list.length) {
    const p = document.createElement('p'); p.className = 'gempty';
    p.textContent = 'The walls are bare. Make a cup of tea, then sign it.';
    grid.append(p);
  }
  for (const e of list) {
    const fig = document.createElement('figure'); fig.className = 'gitem';
    const fr = document.createElement('div'); fr.className = 'frame';
    const img = document.createElement('img'); img.src = e.image; img.alt = e.title; img.loading = 'lazy';
    fr.append(img);
    const cap = document.createElement('figcaption');
    const b = document.createElement('b'); b.textContent = e.title;
    const i = document.createElement('i'); i.textContent = e.medium;
    const est = document.createElement('div'); est.textContent = `Est. ${e.estimate}`;
    cap.append(b, i, est); fig.append(fr, cap); grid.append(fig);
  }
  show('gallery');
}

// ----------------------------------------------------------------- share card --
function wrap(ctx, text, maxW) {
  const words = text.split(/\s+/), lines = []; let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}
function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
export async function makeCard(entry = current) {
  const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const wall = x.createRadialGradient(W / 2, 380, 80, W / 2, 500, 1000);
  wall.addColorStop(0, '#43362b'); wall.addColorStop(1, '#15100c');
  x.fillStyle = wall; x.fillRect(0, 0, W, H);
  const img = await loadImage(entry.image);
  const maxW = 900, maxH = 640, s = Math.min(maxW / img.width, maxH / img.height);
  const iw = img.width * s, ih = img.height * s, ix = (W - iw) / 2, iy = 92, f = 26;
  x.save(); x.shadowColor = 'rgba(0,0,0,.7)'; x.shadowBlur = 60; x.shadowOffsetY = 34;
  const g = x.createLinearGradient(ix - f, iy - f, ix + iw + f, iy + ih + f);
  [[0, '#7d5c1f'], [0.18, '#e9cc7a'], [0.36, '#93702b'], [0.52, '#f3dd94'], [0.7, '#7a5a22'], [0.86, '#d6b45b'], [1, '#6d4f1a']].forEach(([o, col]) => g.addColorStop(o, col));
  x.fillStyle = g; x.fillRect(ix - f, iy - f, iw + f * 2, ih + f * 2); x.restore();
  x.strokeStyle = 'rgba(0,0,0,.4)'; x.lineWidth = 3; x.strokeRect(ix - f + 2, iy - f + 2, iw + f * 2 - 4, ih + f * 2 - 4);
  x.fillStyle = '#1c1208'; x.fillRect(ix - 4, iy - 4, iw + 8, ih + 8);
  x.drawImage(img, ix, iy, iw, ih);
  // the label
  const lx = 110, lw = W - 220, ly = iy + ih + f + 54, pad = 34;
  x.font = `700 44px ${SERIF}`;
  const titleLines = wrap(x, entry.title, lw - pad * 2);
  x.font = `italic 500 27px ${SERIF}`;
  const medLines = wrap(x, entry.medium, lw - pad * 2);
  x.font = `500 29px ${SERIF}`;
  let revLines = wrap(x, entry.review, lw - pad * 2);
  const room = H - 70 - ly - pad * 2 - titleLines.length * 48 - 40 - medLines.length * 33 - 16 - 44 - 46;
  const maxRev = Math.max(2, Math.floor(room / 37));
  if (revLines.length > maxRev) { revLines = revLines.slice(0, maxRev); revLines[maxRev - 1] = revLines[maxRev - 1].replace(/\s+\S*$/, '') + '…'; }
  const lh = pad * 2 + titleLines.length * 48 + 40 + medLines.length * 33 + 16 + revLines.length * 37 + 44 + 46;
  x.save(); x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = 30; x.shadowOffsetY = 14; x.fillStyle = '#f1ead9'; x.fillRect(lx, ly, lw, lh); x.restore();
  let y = ly + pad + 36; x.fillStyle = '#1d1711'; x.textBaseline = 'alphabetic';
  x.font = `700 44px ${SERIF}`; for (const l of titleLines) { x.fillText(l, lx + pad, y); y += 48; }
  x.font = `500 28px ${SERIF}`; x.fillText(`You, ${entry.year}`, lx + pad, y - 6); y += 32;
  x.font = `italic 500 27px ${SERIF}`; x.fillStyle = '#4c4133'; for (const l of medLines) { x.fillText(l, lx + pad, y - 6); y += 33; }
  y += 16; x.fillStyle = '#1d1711'; x.font = `500 29px ${SERIF}`; for (const l of revLines) { x.fillText(l, lx + pad, y - 6); y += 37; }
  x.font = `italic 500 23px ${SERIF}`; x.fillStyle = '#5a4d3b'; x.textAlign = 'right'; x.fillText(`— ${entry.critic}, ${entry.paper}`, lx + lw - pad, y + 2); x.textAlign = 'left'; y += 46;
  x.font = `600 27px ${SERIF}`; x.fillStyle = '#1d1711'; x.fillText(`Auction estimate: ${entry.estimate}`, lx + pad, y);
  x.font = `600 24px ${SERIF}`; x.fillStyle = '#d9b566'; x.textAlign = 'center';
  if ('letterSpacing' in x) x.letterSpacing = '6px';
  x.fillText('STEEP LIFE', W / 2, H - 46);
  if ('letterSpacing' in x) x.letterSpacing = '0px';
  x.font = `italic 500 22px ${SERIF}`; x.fillStyle = '#b9aa8c'; x.fillText('a still life you can drink', W / 2, H - 18);
  return c;
}
// Where the page is hosted somewhere that brokers file saves (window.claude), use that;
// everywhere else the plain download link does the job.
let hostSave = null, cardBlob = null;
if (window.claude && window.claude.use) window.claude.use('downloads').then((d) => { hostSave = d; }).catch(() => {});
$('cardLink').addEventListener('click', (e) => {
  if (!hostSave || !cardBlob) return;
  e.preventDefault();
  hostSave.save({ filename: e.currentTarget.download, data: cardBlob }).catch(() => {});
});
export async function saveCard() {
  const c = await makeCard();
  const url = c.toDataURL('image/png');
  c.toBlob((b) => { cardBlob = b; }, 'image/png');
  $('cardImg').src = url;
  const a = $('cardLink');
  a.href = url;
  a.download = 'steep-life-' + current.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.png';
  show('card');
}
export async function shareCard() {
  const text = `“${current.title}” — ${current.medium}. Auction estimate: ${current.estimate}. Painted in Steep Life, a still life you can drink.`;
  const copy = async () => { try { await navigator.clipboard.writeText(text + ' ' + location.href); return 'copied'; } catch (e) { return 'failed'; } };
  try {
    if (navigator.share) {
      const c = await makeCard();
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      const file = new File([blob], 'steep-life.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: current.title, text }); return 'shared'; }
      await navigator.share({ title: current.title, text, url: location.href });
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled';
  }
  return copy();
}
