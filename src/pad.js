// A small box to write in by hand, used for quiz answers. Same rules as on
// the slides: the pen writes, the resting hand is ignored (see palm.js), and
// strokes are smoothed with the same algorithm.

import { strokePath } from './ink.js';
import { palm } from './palm.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const TOUCH_STYLUS = typeof Touch !== 'undefined' && 'touchType' in Touch.prototype;
const round = (v) => Math.round(v * 100) / 100;

export class Pad {
  constructor(el, { onRest = () => {}, onChange = () => {}, restMs = 1800, allowFinger = () => false } = {}) {
    this.el = el;
    this.onRest = onRest; // the pen has been still for a moment
    this.onChange = onChange; // something was written or wiped
    this.restMs = restMs;
    this.allowFinger = allowFinger;
    this.strokes = [];
    this.active = null;
    this._timer = 0;
    this._frame = 0;
    this.svg = document.createElementNS(SVG_NS, 'svg');
    el.append(this.svg);
    this._bind();
  }

  get empty() {
    return !this.strokes.length;
  }

  // Show another answer. The array stays owned by the caller, so each card
  // keeps what was written on it.
  load(strokes) {
    this._drop();
    clearTimeout(this._timer);
    this.strokes = strokes;
    this.svg.replaceChildren(...strokes.map((s) => this._path(s)));
    this.el.classList.toggle('has-ink', strokes.length > 0);
  }

  clear() {
    this._drop();
    clearTimeout(this._timer);
    this.strokes.length = 0;
    this.svg.replaceChildren();
    this.el.classList.remove('has-ink');
    this.onChange();
  }

  // Ask for onRest again after the usual pause, unless writing resumes.
  nudge() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      if (!this.active && !this.empty) this.onRest();
    }, this.restMs);
  }

  // What is written, dark on white, as a base64 JPEG for the model.
  image() {
    const r = this.el.getBoundingClientRect();
    const k = 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(r.width * k);
    canvas.height = Math.ceil(r.height * k);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(k, k);
    ctx.fillStyle = '#111';
    for (const s of this.strokes) ctx.fill(new Path2D(strokePath(s)));
    const data = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
    canvas.width = canvas.height = 0;
    return data;
  }

  _path(stroke) {
    const el = document.createElementNS(SVG_NS, 'path');
    el.setAttribute('d', strokePath(stroke));
    return el;
  }

  _point(x, y) {
    const r = this.el.getBoundingClientRect();
    return [round(x - r.left), round(y - r.top)];
  }

  _begin(id, x, y, pressure, finger) {
    clearTimeout(this._timer);
    if (!finger) palm.penDown();
    const [px, py] = this._point(x, y);
    const stroke = { tool: 'pen', size: 2.8, pressure: pressure > 0, points: [[px, py, pressure]] };
    const el = document.createElementNS(SVG_NS, 'path');
    this.svg.append(el);
    this.active = { id, finger, stroke, el };
    this.el.classList.add('has-ink');
    this.onChange();
    this._paint();
  }

  _extend(x, y, pressure) {
    const { stroke } = this.active;
    const [px, py] = this._point(x, y);
    const last = stroke.points[stroke.points.length - 1];
    if (px === last[0] && py === last[1]) return;
    if (pressure > 0) stroke.pressure = true;
    stroke.points.push([px, py, pressure]);
    this._paint();
  }

  _paint() {
    if (this._frame) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = 0;
      if (this.active) this.active.el.setAttribute('d', strokePath(this.active.stroke, false));
    });
  }

  _end() {
    const a = this.active;
    if (!a) return;
    this.active = null;
    if (!a.finger) palm.penUp();
    a.el.setAttribute('d', strokePath(a.stroke, true));
    this.strokes.push(a.stroke);
    this.nudge();
  }

  _drop() {
    const a = this.active;
    if (!a) return;
    this.active = null;
    if (!a.finger) palm.penUp();
    a.el.remove();
  }

  _bind() {
    const el = this.el;
    const draws = (e) => {
      if (e.pointerType === 'pen') return !TOUCH_STYLUS;
      if (e.pointerType === 'mouse') return e.button === 0;
      return e.pointerType === 'touch' && e.isPrimary && this.allowFinger() && !palm.recent();
    };

    el.addEventListener('pointerdown', (e) => {
      if (!draws(e)) return;
      if (this.active?.finger && e.pointerType !== 'touch') this._drop(); // the pen takes over from a resting hand
      if (this.active) return;
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {}
      const pen = e.pointerType === 'pen';
      this._begin(`p${e.pointerId}`, e.clientX, e.clientY, pen ? e.pressure : 0, e.pointerType === 'touch');
    });
    el.addEventListener('pointermove', (e) => {
      if (this.active?.id !== `p${e.pointerId}`) return;
      const pen = e.pointerType === 'pen';
      const samples = e.getCoalescedEvents?.() ?? [];
      for (const ev of samples.length ? samples : [e]) this._extend(ev.clientX, ev.clientY, pen ? ev.pressure : 0);
    });
    const release = (e) => {
      if (this.active?.id === `p${e.pointerId}`) this._end();
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);

    if (!TOUCH_STYLUS) return;
    const stylus = (e) => [...e.changedTouches].filter((t) => t.touchType === 'stylus');
    el.addEventListener(
      'touchstart',
      (e) => {
        for (const t of stylus(e)) {
          if (e.cancelable) e.preventDefault();
          if (this.active?.finger) this._drop();
          if (!this.active) this._begin(`t${t.identifier}`, t.clientX, t.clientY, t.force, false);
        }
      },
      { passive: false },
    );
    el.addEventListener(
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
    el.addEventListener('touchend', lift);
    el.addEventListener('touchcancel', lift);
  }
}
