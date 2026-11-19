import { Viewer } from './viewer.js';
import * as store from './store.js';
import { streamGenerate, listFlashModels } from './gemini.js';
import { renderMarkdown } from './markdown.js';
import { DEFAULT_PROMPT, buildParts } from './prompt.js';
import { Ink } from './ink.js';
import { setupTools } from './tools.js';

const $ = (id) => document.getElementById(id);
const app = $('app');
const pane = $('pane');
const paneBody = $('pane-body');
const fab = $('explain');

const state = {
  doc: null, // { id, name, numPages, ... }
  page: 1,
  notes: new Map(), // page -> saved note
  jobs: new Map(), // page -> { text, ctrl, error } while a note is being written
  paneOpen: false,
};

const viewer = new Viewer($('viewer'), {
  onPageChange(n) {
    state.page = n;
    paneBody.scrollTop = 0;
    render();
    rememberPage();
  },
  onMarkerTap(n) {
    state.paneOpen = true;
    render();
    // The pane takes space from the slides; move once that has settled.
    if (n !== state.page) requestAnimationFrame(() => viewer.goTo(n));
  },
});

const ink = new Ink(viewer, {
  onChange(page, strokes) {
    if (state.doc) store.putInk(state.doc.id, page, strokes);
  },
});
setupTools(ink, viewer);

// ---- rendering ----

function render() {
  const reading = app.dataset.view === 'reader' && state.doc;
  $('doc-title').textContent = reading ? state.doc.name : 'PDF Tut';
  $('page-indicator').textContent = reading ? `${state.page} / ${state.doc.numPages}` : '';
  const job = state.jobs.get(state.page);
  fab.classList.toggle('busy', Boolean(job && !job.error));
  renderPane();
}

function renderPane() {
  const open = state.paneOpen && app.dataset.view === 'reader' && state.doc;
  pane.hidden = !open;
  if (!open) return;

  const page = state.page;
  const job = state.jobs.get(page);
  const note = state.notes.get(page);
  const writing = job && !job.error;
  $('pane-title').textContent = `Slide ${page}`;
  $('note-stop').hidden = !writing;
  $('note-redo').hidden = writing || !note;
  $('note-delete').hidden = writing || !note;

  if (writing) {
    paneBody.innerHTML = job.text
      ? `${renderMarkdown(job.text)}<span class="caret"></span>`
      : '<p class="quiet">Reading the slide<span class="caret"></span></p>';
  } else if (job?.error) {
    const fix = /Settings/.test(job.error) ? ' <button class="btn" data-act="settings">Open Settings</button>' : '';
    paneBody.innerHTML = `<p class="problem"></p><button class="btn primary" data-act="explain">Try again</button>${fix}`;
    paneBody.firstChild.textContent = job.error;
  } else if (note) {
    paneBody.innerHTML = renderMarkdown(note.text);
  } else {
    paneBody.innerHTML =
      '<p class="quiet">No note for this slide yet.</p><button class="btn primary" data-act="explain">Explain this slide</button>';
  }
}

let paneFrame = 0;
function renderPaneSoon() {
  if (paneFrame) return;
  paneFrame = requestAnimationFrame(() => {
    paneFrame = 0;
    renderPane();
  });
}

let toastTimer;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 4200);
}

// ---- notes ----

function explain(page, { again = false } = {}) {
  if (!state.doc) return;
  state.paneOpen = true;
  const job = state.jobs.get(page);
  const writing = job && !job.error;
  if (writing || (state.notes.has(page) && !again)) return render();
  if (!store.settings().apiKey) {
    render();
    return openSettings('Add your Gemini API key to get notes.');
  }
  writeNote(page);
}

async function writeNote(page) {
  const doc = state.doc;
  const settings = store.settings();
  const job = { text: '', ctrl: new AbortController(), error: null };
  state.jobs.set(page, job);
  render();

  const live = () => state.doc?.id === doc.id && state.jobs.get(page) === job;
  const save = async () => {
    if (!job.text.trim()) return;
    const note = { docId: doc.id, page, text: job.text.trim(), model: settings.model, updatedAt: Date.now() };
    await store.putNote(note);
    if (state.doc?.id === doc.id) {
      state.notes.set(page, note);
      viewer.setMarked(page, true);
    }
  };

  try {
    const [image, pageText, deckTexts] = await Promise.all([
      viewer.snapshot(page),
      viewer.pageText(page),
      viewer.deckTexts(400),
    ]);
    const parts = buildParts({ name: doc.name, page, numPages: doc.numPages, pageText, deckTexts, image });
    const stream = streamGenerate({
      apiKey: settings.apiKey,
      model: settings.model,
      system: settings.prompt,
      parts,
      fast: settings.fast,
      signal: job.ctrl.signal,
    });
    for await (const chunk of stream) {
      job.text += chunk;
      if (live() && state.page === page) renderPaneSoon();
    }
    await save();
    if (live()) state.jobs.delete(page);
  } catch (e) {
    if (e.name === 'AbortError') {
      await save(); // keep what was written before Stop
      if (live()) state.jobs.delete(page);
    } else {
      console.error(e);
      job.error = e.name === 'GeminiError' ? e.message : 'Something went wrong while writing the note. Try again.';
    }
  }
  if (state.doc?.id === doc.id) render();
}

