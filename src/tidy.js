// Rewrites handwriting neatly. When the pen has been still for a moment, the
// strokes written since then are grouped into blocks of writing, each block is
// read by Gemini, and the scribble is replaced by the same words set in a
// clean handwriting font at the same spot, size and colour. Undo brings the
// original strokes back and leaves them alone.

import { generateText } from './gemini.js';
import { strokePath, textBox, HAND_FONT, UNITS } from './ink.js';
import * as store from './store.js';

const DECLINE = '∅';

const SYSTEM = `You read handwriting. The image shows what a student wrote by hand with a stylus on a lecture slide. Reply with the transcription and nothing else.

- Transcribe what is written, in the language it is written in. Do not translate, complete, rephrase or comment.
- Keep line breaks: one line of handwriting is one line of text.
- Where a letter or word could be read two ways, prefer the reading that fits the slide text given as context. Never add words that are not in the image.
- Write simple maths with Unicode characters (x², ≤, →, α, π).
- If the image is not writing (a drawing, arrow, underline, circle, bracket, box, tick or doodle), or is a formula that needs stacked layout such as a fraction or an integral with limits, reply with exactly: ${DECLINE}
- If you cannot read it with confidence, reply with exactly: ${DECLINE}`;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v) => Math.round(v * 100) / 100;

function bounds(strokes) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const s of strokes) {
    const r = s.size / 2;
    for (const [x, y] of s.points) {
      left = Math.min(left, x - r);
      right = Math.max(right, x + r);
      top = Math.min(top, y - r);
      bottom = Math.max(bottom, y + r);
    }
  }
  return { left, top, right, bottom };
}

// Groups strokes that sit close together into blocks: the letters of a word,
// the words of a line, and lines written directly under each other.
function cluster(strokes) {
  const boxes = strokes.map((s) => bounds([s]));
  const heights = boxes.map((b) => b.bottom - b.top).sort((a, b) => a - b);
  const letter = clamp(heights[heights.length >> 1], 14, 60);
  const gx = letter * 1.3;
  const gy = letter * 0.45;

  const parent = strokes.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.left - gx <= b.right && b.left - gx <= a.right && a.top - gy <= b.bottom && b.top - gy <= a.bottom)
        parent[find(i)] = find(j);
    }
  }
  const blocks = new Map();
  strokes.forEach((s, i) => {
    const root = find(i);
    if (!blocks.has(root)) blocks.set(root, []);
    blocks.get(root).push(s);
  });
  return [...blocks.values()];
}

// Underlines, arrows, dots and big outlines are not worth a request.
function looksLikeMark(strokes, box) {
  if (strokes.length > 2) return false;
  const w = box.right - box.left;
  const h = box.bottom - box.top;
  if (w < 9 && h < 9) return true;
  if (w > 600 || h > 350) return true;
  if (strokes.length > 1) return false;
  const pts = strokes[0].points;
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const direct = Math.hypot(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]);
  return length > 30 && direct / length > 0.92;
}

// The block as a dark-on-white image for the model.
function blockImage(strokes, box) {
  const pad = 16;
  const w = box.right - box.left + pad * 2;
  const h = box.bottom - box.top + pad * 2;
  const k = Math.min(clamp(170 / h, 1.5, 6), 1600 / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * k);
  canvas.height = Math.ceil(h * k);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(k, 0, 0, k, (pad - box.left) * k, (pad - box.top) * k);
  ctx.fillStyle = '#111';
  for (const s of strokes) ctx.fill(new Path2D(strokePath(s)));
  const data = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
  canvas.width = canvas.height = 0;
  return data;
}

function clean(raw) {
  let t = raw.trim().replace(/^```[a-z]*\s*|\s*```$/g, '').trim();
  const quoted = t.match(/^"([\s\S]*)"$/);
  if (quoted) t = quoted[1].trim();
  if (!t || t.includes(DECLINE) || /^(none|n\/a)$/i.test(t)) return null;
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length > 8 || t.length > 300) return null;
  return lines.join('\n');
}

// ---- laying the neat text out where the scribble was ----

let measurer;
// Size of a string in the handwriting font, per unit of font size.
function measure(text) {
  measurer ??= document.createElement('canvas').getContext('2d');
  measurer.font = `400 100px ${HAND_FONT}`;
  const m = measurer.measureText(text);
  return { w: m.width / 100, ascent: m.actualBoundingBoxAscent / 100, descent: m.actualBoundingBoxDescent / 100 };
}

// Reuse a size already on the page when it is close, so notes look even.
function snap(size, items) {
  let best = size;
  let nearest = 0.2;
  for (const item of items) {
    if (item.tool !== 'text') continue;
    const off = Math.abs(item.size - size) / size;
    if (off < nearest) {
      nearest = off;
      best = item.size;
    }
  }
  return best;
}

