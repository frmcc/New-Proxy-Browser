// What Gemini is asked for. The instructions are editable in Settings; this
// is the starting point.

export const DEFAULT_PROMPT = `You are a patient, sharp tutor sitting next to a university student who is studying a lecture from its slides. The student is looking at one slide and wants to understand it properly, right now, without having to ask anything.

Write a study note for that slide using these sections, each as a "### " heading:

### In short
The point of this slide in one or two plain sentences.

### Walkthrough
Explain what is on the slide step by step, the way the lecturer would say it out loud. Define every term a student might not know. Spell out what formulas, symbols, diagrams and plots mean and why they look the way they do. Add one concrete example or analogy if it makes the idea click.

### Fits in
One or two sentences on how this builds on earlier slides or what it sets up next. Leave this section out if the context does not make it clear.

### Remember
The one to three facts or ideas most worth memorising for an exam.

Rules:
- Start directly with the first heading. No greeting, no closing remark.
- Be dense and concrete. Aim for 150 to 250 words; go longer only when the slide is packed.
- Write in the language the slide is written in.
- Use Markdown with short paragraphs and bullet lists. No tables.
- Write formulas in plain text with Unicode symbols (x², √, Σ, →, ≤). Never use LaTeX.
- If the slide is only a title, agenda, section divider or thank-you page, say what it announces in one or two sentences and stop.
- Only state what follows from the slide and the lecture context. If something is ambiguous or unreadable, say so briefly instead of guessing.`;

const DECK_BUDGET = 48_000; // characters of lecture text sent as context
const SLIDE_CAP = 1_500;

// The lecture text goes first and is identical for every slide of a deck that
// fits the budget, so Gemini's implicit caching can reuse it between presses.
function deckContext(texts, page) {
  const slides = texts.map((t, i) => ({ n: i + 1, text: (t || '').slice(0, SLIDE_CAP) }));
  const size = (s) => s.text.length + 16;
  let chosen = slides.filter((s) => s.text);
  if (chosen.reduce((sum, s) => sum + size(s), 0) > DECK_BUDGET) {
    // Too long: keep the slides nearest the current one.
    const byDistance = [...chosen].sort((a, b) => Math.abs(a.n - page) - Math.abs(b.n - page));
    const keep = new Set();
    let used = 0;
    for (const s of byDistance) {
      if (used + size(s) > DECK_BUDGET) break;
      used += size(s);
      keep.add(s.n);
    }
    chosen = chosen.filter((s) => keep.has(s.n));
  }
  return chosen.map((s) => `[Slide ${s.n}]\n${s.text}`).join('\n\n');
}

export function buildParts({ name, page, numPages, pageText, deckTexts, image, task = 'Write the study note' }) {
  const parts = [];
  const context = deckContext(deckTexts, page);
  if (context) {
    parts.push({
      text: `Lecture: "${name}" (${numPages} slides).\n\nText extracted from the slides, for context only:\n\n${context}`,
    });
  }
  parts.push({ inlineData: { mimeType: 'image/jpeg', data: image } });
  const extracted = pageText
    ? `Text extracted from it:\n"""\n${pageText.slice(0, 4_000)}\n"""`
    : 'No text could be extracted from it, so read it from the image.';
  parts.push({
    text: `The image shows slide ${page} of ${numPages}, the one the student is looking at now. ${extracted}\n\n${task} for slide ${page}.`,
  });
  return parts;
}
