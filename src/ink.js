// Handwriting on the slides. The Apple Pencil always writes; fingers keep
// scrolling and zooming. Strokes are smoothed with perfect-freehand (the
// algorithm behind tldraw's and Excalidraw's pens): it evens out the jitter of
// the raw input and varies the line width with pen pressure.

import { getStroke } from '../vendor/perfect-freehand.mjs';

export const UNITS = 1000; // every page is 1000 units wide, whatever its size on screen

export const PALETTE = {
  pen: {
    colors: [
      ['#14161c', 'Black'],
      ['#1f4fd8', 'Blue'],
      ['#d92d20', 'Red'],
      ['#12824c', 'Green'],
    ],
    sizes: [2, 3.4, 6],
  },
  highlighter: {
    colors: [
      ['#ffe95c', 'Yellow'],
      ['#a8f0a0', 'Green'],
      ['#ffb3d9', 'Pink'],
      ['#a5d8ff', 'Blue'],
    ],
    sizes: [16, 26, 40],
  },
};

// Handwriting that has been rewritten neatly is kept as a text item
// { tool: 'text', text, x, y, size, lh, w, color }: x / y is the start of the
// first baseline, lh the line height, w the width of the longest line.
export const HAND_FONT = '"PDF Tut Hand"';

export function textBox(item) {
  const lines = item.text.split('\n').length;
  return {
    left: item.x,
    right: item.x + item.w,
    top: item.y - item.size * 0.85,
    bottom: item.y + (lines - 1) * item.lh + item.size * 0.3,
  };
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ERASER_RADIUS = 9;
const REST_MS = 1200; // pause after the last stroke before handwriting is tidied

// iPadOS hands the Pencil to web pages as a touch with touchType "stylus".
// Cancelling that touch is what stops the page from scrolling under the pen,
// so on iPad the stroke is read from the same touch events. Everywhere else
// (desktop pens, mouse, finger drawing) pointer events are used.
const TOUCH_STYLUS = typeof Touch !== 'undefined' && 'touchType' in Touch.prototype;

const round = (v) => Math.round(v * 100) / 100;
const fmt = (v) => v.toFixed(2);

// Turns the outline polygon from perfect-freehand into a smooth closed path:
// each outline point is the control point of a curve that runs between the
// midpoints of its neighbours. Every curve is written out in full (no "T"
// shorthand) because the PDF export parses this same string.
function outlinePath(pts) {
  if (pts.length < 4) return '';
  let d = `M${fmt(pts[0][0])},${fmt(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i];
    const [nx, ny] = pts[i + 1];
    d += `Q${fmt(x)},${fmt(y)} ${fmt((x + nx) / 2)},${fmt((y + ny) / 2)}`;
  }
  return `${d}Z`;
}

export function strokePath(stroke, done = true) {
  const highlighter = stroke.tool === 'highlighter';
  return outlinePath(
    getStroke(stroke.points, {
      size: stroke.size,
      thinning: highlighter ? 0 : 0.5, // how much pressure changes the width
      smoothing: 0.5, // softens the edges of the line
      streamline: highlighter ? 0.5 : 0.38, // irons out jitter in the path itself
      simulatePressure: !stroke.pressure, // mouse and finger: derive width from speed
      last: done,
    }),
  );
}

// ---- eraser geometry ----

function pointToSegment(px, py, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len ? Math.min(1, Math.max(0, ((px - a[0]) * dx + (py - a[1]) * dy) / len)) : 0;
  return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy);
}

const side = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const crosses = (a, b, c, d) => side(c, d, a) * side(c, d, b) < 0 && side(a, b, c) * side(a, b, d) < 0;

// Does the eraser, moving from a to b, touch this stroke?
function touches(stroke, a, b) {
  if (stroke.tool === 'text') {
    const r = textBox(stroke);
    const inside = (x, y) =>
      x >= r.left - ERASER_RADIUS && x <= r.right + ERASER_RADIUS && y >= r.top - ERASER_RADIUS && y <= r.bottom + ERASER_RADIUS;
    return inside(a[0], a[1]) || inside(b[0], b[1]) || inside((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  const reach = ERASER_RADIUS + stroke.size / 2;
  const pts = stroke.points;
  for (let i = 0; i < pts.length; i++) {
    const c = pts[i];
    const d = pts[i + 1] ?? c;
    if (
      crosses(a, b, c, d) ||
      pointToSegment(a[0], a[1], c, d) <= reach ||
      pointToSegment(b[0], b[1], c, d) <= reach ||
      pointToSegment(c[0], c[1], a, b) <= reach ||
      pointToSegment(d[0], d[1], a, b) <= reach
    )
      return true;
  }
  return false;
}

export class Ink {
  constructor(viewer, { onChange = () => {} } = {}) {
    this.viewer = viewer;
    this.onChange = onChange; // (pageNumber, strokes) after every edit
    this.onHistory = () => {}; // undo / redo availability changed
    this.onRest = () => {}; // the pen has been still for a moment
    this.tidy = true; // rewrite handwriting neatly after each pause
    this.fresh = new Map(); // pen stroke not yet looked at for tidying -> page number
    this._restTimer = 0;
    this.pages = new Map(); // page number -> strokes
    this.undoStack = [];
    this.redoStack = [];
    this.tool = 'pen';
    this.style = {
      pen: { color: PALETTE.pen.colors[1][0], size: PALETTE.pen.sizes[1] },
      highlighter: { color: PALETTE.highlighter.colors[0][0], size: PALETTE.highlighter.sizes[1] },
    };
    this.active = null;
    this._paths = new WeakMap(); // stroke -> its <path>
    this._frame = 0;
    viewer.onPageShow = (p) => this._mount(p);
    viewer.onPageHide = (p) => this._unmount(p);
    viewer.onPinch = () => this._cancel();
    this._bind();
  }

  // Replace everything with the handwriting of a newly opened document.
  load(records) {
    this._cancel();
    clearTimeout(this._restTimer);
    this.fresh.clear();
    this.pages = new Map(records.map((r) => [r.page, r.strokes]));
    this.undoStack = [];
    this.redoStack = [];
    for (const p of this.viewer.near) this._mount(p);
    this.onHistory();
  }

  undo() {
    const step = this.undoStack.pop();
    if (!step) return;
    this.redoStack.push(step);
    this._apply(step.page, step.before);
  }

  redo() {
    const step = this.redoStack.pop();
    if (!step) return;
    this.undoStack.push(step);
    this._apply(step.page, step.after);
  }

  _apply(n, strokes) {
    this.pages.set(n, strokes);
    const p = this.viewer.pages[n - 1];
    if (p && this.viewer.near.has(p)) this._mount(p);
    if (n !== this.viewer.current) this.viewer.goTo(n); // show what just changed
    this.onChange(n, strokes);
    this.onHistory();
  }

  // Swap in a new list of items for a page as one undoable step.
  replace(n, after) {
    const before = this.pages.get(n) ?? [];
    this._commit(n, before, after);
    const p = this.viewer.pages[n - 1];
    if (p && this.viewer.near.has(p)) this._mount(p);
  }

  // Dim strokes while they are being read.
  setBusy(strokes, busy) {
    for (const s of strokes) this._paths.get(s)?.classList.toggle('tidying', busy);
  }

  _commit(n, before, after) {
    this.pages.set(n, after);
    this.undoStack.push({ page: n, before, after });
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.onChange(n, after);
    this.onHistory();
  }

  // ---- layers ----

  // Highlighter strokes live in their own layer so the whole layer can be
  // multiplied onto the slide: text stays readable through the colour.
  _layer(p, kind) {
    const tool = kind === 'highlighter' ? 'highlighter' : 'pen';
    p.ink ??= {};
    if (!p.ink[tool]) {
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', `ink ${tool}`);
      svg.setAttribute('viewBox', `0 0 ${UNITS} ${UNITS / p.aspect}`);
      svg.setAttribute('preserveAspectRatio', 'none');
      p.el.insertBefore(svg, (tool === 'highlighter' && p.ink.pen) || p.tab);
      p.ink[tool] = svg;
    }
    return p.ink[tool];
  }

  _pathFor(stroke) {
    let el = this._paths.get(stroke);
    if (el) return el;
    if (stroke.tool === 'text') {
      el = document.createElementNS(SVG_NS, 'text');
      el.setAttribute('font-size', stroke.size);
      el.setAttribute('y', stroke.y);
      stroke.text.split('\n').forEach((line, i) => {
        const span = document.createElementNS(SVG_NS, 'tspan');
        span.setAttribute('x', stroke.x);
        if (i) span.setAttribute('dy', stroke.lh);
        span.textContent = line;
        el.append(span);
      });
    } else {
      el = document.createElementNS(SVG_NS, 'path');
      el.setAttribute('d', strokePath(stroke));
    }
    el.setAttribute('fill', stroke.color);
    this._paths.set(stroke, el);
    return el;
  }

  _mount(p) {
    this._unmount(p);
    for (const stroke of this.pages.get(p.num) ?? []) this._layer(p, stroke.tool).append(this._pathFor(stroke));
  }

  _unmount(p) {
    p.ink?.pen?.remove();
    p.ink?.highlighter?.remove();
    p.ink = null;
  }

  // ---- one stroke ----

  _toUnits(p, x, y) {
    const r = p.el.getBoundingClientRect();
    const k = UNITS / r.width;
    return [round((x - r.left) * k), round((y - r.top) * k)];
  }

  _begin(p, id, x, y, pressure, erase) {
    const pt = this._toUnits(p, x, y);
    clearTimeout(this._restTimer);
    this.viewer.inkActive = true;
    if (erase) {
      this.active = { id, p, erase: true, last: pt, before: this.pages.get(p.num) ?? [] };
      this._eraseAlong(pt, pt);
      return;
    }
    const { color, size } = this.style[this.tool];
    const stroke = { tool: this.tool, color, size, pressure: pressure > 0, points: [[pt[0], pt[1], pressure]] };
    const el = document.createElementNS(SVG_NS, 'path');
    el.setAttribute('fill', color);
    this._layer(p, stroke.tool).append(el);
    this.active = { id, p, stroke, el };
    this._paint();
  }

  _extend(x, y, pressure) {
    const a = this.active;
    const pt = this._toUnits(a.p, x, y);
    if (a.erase) {
      this._eraseAlong(a.last, pt);
      a.last = pt;
      return;
    }
    const pts = a.stroke.points;
    const last = pts[pts.length - 1];
    if (pt[0] === last[0] && pt[1] === last[1]) return;
    if (pressure > 0) a.stroke.pressure = true;
    pts.push([pt[0], pt[1], pressure]);
    this._paint();
  }

  _paint() {
    if (this._frame) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = 0;
      const a = this.active;
      if (a?.stroke) a.el.setAttribute('d', strokePath(a.stroke, false));
    });
  }

  _end() {
    const a = this.active;
    if (!a) return;
    this.active = null;
    this.viewer.inkActive = false;
    const n = a.p.num;
    if (a.erase) {
      const after = this.pages.get(n) ?? [];
      if (after.length !== a.before.length) this._commit(n, a.before, after);
    } else {
      a.el.setAttribute('d', strokePath(a.stroke, true));
      this._paths.set(a.stroke, a.el);
      const before = this.pages.get(n) ?? [];
      this._commit(n, before, [...before, a.stroke]);
      if (this.tidy && a.stroke.tool === 'pen') this.fresh.set(a.stroke, n);
    }
    if (this.fresh.size) {
      this._restTimer = setTimeout(() => {
        if (!this.active) this.onRest();
      }, REST_MS);
    }
  }

  // Drop the stroke in progress, e.g. when a second finger starts a pinch.
  _cancel() {
    const a = this.active;
    if (!a) return;
    if (a.erase) return this._end();
    a.el.remove();
    this.active = null;
    this.viewer.inkActive = false;
  }

  _eraseAlong(from, to) {
    const n = this.active.p.num;
    const strokes = this.pages.get(n);
    if (!strokes?.length) return;
    const keep = strokes.filter((s) => !touches(s, from, to));
    if (keep.length === strokes.length) return;
    for (const s of strokes) if (!keep.includes(s)) this._paths.get(s)?.remove();
    this.pages.set(n, keep);
  }

  // ---- input ----

  _bind() {
    const s = this.viewer.scroller;

    const pointerDraws = (e) => {
      if (e.pointerType === 'pen') return !TOUCH_STYLUS;
      if (!this.viewer.fingerDraw || !e.isPrimary) return false;
      return e.pointerType === 'touch' || (e.pointerType === 'mouse' && e.button === 0);
    };

    s.addEventListener('pointerdown', (e) => {
      if (this.active || !pointerDraws(e) || e.target.closest('.tab')) return;
      const p = this.viewer.pageUnder(e.clientX, e.clientY);
      if (!p) return;
      e.preventDefault();
      try {
        s.setPointerCapture(e.pointerId);
      } catch {}
      const pen = e.pointerType === 'pen';
      // Styluses with an eraser end report it as button 5.
      const erase = this.tool === 'eraser' || (pen && (e.button === 5 || (e.buttons & 32) !== 0));
      this._begin(p, `p${e.pointerId}`, e.clientX, e.clientY, pen ? e.pressure : 0, erase);
    });

    s.addEventListener('pointermove', (e) => {
      if (this.active?.id !== `p${e.pointerId}`) return;
      const pen = e.pointerType === 'pen';
      // Coalesced events carry every sample the pen produced since the last
      // frame, not just the latest one.
      const samples = e.getCoalescedEvents?.() ?? [];
      for (const ev of samples.length ? samples : [e]) this._extend(ev.clientX, ev.clientY, pen ? ev.pressure : 0);
    });

    const release = (e) => {
      if (this.active?.id === `p${e.pointerId}`) this._end();
    };
    s.addEventListener('pointerup', release);
    s.addEventListener('pointercancel', release);

    if (!TOUCH_STYLUS) return;

    const stylus = (e) => [...e.changedTouches].filter((t) => t.touchType === 'stylus');

    s.addEventListener(
      'touchstart',
      (e) => {
        if (e.target.closest('.tab')) return; // let the Pencil tap a ribbon
        for (const t of stylus(e)) {
          e.preventDefault(); // the Pencil writes; it never scrolls
          if (this.active) continue;
          const p = this.viewer.pageUnder(t.clientX, t.clientY);
          if (p) this._begin(p, `t${t.identifier}`, t.clientX, t.clientY, t.force, this.tool === 'eraser');
        }
      },
      { passive: false },
    );

    s.addEventListener(
      'touchmove',
      (e) => {
        for (const t of stylus(e)) {
          if (e.cancelable) e.preventDefault();
          if (this.active?.id === `t${t.identifier}`) this._extend(t.clientX, t.clientY, t.force);
        }
      },
      { passive: false },
    );

    const lift = (e) => {
      for (const t of stylus(e)) if (this.active?.id === `t${t.identifier}`) this._end();
    };
    s.addEventListener('touchend', lift);
    s.addEventListener('touchcancel', lift);
  }
}
