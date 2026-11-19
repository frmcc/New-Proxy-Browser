// Everything the app remembers lives on the device: PDFs and notes in
// IndexedDB, settings in localStorage.

import { DEFAULT_PROMPT } from './prompt.js';

const DB_NAME = 'pdf-tut';
const SETTINGS_KEY = 'pdf-tut.settings';
const LAST_KEY = 'pdf-tut.last';

let dbPromise;

function db() {
  return (dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = (e) => {
      const d = req.result;
      if (e.oldVersion < 1) {
        d.createObjectStore('docs', { keyPath: 'id' });
        d.createObjectStore('files');
        d.createObjectStore('notes', { keyPath: ['docId', 'page'] }).createIndex('byDoc', 'docId');
      }
      if (e.oldVersion < 2) {
        d.createObjectStore('ink', { keyPath: ['docId', 'page'] }).createIndex('byDoc', 'docId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

async function run(stores, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(stores, mode);
    let result;
    const set = (req) => {
      req.onsuccess = () => (result = req.result);
      return req;
    };
    fn(tx, set);
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export const listDocs = async () =>
  (await run('docs', 'readonly', (tx, set) => set(tx.objectStore('docs').getAll())))
    .sort((a, b) => b.openedAt - a.openedAt);

export const getDoc = (id) =>
  run('docs', 'readonly', (tx, set) => set(tx.objectStore('docs').get(id)));

export const putDoc = (doc) =>
  run('docs', 'readwrite', (tx) => tx.objectStore('docs').put(doc));

export const getFile = (id) =>
  run('files', 'readonly', (tx, set) => set(tx.objectStore('files').get(id)));

export const putFile = (id, buffer) =>
  run('files', 'readwrite', (tx) => tx.objectStore('files').put(buffer, id));

export const notesFor = (docId) =>
  run('notes', 'readonly', (tx, set) => set(tx.objectStore('notes').index('byDoc').getAll(docId)));

export const putNote = (note) =>
  run('notes', 'readwrite', (tx) => tx.objectStore('notes').put(note));

export const deleteNote = (docId, page) =>
  run('notes', 'readwrite', (tx) => tx.objectStore('notes').delete([docId, page]));

// Handwriting: one record per page, { docId, page, strokes }.
export const inkFor = (docId) =>
  run('ink', 'readonly', (tx, set) => set(tx.objectStore('ink').index('byDoc').getAll(docId)));

export const putInk = (docId, page, strokes) =>
  run('ink', 'readwrite', (tx) => {
    if (strokes.length) tx.objectStore('ink').put({ docId, page, strokes });
    else tx.objectStore('ink').delete([docId, page]);
  });

export const deleteDoc = (id) =>
  run(['docs', 'files', 'notes', 'ink'], 'readwrite', (tx) => {
    tx.objectStore('docs').delete(id);
    tx.objectStore('files').delete(id);
    for (const name of ['notes', 'ink']) {
      const cursor = tx.objectStore(name).index('byDoc').openKeyCursor(IDBKeyRange.only(id));
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return;
        tx.objectStore(name).delete(c.primaryKey);
        c.continue();
      };
    }
  });

const DEFAULTS = {
  apiKey: '',
  model: 'gemini-flash-latest',
  gradeModel: 'gemini-flash-lite-latest', // reads and checks quiz answers
  fast: true,
  prompt: null,
};

export function settings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {};
  } catch {}
  const s = { ...DEFAULTS, ...saved };
  return { ...s, prompt: s.prompt || DEFAULT_PROMPT };
}

export function saveSettings({ apiKey, model, gradeModel, fast, prompt }) {
  const custom = prompt.trim() && prompt.trim() !== DEFAULT_PROMPT.trim() ? prompt : null;
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      apiKey: apiKey.trim(),
      model: model.trim() || DEFAULTS.model,
      gradeModel: gradeModel.trim() || DEFAULTS.gradeModel,
      fast,
      prompt: custom,
    }),
  );
}

export const lastDoc = () => localStorage.getItem(LAST_KEY) || null;
export const setLastDoc = (id) =>
  id ? localStorage.setItem(LAST_KEY, id) : localStorage.removeItem(LAST_KEY);