function layout(text, box, color, items) {
  const lines = text.split('\n');
  const boxW = box.right - box.left;
  const boxH = box.bottom - box.top;
  const sizes = lines.map(measure);
  const widest = Math.max(...sizes.map((m) => m.w), 0.1);
  let size;
  let y;
  if (lines.length === 1) {
    // Match the height of what was written, nudged towards its width.
    const m = sizes[0];
    const byHeight = boxH / Math.max(m.ascent + m.descent, 0.3);
    size = snap(clamp(clamp(boxW / widest, byHeight * 0.75, byHeight * 1.15), 16, 90), items);
    y = (box.top + box.bottom) / 2 + ((m.ascent - m.descent) / 2) * size;
  } else {
    size = snap(clamp((boxH / lines.length) * 0.74, 16, 90), items);
    y = box.top + size * 0.95;
  }
  size = Math.min(size, (UNITS - 8) / widest); // never wider than the slide
  const w = widest * size;
  const x = clamp(box.left, 4, Math.max(4, UNITS - 4 - w));
  return { tool: 'text', text, x: round(x), y: round(y), size: round(size), lh: round(size * 1.3), w: round(w), color };
}

// A word written just after an existing line of neat text joins that line.
function lineToContinue(items, box) {
  const cy = (box.top + box.bottom) / 2;
  let best = null;
  let bestGap = Infinity;
  for (const item of items) {
    if (item.tool !== 'text' || item.text.includes('\n')) continue;
    const r = textBox(item);
    const gap = box.left - r.right;
    if (cy < r.top || cy > r.bottom || gap < -0.6 * item.size || gap > 2.2 * item.size) continue;
    if (gap < bestGap) {
      best = item;
      bestGap = gap;
    }
  }
  return best;
}

export function setupTidy(ink, viewer, { toast }) {
  let warned = false;

  async function tidyBlock(n, strokes, settings) {
    const box = bounds(strokes);
    if (looksLikeMark(strokes, box)) return;
    const doc = viewer.doc;
    ink.setBusy(strokes, true);
    let text = null;
    try {
      const slide = await viewer.pageText(n).catch(() => '');
      const ask = 'Transcribe the handwriting in the image.';
      const raw = await generateText({
        apiKey: settings.apiKey,
        model: settings.model,
        fast: settings.fast,
        system: SYSTEM,
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: blockImage(strokes, box) } },
          { text: slide ? `For context only, the slide being annotated says:\n"""\n${slide.slice(0, 1200)}\n"""\n\n${ask}` : ask },
        ],
      });
      text = clean(raw);
      await document.fonts.load(`400 20px ${HAND_FONT}`, text ?? 'a').catch(() => {});
    } catch (e) {
      console.error(e);
      if (!warned) toast(`Handwriting was left as written. ${e.name === 'GeminiError' ? e.message : ''}`.trim());
      warned = true;
    }
    ink.setBusy(strokes, false);

    const items = ink.pages.get(n) ?? [];
    // Skip if the answer is no, or the page or these strokes changed meanwhile.
    if (!text || viewer.doc !== doc || !strokes.every((s) => items.includes(s))) return;
    const rest = items.filter((item) => !strokes.includes(item));
    const line = text.includes('\n') ? null : lineToContinue(rest, box);
    if (line) {
      const joined = /^[,.;:!?)]/.test(text) ? line.text + text : `${line.text} ${text}`;
      const merged = { ...line, text: joined, w: round(measure(joined).w * line.size) };
      ink.replace(n, rest.map((item) => (item === line ? merged : item)));
    } else {
      ink.replace(n, [...rest, layout(text, box, strokes[0].color, rest)]);
    }
  }

  ink.onRest = () => {
    const pending = new Map(); // page number -> strokes
    for (const [stroke, n] of ink.fresh) {
      if (!pending.has(n)) pending.set(n, []);
      pending.get(n).push(stroke);
    }
    ink.fresh.clear();
    if (!ink.tidy || !pending.size) return;
    const settings = store.settings();
    if (!settings.apiKey) {
      if (!warned) toast('Add a Gemini API key in Settings to have handwriting rewritten neatly.');
      warned = true;
      return;
    }
    for (const [n, strokes] of pending) {
      const live = ink.pages.get(n) ?? [];
      for (const block of cluster(strokes.filter((s) => live.includes(s)))) tidyBlock(n, block, settings);
    }
  };

  document.fonts.load(`400 20px ${HAND_FONT}`).catch(() => {});
}
