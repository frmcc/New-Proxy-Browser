// The drawing toolbar: which tool, colour and width the pen uses.

import { PALETTE } from './ink.js';

const KEY = 'pdf-tut.tools';
const SIZE_NAMES = ['Fine', 'Medium', 'Bold'];

export function setupTools(ink, viewer) {
  const bar = document.getElementById('tools');
  const swatches = document.getElementById('swatches');
  const sizes = document.getElementById('sizes');

  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY)) ?? {};
  } catch {}
  if (saved.tool) ink.tool = saved.tool;
  for (const tool of ['pen', 'highlighter']) Object.assign(ink.style[tool], saved.style?.[tool]);
  if (typeof saved.tidy === 'boolean') ink.tidy = saved.tidy;
  viewer.setFingerDraw(Boolean(saved.finger));
  bar.classList.toggle('collapsed', Boolean(saved.collapsed));

  const persist = () =>
    localStorage.setItem(
      KEY,
      JSON.stringify({
        tool: ink.tool,
        style: ink.style,
        finger: viewer.fingerDraw,
        tidy: ink.tidy,
        collapsed: bar.classList.contains('collapsed'),
      }),
    );

  function render() {
    for (const b of bar.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', b.dataset.tool === ink.tool);
    document.getElementById('finger').setAttribute('aria-pressed', viewer.fingerDraw);
    document.getElementById('tidy').setAttribute('aria-pressed', ink.tidy);
    document.getElementById('undo').disabled = !ink.undoStack.length;
    document.getElementById('redo').disabled = !ink.redoStack.length;
    const collapsed = bar.classList.contains('collapsed');
    document
      .getElementById('tools-toggle')
      .setAttribute('aria-label', collapsed ? 'Show the drawing tools' : 'Hide the drawing tools');

    const palette = PALETTE[ink.tool];
    bar.classList.toggle('erasing', !palette);
    if (!palette) return;
    const style = ink.style[ink.tool];
    swatches.replaceChildren(
      ...palette.colors.map(([color, name]) => {
        const b = document.createElement('button');
        b.className = 'swatch';
        b.dataset.color = color;
        b.style.setProperty('--c', color);
        b.setAttribute('aria-label', name);
        b.setAttribute('aria-pressed', color === style.color);
        return b;
      }),
    );
    sizes.replaceChildren(
      ...palette.sizes.map((size, i) => {
        const b = document.createElement('button');
        b.className = 'size';
        b.dataset.size = size;
        b.style.setProperty('--d', `${6 + i * 5}px`);
        b.setAttribute('aria-label', SIZE_NAMES[i]);
        b.setAttribute('aria-pressed', size === style.size);
        return b;
      }),
    );
  }

  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tool) ink.tool = b.dataset.tool;
    else if (b.dataset.color) ink.style[ink.tool].color = b.dataset.color;
    else if (b.dataset.size) ink.style[ink.tool].size = Number(b.dataset.size);
    else if (b.id === 'undo') ink.undo();
    else if (b.id === 'redo') ink.redo();
    else if (b.id === 'finger') viewer.setFingerDraw(!viewer.fingerDraw);
    else if (b.id === 'tidy') ink.tidy = !ink.tidy;
    else if (b.id === 'tools-toggle') bar.classList.toggle('collapsed');
    persist();
    render();
  });

  ink.onHistory = render;
  render();
}
