// Writes the notes into a copy of the PDF as standard sticky-note
// annotations, so they open in Files, Preview, Acrobat and other readers.

import { toPlainText } from './markdown.js';

export async function exportWithNotes(bytes, notes) {
  const { PDFDocument, PDFHexString, PDFString } = await import('../vendor/pdf-lib.esm.min.js');
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = pdf.getPages();
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
