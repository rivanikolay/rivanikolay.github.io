/* Hero background: a contour map of the See-Gaster region, drawn from swisstopo data.
   While the name shrinks back, the map swings down and the hills rise. Once the name has settled,
   the map stops and a detailed version fades in. Data: assets/map (built by tools/build-map.py). */
(() => {
  'use strict';

  const DATA = 'assets/map/';
  const DATA_VERSION = '1'; // bump after rebuilding the data, so browsers fetch the new files
  const LAKE = 405.9; // Lake Zurich in swisstopo's height model, metres above sea level
  const SHRINK_END = .6; // matches .hero-head: the name has settled at 60% of the hero's scroll

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const ease = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  /* ---------- palette ---------- */

  const STAGE = { dark: [0, 0, 0], light: [245, 245, 247] };
  const PAL = {
    dark: [[41, 151, 255], [45, 212, 191], [74, 222, 128]],
    light: [[0, 113, 227], [13, 148, 136], [22, 163, 74]],
  };
  const mix = (stops, t) => {
    t = clamp(t, 0, 1) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(t)), f = t - i;
    const a = stops[i], b = stops[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  };
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

  /* ---------- data decoding ---------- */

  // Turns the pixels of dem.png into heights and a water mask.
  // Heights are stored in decimetres: red is the high byte, green the low byte (e.g. 0x0F, 0xDB → 4059 → 405.9 m).
  function decodeHeights(px, cols, rows) {
    const raw = new Int32Array(cols * rows);
    const dem = new Float32Array(cols * rows);
    for (let i = 0; i < raw.length; i++) {
      raw[i] = (px[i * 4] << 8) | px[i * 4 + 1];
      dem[i] = raw[i] / 10;
    }

    // Lakes are perfectly flat in the height model: a cell whose neighbours share its height is water.
    const core = new Uint8Array(cols * rows);
    for (let j = 1; j < rows - 1; j++) {
      for (let i = 1; i < cols - 1; i++) {
        const o = j * cols + i, v = raw[o];
        if (raw[o - 1] === v && raw[o + 1] === v && raw[o - cols] === v && raw[o + cols] === v
          && raw[o - cols - 1] === v && raw[o - cols + 1] === v && raw[o + cols - 1] === v && raw[o + cols + 1] === v) core[o] = 1;
      }
    }
    const water = new Float32Array(cols * rows);
    for (let j = 1; j < rows - 1; j++) {
      for (let i = 1; i < cols - 1; i++) {
        const o = j * cols + i;
        if (core[o] || ((core[o - 1] || core[o + 1] || core[o - cols] || core[o + cols]) && dem[o] <= LAKE + .05)) water[o] = 1;
      }
    }
    return { dem, water };
  }

  // The Obersee sits behind the name, Rapperswil to its left and the Linth plain to its right.
  const view = (W, H) => ({ cE: W / H < 1 ? 2708200 : 2709600, cN: 1230300, s: Math.max(W / 21000, H / 14500) });

  // Marching squares: every level crossing becomes a short segment.
  const SEG = [null, [3, 2], [2, 1], [3, 1], [0, 1], [0, 1, 3, 2], [0, 2], [0, 3], [0, 3], [0, 2], [0, 3, 1, 2], [0, 1], [3, 1], [1, 2], [3, 2], null];
  function* march(fld, step, onSeg) {
    const { F, cols, rows } = fld;
    let px = 0, py = 0, i = 0, j = 0, a = 0, b = 0, c = 0, d = 0, t = 0;
    const at = (edge) => {
      if (edge === 0) { px = i + (t - a) / (b - a); py = j; }
      else if (edge === 1) { px = i + 1; py = j + (t - b) / (c - b); }
      else if (edge === 2) { px = i + (t - d) / (c - d); py = j + 1; }
      else { px = i; py = j + (t - a) / (d - a); }
    };
    for (j = 0; j < rows - 1; j++) {
      for (i = 0; i < cols - 1; i++) {
        const o = j * cols + i;
        a = F[o]; b = F[o + 1]; c = F[o + cols + 1]; d = F[o + cols];
        const lo = Math.min(a, b, c, d), hi = Math.max(a, b, c, d);
        const k1 = Math.floor(hi / step);
        for (let k = Math.ceil(Math.max(lo, LAKE + .5) / step); k <= k1; k++) {
          t = k * step;
          const s = SEG[(a > t ? 8 : 0) | (b > t ? 4 : 0) | (c > t ? 2 : 0) | (d > t ? 1 : 0)];
          if (!s) continue;
          for (let m = 0; m < s.length; m += 2) {
            at(s[m]); const x1 = px, y1 = py;
            at(s[m + 1]);
            onSeg(t, x1, y1, px, py);
          }
        }
      }
      if (j % 30 === 29) yield;
    }
  }

  // In Node (the tests) there is no page: hand the helpers over and stop here.
  if (typeof document === 'undefined') {
    module.exports = { LAKE, clamp, ease, mix, rgba, decodeHeights, view, march };
    return;
  }

  /* ---------- browser only ---------- */

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.documentElement;

  // The stage is dark on the light site and light on the dark site.
  const tone = () => (root.dataset.theme === 'dark' ? 'light' : 'dark');

  /* ---------- data ---------- */

  const MAP = { grid: null, dem: null, water: null, lines: null };

  async function load() {
    const [bitmap, json] = await Promise.all([
      fetch(`${DATA}dem.png?v=${DATA_VERSION}`)
        .then((r) => r.blob())
        .then((b) => createImageBitmap(b, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })),
      fetch(`${DATA}water.json?v=${DATA_VERSION}`).then((r) => r.json()),
    ]);
    const { cols, rows } = json.grid;
    const c = document.createElement('canvas');
    c.width = cols; c.height = rows;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bitmap, 0, 0);
    const px = g.getImageData(0, 0, cols, rows).data;

    const { dem, water } = decodeHeights(px, cols, rows);
    Object.assign(MAP, { grid: json.grid, dem, water, lines: json.waters });
  }

  /* ---------- drawing ---------- */


  // Height and water at a point, interpolated from the 40 m grid.
  function sample(E, N, out) {
    const { e0, n1, step, cols, rows } = MAP.grid;
    const gx = clamp((E - e0) / step, 0, cols - 1.001), gy = clamp((n1 - N) / step, 0, rows - 1.001);
    const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j, o = j * cols + i;
    const bl = (A) => (A[o] * (1 - fx) + A[o + 1] * fx) * (1 - fy) + (A[o + cols] * (1 - fx) + A[o + cols + 1] * fx) * fy;
    out[0] = bl(MAP.dem);
    out[1] = bl(MAP.water);
  }

  function* field(W, H, cell) {
    const { cE, cN, s } = view(W, H);
    const cols = Math.ceil(W / cell) + 1, rows = Math.ceil(H / cell) + 1;
    const F = new Float32Array(cols * rows), M = new Float32Array(cols * rows), v = [0, 0];
    for (let j = 0; j < rows; j++) {
      const N = cN - (j * cell - H / 2) / s;
      for (let i = 0; i < cols; i++) {
        sample(cE + (i * cell - W / 2) / s, N, v);
        F[j * cols + i] = v[0];
        M[j * cols + i] = v[1];
      }
      if (j % 40 === 39) yield;
    }
    return { F, M, cols, rows, cell };
  }

  // Hill shading lit from the north-west, plus the lakes, painted at grid size and scaled up smoothly.
  function* shade(g, fld, t) {
    const { F, M, cols, rows, cell } = fld;
    const img = new ImageData(cols, rows), d = img.data;
    const L = [-.5, -.62, .6], ll = Math.hypot(...L);
    const lx = L[0] / ll, ly = L[1] / ll, lz = L[2] / ll;
    const dark = t === 'dark';
    const lake = dark ? [41, 151, 255] : [0, 113, 227], la = dark ? .2 : .12;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const o = j * cols + i, q = o * 4;
        const iL = Math.max(i - 1, 0), iR = Math.min(i + 1, cols - 1);
        const jT = Math.max(j - 1, 0), jB = Math.min(j + 1, rows - 1);
        const nx = -(F[j * cols + iR] - F[j * cols + iL]) / ((iR - iL) * cell) * .05;
        const ny = -(F[jB * cols + i] - F[jT * cols + i]) / ((jB - jT) * cell) * .05;
        const delta = (nx * lx + ny * ly + lz) / Math.hypot(nx, ny, 1) - lz;
        let r, gg, b, a;
        if (delta > 0) {
          [r, gg, b] = dark ? [205, 255, 244] : [255, 255, 255];
          a = Math.min(dark ? .34 : .85, delta * (dark ? .75 : 1.6));
        } else {
          [r, gg, b] = dark ? [0, 0, 0] : [24, 46, 56];
          a = Math.min(dark ? .6 : .32, -delta * (dark ? 1 : .55));
        }
        const w = M[o];
        if (w > 0) {
          r += (lake[0] - r) * w; gg += (lake[1] - gg) * w; b += (lake[2] - b) * w; a += (la - a) * w;
        }
        d[q] = r; d[q + 1] = gg; d[q + 2] = b; d[q + 3] = a * 255;
      }
      if (j % 60 === 59) yield;
    }
    const small = document.createElement('canvas');
    small.width = cols; small.height = rows;
    small.getContext('2d').putImageData(img, 0, 0);
    g.save();
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(small, -cell / 2, -cell / 2, cols * cell, rows * cell);
    g.restore();
  }

  // Lake shores, rivers, the Linth canal and, in the finished map, every stream.
  function waterways(g, W, H, t, final) {
    const { cE, cN, s } = view(W, H);
    const { e0, n1 } = MAP.grid;
    const ox = W / 2 + (e0 - cE) * s, oy = H / 2 - (n1 - cN) * s;
    const blue = t === 'dark' ? [41, 151, 255] : [0, 113, 227];
    const style = { stream: [.5, t === 'dark' ? .38 : .45], river: [final ? .9 : .8, .65], canal: [final ? 1.3 : 1.1, .8], lake: [final ? .9 : .8, .7] };
    const paths = { stream: new Path2D(), river: new Path2D(), canal: new Path2D(), lake: new Path2D() };
    for (const w of MAP.lines) {
      if (w.k === 'stream' && !final) continue;
      const p = paths[w.k], pts = w.p;
      p.moveTo(ox + pts[0] * s, oy + pts[1] * s);
      for (let i = 2; i < pts.length; i += 2) p.lineTo(ox + pts[i] * s, oy + pts[i + 1] * s);
    }
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const k of Object.keys(paths)) {
      g.strokeStyle = rgba(blue, style[k][1]);
      g.lineWidth = style[k][0];
      g.stroke(paths[k]);
    }
    g.restore();
  }

  // A faint kilometre grid of the Swiss coordinate system.
  function grid(g, W, H, t) {
    const { cE, cN, s } = view(W, H);
    g.save();
    g.strokeStyle = t === 'dark' ? 'rgba(235,240,245,.05)' : 'rgba(40,48,56,.07)';
    g.lineWidth = 1;
    g.beginPath();
    for (let k = Math.ceil((cE - W / 2 / s) / 1000); k <= (cE + W / 2 / s) / 1000; k++) {
      const x = W / 2 + (k * 1000 - cE) * s;
      g.moveTo(x, 0); g.lineTo(x, H);
    }
    for (let k = Math.ceil((cN - H / 2 / s) / 1000); k <= (cN + H / 2 / s) / 1000; k++) {
      const y = H / 2 - (k * 1000 - cN) * s;
      g.moveTo(0, y); g.lineTo(W, y);
    }
    g.stroke();
    g.restore();
  }

  // Keeps the name and the tagline readable over the map.
  function veil(g, W, H, t) {
    const bg = STAGE[t];
    for (const [x, y, r, a] of [[W / 2, H * .42, Math.max(W, H) * .44, t === 'dark' ? .6 : .68], [W / 2, H * .72, Math.max(W * .42, 280), t === 'dark' ? .5 : .6]]) {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, rgba(bg, a));
      gr.addColorStop(1, rgba(bg, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
    }
  }

  let liveBase = null;

  // One picture of the map: the live one while scrolling (e = progress), or the detailed final one.
  function* paint(g, W, H, t, final, e) {
    g.fillStyle = rgba(STAGE[t], 1);
    g.fillRect(0, 0, W, H);

    let fld;
    if (final) {
      fld = yield* field(W, H, W * H > 1.3e6 ? 2.5 : 2);
    } else {
      if (!liveBase || liveBase.W !== W || liveBase.H !== H) {
        liveBase = { W, H, fld: yield* field(W, H, W > 900 ? 6 : 5) };
      }
      // The hills rise from the plain as the visitor scrolls.
      const base = liveBase.fld, lift = .55 + .45 * e;
      const F = new Float32Array(base.F.length);
      for (let i = 0; i < F.length; i++) F[i] = LAKE + (base.F[i] - LAKE) * lift;
      fld = { ...base, F };
    }
    yield* shade(g, fld, t);
    grid(g, W, H, t);

    // Contours every 10 m in the final map (every 20 m while moving), a thicker one every 50 m (100 m).
    const q = final
      ? { step: 10, index: 50, w: .5, wi: 1.1, a: t === 'dark' ? .34 : .4, ai: t === 'dark' ? .85 : .9 }
      : { step: 20, index: 100, w: .75, wi: 1.3, a: .42, ai: .8 };
    const BINS = 10, pal = PAL[t], cell = fld.cell;
    const lines = Array.from({ length: BINS }, () => new Path2D());
    const index = Array.from({ length: BINS }, () => new Path2D());
    yield* march(fld, q.step, (level, x1, y1, x2, y2) => {
      const bin = Math.min(BINS - 1, Math.floor(clamp((level - 410) / 1100, 0, .999) * BINS));
      const path = (level % q.index === 0 ? index : lines)[bin];
      path.moveTo(x1 * cell, y1 * cell);
      path.lineTo(x2 * cell, y2 * cell);
    });
    g.lineJoin = 'round';
    g.lineCap = 'round';
    for (let b = 0; b < BINS; b++) {
      const col = mix(pal, (b + .5) / BINS);
      g.strokeStyle = rgba(col, q.a);
      g.lineWidth = q.w;
      g.stroke(lines[b]);
      g.strokeStyle = rgba(col, q.ai);
      g.lineWidth = q.wi;
      g.stroke(index[b]);
      if (final) yield;
    }
    waterways(g, W, H, t, final);
    veil(g, W, H, t);
  }

  /* ---------- engine ---------- */

  const S = { hero: null, box: null, plane: null, live: null, fin: null, W: 0, H: 0, DPR: 1, tone: '', e: -1, locked: false, finalReady: false, job: 0, queued: false };
  const ctx = (c) => { const g = c.getContext('2d'); g.setTransform(S.DPR, 0, 0, S.DPR, 0, 0); return g; };
  const runAll = (it) => { let r; do r = it.next(); while (!r.done); };

  // Runs a drawing in small slices, so the page never stops responding.
  function slices(it, id, done) {
    const step = () => {
      if (id !== S.job) return;
      const t0 = performance.now();
      let r;
      do r = it.next(); while (!r.done && performance.now() - t0 < 12);
      if (r.done) done();
      else setTimeout(step, 0);
    };
    setTimeout(step, 0);
  }

  function progress() {
    if (reducedMotion) return 1;
    const r = S.hero.getBoundingClientRect();
    return clamp(-r.top / Math.max(r.height - innerHeight, 1), 0, 1);
  }

  // Sizes the canvases to the stage; true when the stage itself changed size.
  function resize() {
    const r = S.box.getBoundingClientRect();
    const W = Math.round(r.width), H = Math.round(r.height), DPR = Math.min(2, devicePixelRatio || 1);
    const changed = W !== S.W || H !== S.H || DPR !== S.DPR;
    Object.assign(S, { W, H, DPR });
    for (const c of [S.live, S.fin]) {
      if (c.width !== Math.round(W * DPR)) c.width = Math.round(W * DPR);
      if (c.height !== Math.round(H * DPR)) c.height = Math.round(H * DPR);
    }
    return changed;
  }

  // Draws everything again: first the live map in slices, then the detailed one in the background.
  // The first appearance: a slow fade, so the map grows in while the visitor looks at the name.
  // Once they scroll, the rest of the fade is done in FAST_FADE ms, so the scroll animation is never missed.
  const SLOW_FADE = 3500;
  const FAST_FADE = 400;
  let fade = null;
  let scrolled = false;

  function reveal() {
    if (S.box.classList.contains('ready')) return; // already visible (e.g. after a theme change)
    S.box.classList.add('ready'); // the end state: fully visible
    if (reducedMotion) return;
    fade = S.box.animate([{ opacity: 0 }, { opacity: 1 }], { duration: scrolled ? FAST_FADE : SLOW_FADE, easing: 'ease-out' });
    fade.onfinish = () => { fade = null; };
  }

  function hurryFade() {
    if (scrolled || window.scrollY < 1) return; // the page's own jump to the top is not a visitor scrolling
    scrolled = true;
    if (!fade) return;
    // Play the rest faster: whatever time is left now takes FAST_FADE ms.
    const left = SLOW_FADE - fade.currentTime;
    if (left > FAST_FADE) fade.updatePlaybackRate(left / FAST_FADE);
  }
  window.addEventListener('scroll', hurryFade, { passive: true });

  function redraw() {
    if (!MAP.dem || !S.box) return;
    const id = ++S.job;
    S.finalReady = false;
    S.tone = tone();
    S.box.classList.remove('locked');
    S.e = ease(clamp(progress() / SHRINK_END, 0, 1));
    slices(paint(ctx(S.live), S.W, S.H, S.tone, false, S.e), id, () => {
      reveal();
      const g = ctx(S.fin);
      g.clearRect(0, 0, S.W, S.H);
      slices(paint(g, S.W, S.H, S.tone, true, 1), id, () => {
        S.finalReady = true;
        S.box.classList.toggle('locked', S.locked);
      });
    });
  }

  function frame() {
    S.queued = false;
    if (!S.box || !S.box.isConnected) return;
    const raw = clamp(progress() / SHRINK_END, 0, 1);
    const e = ease(raw);
    S.box.style.setProperty('--map-e', e.toFixed(4));
    S.plane.style.transform = `rotateX(${((1 - e) * 22).toFixed(2)}deg) scale(${(1.45 - .45 * e).toFixed(4)})`;
    const locked = raw >= 1;
    if (locked !== S.locked) {
      S.locked = locked;
      S.box.classList.toggle('locked', locked && S.finalReady);
    }
    const visible = S.hero.getBoundingClientRect().bottom > 0;
    if (MAP.dem && visible && !(locked && S.finalReady) && S.box.classList.contains('ready') && Math.abs(e - S.e) > .002) {
      S.e = e;
      runAll(paint(ctx(S.live), S.W, S.H, S.tone, false, e));
    }
  }
  const schedule = () => { if (!S.queued) { S.queued = true; requestAnimationFrame(frame); } };

  // The page re-renders the hero (language switch, editing), so the map moves into the new one.
  function mount() {
    const box = document.querySelector('.hero .hero-map');
    if (!box || box === S.box) return;
    const old = S.box ? { live: S.live, fin: S.fin, ready: S.box.classList.contains('ready') } : null;
    Object.assign(S, { box, hero: box.closest('.hero'), plane: box.querySelector('.hero-map-plane') });
    [S.live, S.fin] = box.querySelectorAll('canvas');
    const sized = resize();
    if (old && old.ready && !sized && S.tone === tone()) {
      // Same size and colours: carry the finished pictures over instead of drawing them again.
      ctx(S.live).drawImage(old.live, 0, 0, S.W, S.H);
      ctx(S.fin).drawImage(old.fin, 0, 0, S.W, S.H);
      box.classList.add('ready');
      box.classList.toggle('locked', S.locked && S.finalReady);
    } else {
      redraw();
    }
    frame();
  }

  document.addEventListener('cv:render', mount);
  window.addEventListener('scroll', schedule, { passive: true });
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (S.box && resize()) { liveBase = null; redraw(); } schedule(); }, 200);
  });
  new MutationObserver(() => { if (S.box && tone() !== S.tone) redraw(); })
    .observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  // The map is decoration: it follows once the page has loaded and the name has finished flying in.
  // A short head start lets the name appear first; drawing the map earlier would delay it.
  const START_DELAY = 600;
  const start = () => setTimeout(() => {
    const go = () => load().then(() => { mount(); redraw(); }).catch(() => { /* without data the stage stays plain */ });
    if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 2000 });
    else go();
  }, reducedMotion ? 0 : START_DELAY);
  mount();
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
})();
