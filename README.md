# PDF Tut

A lecture-slide reader for iPad. Open a PDF, tap the yellow button, and a study
note for the slide you are on is written next to it by Gemini Flash, together
with a short quiz you answer by hand. Nothing to type. Note and quiz stay
attached to that slide. You can write on the slides with
Apple Pencil: strokes are smoothed as you write, and messy handwriting is
rewritten neatly.

It is a plain web app with no server and no build step. PDFs, notes and the API
key are stored on the device; the only thing that leaves it is the request to
Google's Gemini API.

## Put it on the iPad

1. Host this folder over HTTPS. The simplest way is GitHub Pages: repository
   **Settings → Pages → Deploy from a branch**, pick the branch and `/ (root)`.
   Any static host works (Cloudflare Pages, Netlify, your own server).
2. Open the address in Safari on the iPad, then **Share → Add to Home Screen**.
   Started from the home screen it runs full screen and iPadOS keeps its data.
3. Tap the settings icon and paste a Gemini API key from
   [Google AI Studio](https://aistudio.google.com/apikey).

## Using it

- **Yellow button**: writes a note for the current slide. The slide counter in
  the top bar shows which slide that is.
- **Yellow ribbon** on a slide: that slide has a note. Tap it to read it. The
  ribbon turns green with a tick once the slide's quiz is answered.
- **Pinch** or **double tap** to zoom.
- **Share icon** in the top bar: exports a copy of the PDF with every note
  embedded as a standard PDF sticky note and your handwriting drawn onto the
  slides.
- With a keyboard: `G` or `Enter` writes the note, `←` `→` change slide, `Esc`
  hides the note, `⌘Z` / `⇧⌘Z` undo and redo handwriting.

## The quiz

With each explanation comes a quiz card: one question about the slide and a
box to write the answer in by hand. The card floats over the slides, low and
centred where the hand writes comfortably. Drag it by its top edge to put it
somewhere else (the place is remembered), or fold it away with the arrow to
see the whole slide. How many questions a slide gets (none to four) depends on
how much on it is worth knowing.

About two seconds after you stop writing, Gemini reads the answer and checks
it. A correct answer brings the next card; a wrong one gets a hint, and what
you wrote stays so you can add to it or clear the box. After a wrong try you
can also have the answer shown. When every card is answered correctly the
slide gets its green tick. The lecture list shows how many slides you have
understood.

Answers are checked by the model set under **Model for checking quiz answers**
in Settings (`gemini-flash-lite-latest` by default; the main model is used if
that one is unavailable).

## Writing on slides

The Apple Pencil always writes and fingers scroll and zoom, so there is no
mode to switch. While you write, the hand resting on the screen is ignored: it
cannot scroll, zoom or tap, and the view stays pinned until that hand lifts.
The toolbar at the bottom picks pen, highlighter or eraser, the colour and the
width, and has undo and redo. The hand button is off by default; switched on,
one finger draws as well and two fingers move and zoom. The arrow at the end
folds the toolbar away. On a computer the mouse draws.

Strokes are smoothed with [perfect-freehand](https://github.com/steveruizok/perfect-freehand):
it evens out the jitter of the raw pen input and varies the line width with
pressure. Handwriting is stored per slide as vector strokes, so it stays sharp
at any zoom. The eraser removes whole strokes.

### Neat handwriting

With the **Aa** button on, whatever you write is rewritten neatly about a
second after you stop: Gemini reads the scribble and the app replaces it with
the same words in a clean handwriting font (Kalam), at the same place, size and
colour. A word written right after a neat line joins that line. Underlines,
arrows, drawings and stacked formulas are left as you drew them.

Undo brings your original strokes back and leaves them alone. This needs the
API key and a connection; an image of what you wrote and the text of the slide
are sent to Gemini to read it. Turn **Aa** off to keep your own handwriting.

## Changing what the note says

Settings → **What a note should contain** holds the instructions sent to the
model. The default lives in `src/prompt.js`. The model receives those
instructions, an image of the current slide, its extracted text, and the text
of the rest of the lecture for context.

The model is `gemini-flash-latest` unless changed in Settings.

## Run it locally

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Layout

| Path | What it does |
| --- | --- |
| `src/app.js` | Wires the interface together |
| `src/viewer.js` | Page rendering, zoom, current-slide tracking |
| `src/gemini.js` | Streaming calls to the Gemini API |
| `src/prompt.js` | Default instructions and request assembly |
| `src/store.js` | On-device storage |
| `src/ink.js` | Handwriting: pen input, smoothing, eraser, undo |
| `src/tidy.js` | Reads handwriting with Gemini and rewrites it neatly |
| `src/quiz.js` | Writes the quiz questions and checks handwritten answers |
| `src/pad.js` | The box quiz answers are written in |
| `src/palm.js` | Tells the writing hand from fingers that scroll |
| `src/tools.js` | The drawing toolbar |
| `src/export.js` | Writes notes and handwriting into the PDF |
| `vendor/` | [PDF.js](https://mozilla.github.io/pdf.js/), [pdf-lib](https://pdf-lib.js.org/) [perfect-freehand](https://github.com/steveruizok/perfect-freehand) and the [Kalam](https://fonts.google.com/specimen/Kalam) font |
