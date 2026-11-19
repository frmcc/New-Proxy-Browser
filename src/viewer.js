// The PDF view: a vertical run of pages that renders only what is near the
// screen, tracks which slide is current, and handles pinch zoom itself.

import * as pdfjs from '../vendor/pdfjs/pdf.min.mjs';

const VENDOR = new URL('../vendor/pdfjs/', import.meta.url).href;
// Rarely needed extras (CJK character maps, the 14 standard fonts, colour
// profiles) are fetched on demand rather than shipped with the app.
const CDN = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/`;
pdfjs.GlobalWorkerOptions.workerSrc = `${VENDOR}pdf.worker.min.mjs`;

const MAX_PIXELS = 12_000_000; // per canvas; iPad Safari refuses much more
const OFFSCREEN_PIXELS = 5_500_000; // pages waiting just outside the view get less
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const PORTRAIT_MAX_WIDTH = 920;
const PEN_GRACE = 600; // ms after a stroke during which touches still count as the writing hand
const PEN_SESSION = 5000; // ms after a stroke during which a finger may not draw

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function release(canvas) {
  if (!canvas) return;
  canvas.width = canvas.height = 0; // hands the bitmap memory back straight away
  canvas.remove();
}

async function extractText(page) {
  const content = await page.getTextContent();
  let out = '';
  for (const item of content.items) {
    if (item.str === undefined) continue;
    out += item.str;
    if (item.hasEOL) out += '\n';
  }
  return out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export class Viewer {
  constructor(scroller, { onPageChange = () => {}, onMarkerTap = () => {} } = {}) {
    this.scroller = scroller;
    this.onPageChange = onPageChange;
    this.onMarkerTap = onMarkerTap;
    // Hooks for the ink layer.
    this.onPageShow = () => {};
    this.onPageHide = () => {};
    this.onPinch = () => {};
    this.inkActive = false; // the pen (or mouse) is drawing right now
    this.fingerDraw = false; // "draw with a finger" is switched on
    this.fingerInk = false; // a finger is drawing right now
    this._penUntil = 0; // the pen counts as "in use" until this time
    this._penLast = -Infinity; // when the pen last touched or lifted
    this._fingers = new Set(); // ids of the finger touches that are down
    this._palms = new Set(); // touches of the writing hand: ignored until they lift
    this._lockTimer = 0;
    this.doc = null;
    this.pages = [];
    this.near = new Set();
    this.zoom = 1;
    this.current = 1;
    this._fx = this._fy = 0.5;
    this._scrollQueued = false;
    this._io = new IntersectionObserver((entries) => this._onIntersect(entries), {
      root: scroller,
      rootMargin: '80% 0px',
    });
    new ResizeObserver(() => this._relayout()).observe(scroller);
    scroller.addEventListener('scroll', () => this._onScroll(), { passive: true });
    this._bindGestures();
  }

  get numPages() {
    return this.pages.length;
  }

  async open(data) {
    await this.close();
    const task = pdfjs.getDocument({
      data,
      wasmUrl: `${VENDOR}wasm/`,
      cMapUrl: `${CDN}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${CDN}standard_fonts/`,
      iccUrl: `${CDN}iccs/`,
    });
    const doc = await task.promise;
    this._task = task;
    this.doc = doc;

    const first = (await doc.getPage(1)).getViewport({ scale: 1 });
    const aspect = first.width / first.height;
    const fragment = document.createDocumentFragment();
    for (let n = 1; n <= doc.numPages; n++) {
      const el = document.createElement('div');
      el.className = 'page';
      el.dataset.page = n;
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'tab';
      tab.hidden = true;
      tab.setAttribute('aria-label', `Show the note for slide ${n}`);
      tab.addEventListener('click', () => this.onMarkerTap(n));
      el.append(tab);
      fragment.append(el);
      this.pages.push({ num: n, el, tab, aspect, canvas: null, task: null, gen: 0, renderedW: 0, text: null });
    }
    this.scroller.append(fragment);
    this._setZoomVar(1);
    this._layout();
    this.scroller.scrollTop = 0;
    this.current = 1;
    this._fx = this._fy = 0.5;
    this._updateCurrent();
    for (const p of this.pages) this._io.observe(p.el);
    this._scanned = this._scan(doc, this.pages);
    return { id: doc.fingerprints[0], numPages: doc.numPages };
  }

  async close() {
    for (const p of this.pages) {
      p.task?.cancel();
      this._io.unobserve(p.el);
      release(p.canvas);
    }
    this.pages = [];
    this.near.clear();
    this._fingers.clear();
    this._palms.clear();
    this._syncLock();
    this.scroller.replaceChildren();
    const task = this._task;
    this.doc = null;
    this._task = null;
    if (task) await task.destroy().catch(() => {});
  }

  // One background pass over the whole file: corrects page shapes that
  // differ from the first page and collects each slide's text.
  async _scan(doc, pages) {
    for (const p of pages) {
      if (this.doc !== doc) return;
      try {
        const page = await doc.getPage(p.num);
        const vp = page.getViewport({ scale: 1 });
        const aspect = vp.width / vp.height;
        if (Math.abs(aspect - p.aspect) > 0.005) {
          p.aspect = aspect;
          this._queueRelayout();
          if (this.near.has(p)) this.onPageShow(p);
        }
        if (p.text === null) p.text = await extractText(page);
      } catch {
        if (p.text === null) p.text = '';
      }
    }
  }

  async pageText(n) {
    const p = this.pages[n - 1];
    if (p.text === null) {
      try {
        p.text = await extractText(await this.doc.getPage(n));
      } catch {
        p.text = '';
      }
    }
    return p.text;
  }

  // Text of every slide, waiting at most `waitMs` for the background pass.
  async deckTexts(waitMs) {
    const pages = this.pages;
    await Promise.race([this._scanned, sleep(waitMs)]);
    return pages.map((p) => p.text ?? '');
  }

  // The slide as a JPEG for the model, base64 without the data: prefix.
  async snapshot(n, maxSide = 1280) {
    const p = this.pages[n - 1];
    const w = Math.round(p.aspect >= 1 ? maxSide : maxSide * p.aspect);
    const h = Math.round(w / p.aspect);
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    if (p.canvas && p.canvas.width >= w * 0.75) {
      const ctx = out.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(p.canvas, 0, 0, w, h);
    } else {
      const page = await this.doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      await page.render({ canvas: out, viewport: page.getViewport({ scale: w / base.width }) }).promise;
    }
    const data = out.toDataURL('image/jpeg', 0.8).split(',')[1];
    release(out);
    return data;
  }

  // The page under a screen point, or null over the desk between pages.
  pageUnder(x, y) {
    if (!this.pages.length) return null;
    const s = this.scroller;
    const p = this.pages[this._indexAt(s.scrollTop + y - s.getBoundingClientRect().top)];
    const r = p.el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom ? p : null;
  }

  // Optional: one finger draws, two fingers move and zoom.
  setFingerDraw(on) {
    this.fingerDraw = on;
    this.scroller.classList.toggle('finger-draw', on);
  }

  // ---- pen and palm ----
  // Fingers move the slides and the pen writes. The hand holding the pen also
  // rests on the glass, so while the pen is in use everything else that
  // touches the screen is treated as that hand: it cannot scroll, zoom or tap,
  // and stays ignored until it lifts. The view is pinned for that time.

  penDown() {
    this.inkActive = true;
    this._penLast = performance.now();
    for (const id of this._fingers) this._palms.add(id); // already resting: the writing hand
    this._dropGestures();
    this._syncLock();
  }

  penUp() {
    this.inkActive = false;
    // The hand hops along between strokes; keep ignoring it for a moment.
    this._penLast = performance.now();
    this._penUntil = this._penLast + PEN_GRACE;
    this._syncLock();
  }

  // Someone writing with the pen is not also drawing with a finger: with
  // "draw with a finger" on, the hand must not leave marks between strokes.
  penRecent() {
    return this.inkActive || performance.now() - this._penLast < PEN_SESSION;
  }

  penBusy() {
    return this.inkActive || performance.now() < this._penUntil;
  }

  _syncLock() {
    clearTimeout(this._lockTimer);
    const busy = this.penBusy();
    // Pinning matters only where a touch can scroll.
    this.scroller.classList.toggle('writing', (busy || this._palms.size > 0) && navigator.maxTouchPoints > 0);
    if (busy && !this.inkActive)
      this._lockTimer = setTimeout(() => this._syncLock(), this._penUntil - performance.now() + 20);
  }

  setMarked(n, marked) {
    const p = this.pages[n - 1];
    if (p) p.tab.hidden = !marked;
  }

  goTo(n, behavior = 'smooth') {
    const p = this.pages[clamp(n, 1, this.pages.length) - 1];
    if (!p) return;
    const s = this.scroller;
    const spare = s.clientHeight - p.el.offsetHeight;
    s.scrollTo({ top: p.el.offsetTop - Math.max(spare / 2, 12), behavior });
  }

  // ---- layout ----

  _layout() {
    const s = this.scroller;
    const cs = getComputedStyle(s);
    const availW = s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = s.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (availW <= 0 || availH <= 0) return;
    for (const p of this.pages) {
      // Slides are shown whole; upright pages fill the width instead.
      const width =
        p.aspect >= 1 ? Math.min(availW, availH * p.aspect) : Math.min(availW, PORTRAIT_MAX_WIDTH);
      p.el.style.setProperty('--bw', `${Math.floor(width)}px`);
      p.el.style.aspectRatio = String(p.aspect);
    }
  }

  // Sizes changed (rotation, the note opening, a page shape corrected):
  // lay out again and keep the current slide where it was in the view.
  _relayout() {
    const s = this.scroller;
    const p = this.pages[this.current - 1];
    if (!p || !s.clientHeight) return;
    this._layout();
    s.scrollTop = p.el.offsetTop + this._fy * p.el.offsetHeight - s.clientHeight / 2;
    s.scrollLeft = p.el.offsetLeft + this._fx * p.el.offsetWidth - s.clientWidth / 2;
    this._renderNear();
  }

  _queueRelayout() {
    if (this._relayoutQueued) return;
    this._relayoutQueued = true;
    requestAnimationFrame(() => {
      this._relayoutQueued = false;
      this._relayout();
    });
  }

  _indexAt(contentY) {
    let lo = 0;
    let hi = this.pages.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.pages[mid].el.offsetTop <= contentY) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  // Remember which spot of which page sits under a screen point...
  _capture(x, y) {
    const s = this.scroller;
    const p = this.pages[this._indexAt(s.scrollTop + y - s.getBoundingClientRect().top)];
    const r = p.el.getBoundingClientRect();
    return { p, fx: (x - r.left) / r.width, fy: (y - r.top) / r.height };
  }

  // ...and scroll so that the same spot is under (x, y) again.
  _restore({ p, fx, fy }, x, y) {
    const r = p.el.getBoundingClientRect();
    this.scroller.scrollLeft += r.left + fx * r.width - x;
    this.scroller.scrollTop += r.top + fy * r.height - y;
  }

  _onScroll() {
    if (this.zoom > 1.01) {
      // Zoomed in: once scrolling settles, sharpen whatever came into view.
      clearTimeout(this._settleTimer);
      this._settleTimer = setTimeout(() => this._renderNear(), 160);
    }
    if (this._scrollQueued) return;
    this._scrollQueued = true;
    requestAnimationFrame(() => {
      this._scrollQueued = false;
      this._updateCurrent();
    });
  }

  _updateCurrent() {
    const s = this.scroller;
    if (!this.pages.length || !s.clientHeight) return;
    let n;
    if (s.scrollTop <= 1) n = 1;
    else if (s.scrollTop + s.clientHeight >= s.scrollHeight - 1) n = this.pages.length;
    else n = this._indexAt(s.scrollTop + s.clientHeight / 2) + 1;
    // Which spot of the current slide is at the centre of the view; _relayout
    // puts it back there.
    const el = this.pages[n - 1].el;
    this._fy = (s.scrollTop + s.clientHeight / 2 - el.offsetTop) / el.offsetHeight;
    this._fx = (s.scrollLeft + s.clientWidth / 2 - el.offsetLeft) / el.offsetWidth;
    if (n !== this.current) {
      this.current = n;
      this.onPageChange(n);
    }
  }

  // ---- rendering ----

  _onIntersect(entries) {
    for (const entry of entries) {
      const p = this.pages[entry.target.dataset.page - 1];
      if (!p || p.el !== entry.target) continue;
      if (entry.isIntersecting) {
        this.near.add(p);
        this._render(p);
        this.onPageShow(p);
      } else {
        this.near.delete(p);
        this._free(p);
        this.onPageHide(p);
      }
    }
  }

  _renderNear() {
    for (const p of this.near) this._render(p);
  }

  _free(p) {
    p.gen++;
    p.task?.cancel();
    p.task = null;
    release(p.canvas);
    p.canvas = null;
    p.renderedW = 0;
    p.pendingW = 0;
  }

  async _render(p) {
    const cssW = p.el.clientWidth;
    if (!cssW) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    // Full sharpness only for what is on screen: zoomed in, a page is large,
    // and three of them at full size would exhaust the iPad's canvas memory.
    const view = this.scroller.getBoundingClientRect();
    const box = p.el.getBoundingClientRect();
    const budget = box.bottom > view.top && box.top < view.bottom ? MAX_PIXELS : OFFSCREEN_PIXELS;
    const target = Math.min(Math.round(cssW * dpr), Math.floor(Math.sqrt(budget * p.aspect)));
    // Keep a canvas that is already sharp enough and not wastefully large.
    if (p.renderedW && target <= p.renderedW * 1.05 && target >= p.renderedW * 0.75) return;
    if (p.pendingW === target) return;

    const gen = ++p.gen;
    p.task?.cancel();
    p.pendingW = target;
    const doc = this.doc;
    let canvas;
    try {
      const page = await doc.getPage(p.num);
      if (gen !== p.gen || this.doc !== doc) return;
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: target / base.width });
      canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      p.task = page.render({ canvas, viewport });
      await p.task.promise;
      if (gen !== p.gen) return release(canvas);
      // Swap only once the new bitmap is complete, so zooming never flashes.
      release(p.canvas);
      p.canvas = canvas;
      p.renderedW = target;
      p.el.prepend(canvas);
      canvas = null;
    } catch (e) {
      if (e?.name !== 'RenderingCancelledException') console.error(`Slide ${p.num} failed to render`, e);
    } finally {
      release(canvas);
      if (gen === p.gen) {
        p.task = null;
        p.pendingW = 0;
      }
    }
  }

  // ---- zoom ----

  _setZoomVar(z) {
    this.zoom = z;
    this.scroller.style.setProperty('--zoom', String(z));
    this.scroller.classList.toggle('zoomed', z > 1.01);
  }

  _zoomTo(z, x, y, anchor = this._capture(x, y)) {
    this._setZoomVar(clamp(z, MIN_ZOOM, MAX_ZOOM));
    this._restore(anchor, x, y);
    this._updateCurrent();
  }

  _bindGestures() {
    const s = this.scroller;
    const distance = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const middle = (t) => [(t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2];

    // The Apple Pencil shows up among the touches too, and so does the hand
    // that holds it. Only free fingers may move the slides.
    const isFinger = (t) => t.touchType !== 'stylus';
    const fingers = (e) => [...e.touches].filter((t) => isFinger(t) && !this._palms.has(t.identifier));

    // Forget touches that are gone, in case an end event never arrived.
    const prune = (e) => {
      const down = new Set([...e.touches].map((t) => t.identifier));
      for (const set of [this._fingers, this._palms]) for (const id of set) if (!down.has(id)) set.delete(id);
    };

    let pinch = null;
    let tap = null; // candidate for a double tap
    let lastTap = null;
    this._dropGestures = () => {
      if (pinch?.live) this._renderNear();
      pinch = tap = lastTap = null;
    };

    s.addEventListener(
      'touchstart',
      (e) => {
        prune(e);
        const writing = this.penBusy();
        let palm = false;
        for (const t of e.changedTouches) {
          if (!isFinger(t)) continue;
          this._fingers.add(t.identifier);
          if (writing) {
            // It landed while the pen is in use: the writing hand.
            this._palms.add(t.identifier);
            palm = true;
          }
        }
        if (palm) {
          if (e.cancelable) e.preventDefault();
          return this._syncLock();
        }
        if (!this.pages.length || this._palms.size) return;
        const f = fingers(e);
        if (f.length === 2 && e.touches.length === 2) {
          e.preventDefault();
          if (this.fingerInk) this.onPinch(); // the first finger was not drawing after all
          const [x, y] = middle(f);
          pinch = { distance: distance(f), x, y, zoom: this.zoom, anchor: null, live: false };
          tap = null;
        } else if (f.length === 1 && e.touches.length === 1 && !this.fingerDraw && !e.target.closest('.tab')) {
          tap = { x: f[0].clientX, y: f[0].clientY, t: e.timeStamp };
        }
      },
      { passive: false },
    );

    s.addEventListener(
      'touchmove',
      (e) => {
        if (this._palms.size || this.inkActive) {
          // The writing hand shifts as it writes; that must not move anything.
          if (e.cancelable) e.preventDefault();
          return;
        }
        const f = fingers(e);
        if (pinch && f.length === 2) {
          e.preventDefault();
          const [x, y] = middle(f);
          const d = distance(f);
          if (!pinch.live) {
            // Two touches that barely move are not a pinch yet.
            if (Math.abs(d - pinch.distance) < 8 && Math.hypot(x - pinch.x, y - pinch.y) < 8) return;
            pinch.live = true;
            pinch.distance = d;
            pinch.anchor = this._capture(x, y);
          }
          this._zoomTo((pinch.zoom * d) / pinch.distance, x, y, pinch.anchor);
        } else if (tap) {
          if (!f[0] || Math.hypot(f[0].clientX - tap.x, f[0].clientY - tap.y) > 10) tap = null;
        }
      },
      { passive: false },
    );

    const end = (e) => {
      let palmLifted = false;
      for (const t of e.changedTouches) {
        this._fingers.delete(t.identifier);
        if (this._palms.delete(t.identifier)) palmLifted = true;
      }
      prune(e);
      if (palmLifted || this._palms.size || this.penBusy()) {
        this._dropGestures();
        return this._syncLock();
      }
      const f = fingers(e);
      if (pinch && f.length < 2) {
        const moved = pinch.live;
        pinch = null;
        if (moved) {
          this._renderNear();
          this._updateCurrent();
        }
        return;
      }
      if (!tap || f.length || e.timeStamp - tap.t > 300) return (tap = null);
      if (lastTap && tap.t - lastTap.t < 320 && Math.hypot(tap.x - lastTap.x, tap.y - lastTap.y) < 36) {
        e.preventDefault();
        this._zoomTo(this.zoom > 1.05 ? 1 : 2, tap.x, tap.y);
        this._renderNear();
        this._updateCurrent();
        lastTap = null;
      } else {
        lastTap = tap;
      }
      tap = null;
    };
    s.addEventListener('touchend', end, { passive: false });
    s.addEventListener('touchcancel', (e) => {
      for (const t of e.changedTouches) {
        this._fingers.delete(t.identifier);
        this._palms.delete(t.identifier);
      }
      prune(e);
      this._dropGestures();
      this._syncLock();
    });

    // Trackpad pinch and ctrl + wheel on a desktop browser.
    let wheelTimer;
    s.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey || !this.pages.length) return;
        e.preventDefault();
        this._zoomTo(this.zoom * Math.exp(-e.deltaY / 200), e.clientX, e.clientY);
        clearTimeout(wheelTimer);
        wheelTimer = setTimeout(() => this._renderNear(), 150);
      },
      { passive: false },
    );
  }
}
