// Writes a copy of the PDF that carries everything added in the app: notes as
// standard sticky-note annotations, handwriting as vector drawing on the page.
// Both open in Files, Preview, Acrobat and other readers.

import { toPlainText } from './markdown.js';
import { strokePath, textBox, HAND_FONT, UNITS } from './ink.js';

// Tidied handwriting is drawn by the browser and placed as an image, so it
// looks exactly as on screen, including symbols the handwriting font lacks.
function textImage(item) {
  const r = textBox(item);
  const pad = item.size * 0.35;
  const left = r.left - pad;
  const top = r.top - pad;
  const w = r.right - r.left + pad * 2;
  const h = r.bottom - r.top + pad * 2;
  const k = Math.min(4, 4096 / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * k);
  canvas.height = Math.ceil(h * k);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(k, 0, 0, k, -left * k, -top * k);
  ctx.font = `400 ${item.size}px ${HAND_FONT}, cursive`;
  ctx.fillStyle = item.color;
  item.text.split('\n').forEach((line, i) => ctx.fillText(line, item.x, item.y + i * item.lh));
  const png = canvas.toDataURL('image/png');
  canvas.width = canvas.height = 0;
  return { png, left, top, w, h };
}

export async function exportAnnotated(bytes, notes, drawn) {
  const { PDFDocument, PDFHexString, PDFString, BlendMode, rgb } = await import('../vendor/pdf-lib.esm.min.js');
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = pdf.getPages();
  const hex = (c) => rgb(...[1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255));

  for (const { page: n, strokes } of drawn) {
    const page = pages[n - 1];
    if (!page) continue;
    const box = page.getCropBox();
    // Highlighter first, so pen strokes stay on top as they do on screen.
    const ordered = [...strokes].sort((a, b) => (b.tool === 'highlighter') - (a.tool === 'highlighter'));
    const scale = box.width / UNITS;
    for (const stroke of ordered) {
      if (stroke.tool === 'text') {
        const { png, left, top, w, h } = textImage(stroke);
        page.drawImage(await pdf.embedPng(png), {
          x: box.x + left * scale,
          y: box.y + box.height - (top + h) * scale,
          width: w * scale,
          height: h * scale,
        });
        continue;
      }
      const path = strokePath(stroke);
      if (!path) continue;
      page.drawSvgPath(path, {
        x: box.x,
        y: box.y + box.height,
        scale,
        color: hex(stroke.color),
        borderWidth: 0,
        ...(stroke.tool === 'highlighter' ? { blendMode: BlendMode.Multiply } : {}),
      });
    }
  }

  const modified = PDFString.fromDate(new Date());
  const size = 22;
  const inset = 10;
  for (const note of notes) {
    const page = pages[note.page - 1];
    if (!page) continue;
    const box = page.getCropBox();
    const x = box.x + box.width - inset - size;
    const y = box.y + box.height - inset - size;
    const annotation = pdf.context.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Name: 'Note',
      Rect: [x, y, x + size, y + size],
      Contents: PDFHexString.fromText(toPlainText(note.text)),
      T: PDFHexString.fromText('PDF Tut'),
      C: [1, 0.88, 0.29],
      F: 28, // print, keep icon size and orientation fixed
      Open: false,
      M: modified,
    });
    page.node.addAnnot(pdf.context.register(annotation));
  }
  return pdf.save();
}
