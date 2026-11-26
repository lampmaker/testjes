// All sound is synthesised: no samples. A kettle is mostly filtered noise anyway.
let ctx = null, master = null, reverb = null, wet = null, noiseBuf = null;
let muted = false;
const cont = {};          // continuous voices
let musicTimer = null;

function makeNoise(seconds = 2) {
  const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
function makeImpulse(seconds = 2.6) {
  const n = ctx.sampleRate * seconds, b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c); let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n, env = Math.pow(1 - t, 2.6) * (i < 400 ? i / 400 : 1);
      lp += ((Math.random() * 2 - 1) - lp) * (0.55 - 0.4 * t);     // darker as it decays
      d[i] = lp * env;
    }
  }
  return b;
}
// Karplus-Strong pluck, rendered once per pitch: a small lute for a small room.
const pluckCache = new Map();
function pluck(freq) {
  const key = Math.round(freq * 10);
  if (pluckCache.has(key)) return pluckCache.get(key);
  const sr = ctx.sampleRate, n = Math.floor(sr * 3.2), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
  const N = Math.max(2, Math.round(sr / freq)), ring = new Float32Array(N);
  let lp = 0;
  for (let i = 0; i < N; i++) { lp += ((Math.random() * 2 - 1) - lp) * 0.45; ring[i] = lp; }   // soft thumb, not a plectrum
  let idx = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[idx], bb = ring[(idx + 1) % N];
    const v = (a + bb) * 0.5 * 0.9972;
    d[i] = a; ring[idx] = v; idx = (idx + 1) % N;
  }
  pluckCache.set(key, b);
  return b;
}

function env(gain, t, a, peak, dcy) {
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + a + dcy);
}
function noiseBurst({ dur = 0.1, type = 'bandpass', f0 = 1000, f1 = null, q = 1, peak = 0.3, attack = 0.005, dest = master, when = 0 }) {
  const t = ctx.currentTime + when, src = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noiseBuf; src.loop = true; src.loopStart = Math.random();
  flt.type = type; flt.Q.value = q; flt.frequency.setValueAtTime(f0, t);
  if (f1) flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
  env(g, t, attack, peak, dur);
  src.connect(flt).connect(g).connect(dest);
  src.start(t, Math.random() * 1.5); src.stop(t + dur + attack + 0.05);
}
function tone({ f0 = 440, f1 = null, dur = 0.2, peak = 0.2, type = 'sine', attack = 0.004, dest = master, when = 0 }) {
  const t = ctx.currentTime + when, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  env(g, t, attack, peak, dur);
  o.connect(g).connect(dest); o.start(t); o.stop(t + dur + attack + 0.05);
}
function loopNoise(type, f, q) {
  const src = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noiseBuf; src.loop = true; flt.type = type; flt.frequency.value = f; flt.Q.value = q; g.gain.value = 0;
  src.connect(flt).connect(g).connect(master); src.start();
  return { src, flt, g };
}
const ramp = (param, v, tc = 0.08) => param.setTargetAtTime(v, ctx.currentTime, tc);

// D dorian, the official mode of looking out of a window
const SCALE = [146.83, 174.61, 196.0, 220.0, 261.63, 293.66, 349.23, 392.0, 440.0, 523.25];
function playPluck(freq, gain = 0.2, when = 0) {
  const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = pluck(freq); g.gain.value = gain;
  src.connect(g); g.connect(master); g.connect(wet);
  src.start(ctx.currentTime + when);
}
function musicStep() {
  if (!ctx) return;
  if (!muted && ctx.state === 'running' && !document.hidden) {
    const r = Math.random();
    const base = Math.floor(Math.random() * 6);
    if (r < 0.45) {                       // a slow broken chord
      const steps = [0, 2, 4, 7].slice(0, 2 + Math.floor(Math.random() * 3));
      steps.forEach((s, i) => playPluck(SCALE[Math.min(SCALE.length - 1, base + s)], 0.085 - i * 0.012, i * (0.28 + Math.random() * 0.22)));
    } else if (r < 0.8) {                 // a single considered note
      playPluck(SCALE[base + Math.floor(Math.random() * 4)], 0.09);
    } else {                              // a low one, for gravity
      playPluck(SCALE[Math.floor(Math.random() * 3)] / 2, 0.12);
      playPluck(SCALE[4 + Math.floor(Math.random() * 4)], 0.06, 0.6);
    }
  }
  musicTimer = setTimeout(musicStep, 2600 + Math.random() * 4200);
}

