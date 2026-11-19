// Pen and palm, for the whole app. Fingers move things and the pen writes.
// The hand holding the pen also rests on the glass, so while the pen is in
// use every other touch is treated as that hand: it cannot scroll, zoom or
// tap, and it stays ignored until it lifts. Scrollable areas are pinned for
// that time (the "pen-writing" class on <html>).

const GRACE = 600; // ms after a stroke during which a new touch is still the writing hand
const SESSION = 5000; // ms after a stroke during which a finger may not draw

const fingers = new Set(); // ids of finger touches that are down
const palms = new Set(); // those that belong to the writing hand
const watchers = new Set();
let writing = false;
let until = 0;
let last = -Infinity;
let timer = 0;

const isFinger = (t) => t.touchType !== 'stylus';
const busy = () => writing || performance.now() < until;

function sync() {
  clearTimeout(timer);
  // Pinning matters only where a touch can scroll.
  const pinned = (busy() || palms.size > 0) && navigator.maxTouchPoints > 0;
  document.documentElement.classList.toggle('pen-writing', pinned);
  if (!writing && busy()) timer = setTimeout(sync, until - performance.now() + 20);
}

// Forget touches that are gone, in case an end event never arrived.
function prune(e) {
  const down = new Set([...e.touches].map((t) => t.identifier));
  for (const set of [fingers, palms]) for (const id of set) if (!down.has(id)) set.delete(id);
}

if (typeof document !== 'undefined') {
  document.addEventListener(
    'touchstart',
    (e) => {
      prune(e);
      let palm = false;
      for (const t of e.changedTouches) {
        if (!isFinger(t)) continue;
        fingers.add(t.identifier);
        if (busy()) {
          palms.add(t.identifier); // it landed while the pen is in use
          palm = true;
        }
      }
      if (palm) {
        if (e.cancelable) e.preventDefault();
        sync();
      }
    },
    { capture: true, passive: false },
  );

  document.addEventListener(
    'touchmove',
    (e) => {
      // The writing hand shifts as it writes; that must not move anything.
      if ((palms.size || writing) && e.cancelable) e.preventDefault();
    },
    { capture: true, passive: false },
  );

  const lifted = (e) => {
    for (const t of e.changedTouches) {
      fingers.delete(t.identifier);
      palms.delete(t.identifier);
    }
    prune(e);
    sync();
  };
  document.addEventListener('touchend', lifted, { capture: true });
  document.addEventListener('touchcancel', lifted, { capture: true });
}

export const palm = {
  penDown() {
    writing = true;
    last = performance.now();
    for (const id of fingers) palms.add(id); // already resting: the writing hand
    for (const fn of watchers) fn();
    sync();
  },
  penUp() {
    writing = false;
    last = performance.now();
    until = last + GRACE; // the hand hops along between strokes
    sync();
  },
  // The pen is down, or was a moment ago.
  busy,
  // The pen has been used in the last few seconds.
  recent: () => writing || performance.now() - last < SESSION,
  // Is this touch the writing hand?
  has: (id) => palms.has(id),
  // Is the writing hand on the glass?
  resting: () => palms.size > 0,
  // Run fn whenever the pen comes down.
  onPenDown: (fn) => watchers.add(fn),
};
