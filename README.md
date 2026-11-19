# PDF Tut

A lecture-slide reader for iPad. Open a PDF, tap the yellow button, and a study
note for the slide you are on is written next to it by Gemini Flash. Nothing to
type. The note stays attached to that slide.

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
- **Yellow ribbon** on a slide: that slide has a note. Tap it to read it.
- **Pinch** or **double tap** to zoom.
- **Share icon** in the top bar: exports a copy of the PDF with every note
  embedded as a standard PDF sticky note.
- With a keyboard: `G` or `Enter` writes the note, `←` `→` change slide, `Esc`
  hides the note.

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
| `src/export.js` | Writes notes into the PDF |
| `vendor/` | [PDF.js](https://mozilla.github.io/pdf.js/) and [pdf-lib](https://pdf-lib.js.org/) |