export const audio = {
  get ready() { return !!ctx; },
  init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9;
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3;
      master.connect(comp).connect(ctx.destination);
      noiseBuf = makeNoise(2);
      reverb = ctx.createConvolver(); reverb.buffer = makeImpulse();
      wet = ctx.createGain(); wet.gain.value = 0.55; wet.connect(reverb); reverb.connect(master);
      // room tone
      const room = loopNoise('lowpass', 220, 0.5); room.g.gain.value = 0.02;
      // kettle voices
      cont.rumble = loopNoise('bandpass', 180, 0.8);
      cont.hiss = loopNoise('bandpass', 2400, 0.6);
      cont.bubble = loopNoise('lowpass', 520, 3);
      const lfo = ctx.createOscillator(), lfoG = ctx.createGain(); lfo.frequency.value = 13; lfoG.gain.value = 0;
      lfo.connect(lfoG).connect(cont.bubble.g.gain); lfo.start(); cont.bubbleLfo = lfoG;
      // pour voices
      cont.pour = loopNoise('bandpass', 1800, 0.9);
      cont.fill = loopNoise('bandpass', 500, 7);
      musicTimer = setTimeout(musicStep, 1800);
    } catch (e) { ctx = null; }
  },
  setMuted(m) { muted = m; if (master) ramp(master.gain, m ? 0 : 0.9, 0.1); },
  get muted() { return muted; },

  // heat: 0..1 how close to the boil; on: element running
  kettle(heat, on) {
    if (!ctx) return;
    const h = on ? heat : 0;
    ramp(cont.rumble.g.gain, on ? 0.02 + 0.2 * Math.pow(h, 1.5) * (1 - 0.45 * Math.max(0, (h - 0.85) / 0.15)) : 0, 0.25);
    ramp(cont.rumble.flt.frequency, 140 + 520 * h, 0.3);
    ramp(cont.hiss.g.gain, on ? 0.012 + 0.05 * h : 0, 0.25);
    const boil = on ? Math.max(0, (h - 0.8) / 0.2) : 0;
    ramp(cont.bubble.g.gain, 0.1 * boil, 0.2); ramp(cont.bubbleLfo.gain, 0.09 * boil, 0.2);
  },
  // level: 0..1 how full the receiving vessel is (the pitch of a filling cup rises)
  pour(on, level = 0, thick = false) {
    if (!ctx) return;
    ramp(cont.pour.g.gain, on ? (thick ? 0.05 : 0.11) : 0, 0.05);
    ramp(cont.pour.flt.frequency, thick ? 900 : 1500 + 900 * level, 0.1);
    ramp(cont.fill.g.gain, on ? (thick ? 0.05 : 0.16) : 0, 0.06);
    ramp(cont.fill.flt.frequency, 330 + 900 * level * level + (thick ? 200 : 0), 0.08);
  },
  click() { if (!ctx) return; noiseBurst({ dur: 0.02, type: 'highpass', f0: 1800, peak: 0.25, attack: 0.001 }); tone({ f0: 1250, f1: 700, dur: 0.035, peak: 0.12 }); },
  tin() { if (!ctx) return; noiseBurst({ dur: 0.05, type: 'bandpass', f0: 3200, q: 2, peak: 0.16 }); tone({ f0: 1480, dur: 0.22, peak: 0.05, dest: wet }); tone({ f0: 2230, dur: 0.16, peak: 0.035, dest: wet }); },
  paper() { if (!ctx) return; noiseBurst({ dur: 0.14, type: 'bandpass', f0: 2600, f1: 900, q: 0.7, peak: 0.07, attack: 0.02 }); },
  plop(size = 1) {
    if (!ctx) return;
    tone({ f0: 620 / size, f1: 170 / size, dur: 0.11, peak: 0.26 }); tone({ f0: 240 / size, f1: 900 / size, dur: 0.07, peak: 0.12, when: 0.07 });
    noiseBurst({ dur: 0.12, type: 'bandpass', f0: 2600, q: 0.8, peak: 0.07 * size });
  },
  drip() { if (!ctx) return; const f = 900 + Math.random() * 700; tone({ f0: f, f1: f * 1.9, dur: 0.05, peak: 0.07 }); },
  clink(v = 1) {
    if (!ctx) return;
    const base = 2050 + Math.random() * 260;
    [[1, 0.5], [1.52, 0.33], [2.41, 0.2], [3.35, 0.12]].forEach(([m, d], i) => {
      tone({ f0: base * m, dur: d, peak: 0.07 * v / (i + 1), dest: i < 2 ? master : wet });
    });
    tone({ f0: base, dur: 0.4, peak: 0.02 * v, dest: wet });
  },
  thunk() { if (!ctx) return; tone({ f0: 150, f1: 70, dur: 0.09, peak: 0.25 }); noiseBurst({ dur: 0.04, type: 'lowpass', f0: 700, peak: 0.12 }); },
  crunch(soft = false) {
    if (!ctx) return;
    const n = soft ? 3 : 7;
    for (let i = 0; i < n; i++) noiseBurst({ dur: soft ? 0.09 : 0.035, type: soft ? 'lowpass' : 'highpass', f0: soft ? 900 : 1900 + Math.random() * 2400, peak: soft ? 0.1 : 0.22, attack: 0.002, when: i * (soft ? 0.12 : 0.055) + Math.random() * 0.02 });
  },
  sip() {
    if (!ctx) return;
    // a slurp: air and tea in dispute
    const t = ctx.currentTime, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), trem = ctx.createOscillator(), tg = ctx.createGain();
    src.buffer = noiseBuf; src.loop = true; f.type = 'bandpass'; f.Q.value = 3.5;
    f.frequency.setValueAtTime(520, t); f.frequency.exponentialRampToValueAtTime(2600, t + 0.62);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.12); g.gain.setValueAtTime(0.22, t + 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.68);
    trem.frequency.value = 27; tg.gain.value = 0.12; trem.connect(tg).connect(g.gain);
    src.connect(f).connect(g).connect(master); src.start(t); trem.start(t); src.stop(t + 0.75); trem.stop(t + 0.75);
  },
  ahh() {
    if (!ctx) return;
    [640, 1150, 2500].forEach((fq, i) => noiseBurst({ dur: 0.9, type: 'bandpass', f0: fq, f1: fq * 0.9, q: 5, peak: 0.055 / (i + 1), attack: 0.18, dest: master }));
  },
  // the kettle does not whistle. it sings, briefly, and is embarrassed about it.
  sing() {
    if (!ctx) return;
    [293.66, 440, 587.33, 739.99].forEach((f, i) => {
      const t = ctx.currentTime + i * 0.09, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.045, t + 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.6);
      o.connect(g); g.connect(wet); g.connect(master); o.start(t); o.stop(t + 3.8);
    });
  },
  chime(n = 3) { if (!ctx) return; for (let i = 0; i < n; i++) playPluck(SCALE[[5, 7, 9, 8][i % 4]], 0.12, i * 0.16); },
  note(i) { if (ctx) playPluck(SCALE[i % SCALE.length], 0.1); },
  tick() { if (ctx) noiseBurst({ dur: 0.012, type: 'highpass', f0: 4200, peak: 0.035, attack: 0.001 }); },
  whoosh() { if (ctx) noiseBurst({ dur: 0.35, type: 'bandpass', f0: 500, f1: 1400, q: 0.8, peak: 0.035, attack: 0.12 }); },
};