async function deleteNote(page) {
  if (!state.doc) return;
  await store.deleteNote(state.doc.id, page);
  state.notes.delete(page);
  viewer.setMarked(page, false);
  render();
}

// ---- documents ----

function setView(view) {
  app.dataset.view = view;
  render();
}

let pageTimer;
function rememberPage() {
  clearTimeout(pageTimer);
  const doc = state.doc;
  pageTimer = setTimeout(() => {
    if (!doc || state.doc !== doc) return;
    doc.lastPage = state.page;
    store.putDoc(doc);
  }, 600);
}

function stopJobs() {
  for (const job of state.jobs.values()) job.ctrl.abort();
  state.jobs.clear();
}

// A document is recognised by its exact bytes, so a re-download of the same
// lecture finds its notes again and an exported copy counts as a new file.
async function documentId(buffer, fallback) {
  if (!globalThis.crypto?.subtle) return fallback; // plain http: use PDF.js's fingerprint
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  return [...digest.subarray(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function openBytes(buffer, name) {
  stopJobs();
  state.doc = null;
  state.notes.clear();
  ink.load([]);
  setView('reader');
  let info;
  try {
    info = await viewer.open(new Uint8Array(buffer.slice(0)));
  } catch (e) {
    console.error(e);
    toast(
      e?.name === 'PasswordException'
        ? 'This PDF is password-protected. Remove the password and open it again.'
        : 'That file could not be opened as a PDF.',
    );
    return showLibrary();
  }
  const id = await documentId(buffer, info.id);
  let doc = await store.getDoc(id);
  if (!doc) {
    doc = { id, name, numPages: info.numPages, lastPage: 1, addedAt: Date.now() };
    await store.putFile(id, buffer);
  }
  doc.openedAt = Date.now();
  await store.putDoc(doc);
  store.setLastDoc(doc.id);

  state.doc = doc;
  state.page = 1;
  for (const note of await store.notesFor(doc.id)) {
    state.notes.set(note.page, note);
    viewer.setMarked(note.page, true);
  }
  ink.load(await store.inkFor(doc.id));
  if (doc.lastPage > 1) viewer.goTo(doc.lastPage, 'auto');
  render();
  navigator.storage?.persist?.();
}

async function openFile(file) {
  if (!file) return;
  await openBytes(await file.arrayBuffer(), file.name.replace(/\.pdf$/i, ''));
}

async function openStored(id) {
  const [doc, buffer] = await Promise.all([store.getDoc(id), store.getFile(id)]);
  if (!doc || !buffer) return showLibrary();
  await openBytes(buffer, doc.name);
}

async function showLibrary() {
  stopJobs();
  state.doc = null;
  state.notes.clear();
  state.paneOpen = false;
  store.setLastDoc(null);
  ink.load([]);
  await viewer.close();
  setView('library');

  const docs = await store.listDocs();
  const counts = await Promise.all(docs.map((d) => store.countNotes(d.id)));
  const list = $('recent');
  list.replaceChildren();
  docs.forEach((doc, i) => {
    const li = document.createElement('li');
    const open = document.createElement('button');
    open.className = 'lecture';
    const title = document.createElement('strong');
    title.textContent = doc.name;
    const meta = document.createElement('span');
    const notes = counts[i] === 1 ? '1 note' : `${counts[i]} notes`;
    meta.textContent = `${doc.numPages} slides, ${counts[i] ? notes : 'no notes yet'}`;
    open.append(title, meta);
    open.addEventListener('click', () => openStored(doc.id));
    const remove = document.createElement('button');
    remove.className = 'icon-btn';
    remove.setAttribute('aria-label', `Remove ${doc.name}`);
    remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    remove.addEventListener('click', async () => {
      if (!confirm(`Remove "${doc.name}" and its notes from this device?`)) return;
      await store.deleteDoc(doc.id);
      showLibrary();
    });
    li.append(open, remove);
    list.append(li);
  });
}

// ---- settings ----

const settingsDialog = $('settings');

function openSettings(notice = '') {
  const s = store.settings();
  $('s-key').value = s.apiKey;
  $('s-model').value = s.model;
  $('s-fast').checked = s.fast;
  $('s-prompt').value = s.prompt;
  $('s-notice').textContent = notice;
  $('s-notice').hidden = !notice;
  settingsDialog.returnValue = '';
  settingsDialog.showModal();
  loadModels();
}

async function loadModels() {
  const key = $('s-key').value.trim();
  if (!key) return;
  try {
    const models = await listFlashModels(key);
    $('s-models').replaceChildren(...models.map((m) => new Option(m, m)));
  } catch {
    // The list is a convenience; a wrong key shows up on the first note.
  }
}

$('s-key').addEventListener('change', loadModels);
$('s-cancel').addEventListener('click', () => settingsDialog.close('cancel'));
$('s-reset').addEventListener('click', () => ($('s-prompt').value = DEFAULT_PROMPT));
settingsDialog.addEventListener('close', () => {
  if (settingsDialog.returnValue !== 'save') return;
  store.saveSettings({
    apiKey: $('s-key').value,
    model: $('s-model').value,
    fast: $('s-fast').checked,
    prompt: $('s-prompt').value,
  });
  toast('Settings saved');
});

// ---- export ----

const exportDialog = $('export');
let exportUrl = null;

async function openExport() {
  if (!state.doc) return;
  const notes = [...state.notes.values()];
  const drawn = [...ink.pages].filter(([, strokes]) => strokes.length).map(([page, strokes]) => ({ page, strokes }));
  if (!notes.length && !drawn.length) return toast('This lecture has no notes or handwriting to export yet.');
  const doc = state.doc;
  const status = $('export-status');
  const share = $('export-share');
  const download = $('export-download');
  share.hidden = download.hidden = true;
  status.textContent = 'Adding your notes and handwriting to the PDF.';
  exportDialog.showModal();
  try {
    const { exportAnnotated } = await import('./export.js');
    const bytes = await exportAnnotated(await store.getFile(doc.id), notes, drawn);
    const file = new File([bytes], `${doc.name} (notes).pdf`, { type: 'application/pdf' });
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    exportUrl = URL.createObjectURL(file);
    download.href = exportUrl;
    download.download = file.name;
    download.hidden = false;
    if (navigator.canShare?.({ files: [file] })) {
      share.hidden = false;
      share.onclick = () => navigator.share({ files: [file] }).catch(() => {});
    }
    status.textContent = [
      notes.length && 'Each note is a sticky note in the top right corner of its slide.',
      drawn.length && 'Your handwriting is drawn onto the slides.',
    ]
      .filter(Boolean)
      .join(' ');
  } catch (e) {
    console.error(e);
    status.textContent = 'This PDF could not be annotated. It may be encrypted or damaged.';
  }
}

$('export-close').addEventListener('click', () => exportDialog.close());

// ---- wiring ----

fab.addEventListener('click', () => explain(state.page));
$('pick').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', (e) => {
  openFile(e.target.files[0]);
  e.target.value = '';
});
$('open-library').addEventListener('click', showLibrary);
$('open-settings').addEventListener('click', () => openSettings());
$('open-export').addEventListener('click', openExport);
$('pane-close').addEventListener('click', () => {
  state.paneOpen = false;
  render();
});
$('note-stop').addEventListener('click', () => state.jobs.get(state.page)?.ctrl.abort());
$('note-redo').addEventListener('click', () => explain(state.page, { again: true }));
$('note-delete').addEventListener('click', () => {
  if (confirm(`Delete the note for slide ${state.page}?`)) deleteNote(state.page);
});
paneBody.addEventListener('click', (e) => {
  if (e.target.closest('[data-act="explain"]')) explain(state.page, { again: true });
  if (e.target.closest('[data-act="settings"]')) openSettings();
});

document.addEventListener('keydown', (e) => {
  if (app.dataset.view !== 'reader' || !state.doc) return;
  if (document.querySelector('dialog[open]') || e.target.closest('input, textarea, select')) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    return e.shiftKey ? ink.redo() : ink.undo();
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Enter' && e.target.closest('button, a')) return; // Enter presses the focused button
  const keys = {
    g: () => explain(state.page),
    Enter: () => explain(state.page),
    ArrowRight: () => viewer.goTo(state.page + 1),
    PageDown: () => viewer.goTo(state.page + 1),
    ArrowLeft: () => viewer.goTo(state.page - 1),
    PageUp: () => viewer.goTo(state.page - 1),
    Escape: () => {
      state.paneOpen = false;
      render();
    },
  };
  if (keys[e.key]) {
    e.preventDefault();
    keys[e.key]();
  }
});

// Dropping a PDF anywhere opens it.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = [...(e.dataTransfer?.files ?? [])].find((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
  if (file) openFile(file);
});

// Safari's page-level pinch would fight the viewer's own zoom.
document.addEventListener('gesturestart', (e) => e.preventDefault());

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

const last = store.lastDoc();
if (last) openStored(last).catch(showLibrary);
else showLibrary();
