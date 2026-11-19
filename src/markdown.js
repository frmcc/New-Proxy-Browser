// A small Markdown renderer for the notes. Everything is HTML-escaped before
// any tag is added, so model output can never inject markup.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

function inline(src) {
  const codes = [];
  let s = esc(src).replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = s
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^\s*](?:.*?[^\s*])?)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^\s_](?:.*?[^\s_])?)__/g, '<strong>$1</strong>')
    .replace(/\*([^\s*](?:[^*]*?[^\s*])?)\*/g, '<em>$1</em>')
    .replace(/(^|[\s(])_([^\s_](?:[^_]*?[^\s_])?)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

const LIST_ITEM = /^(\s*)([-*+•]|\d+[.)])\s+(.*)$/;

function renderList(lines) {
  // Items carry their indent; deeper indents open nested lists.
  let html = '';
  const stack = []; // { indent, tag }
  const close = () => (html += `</li></${stack.pop().tag}>`);
  for (const line of lines) {
    const m = line.match(LIST_ITEM);
    if (!m) {
      html += `<br>${inline(line.trim())}`; // continuation of the previous item
      continue;
    }
    const indent = m[1].replace(/\t/g, '  ').length;
    const tag = /\d/.test(m[2]) ? 'ol' : 'ul';
    while (stack.length && indent < stack[stack.length - 1].indent) close();
    const top = stack[stack.length - 1];
    if (!top || indent > top.indent) {
      stack.push({ indent, tag });
      html += `<${tag}><li>`;
    } else if (top.tag !== tag) {
      close();
      stack.push({ indent, tag });
      html += `<${tag}><li>`;
    } else {
      html += '</li><li>';
    }
    html += inline(m[3]);
  }
  while (stack.length) close();
  return html;
}

const cells = (row) =>
  row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function renderMarkdown(md) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  let html = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^\s*```/.test(line)) {
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      html += `<pre><code>${esc(body.join('\n'))}</code></pre>`;
      continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*$/);
    if (heading) {
      html += `<h3><span>${inline(heading[2])}</span></h3>`;
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      html += '<hr>';
      i++;
      continue;
    }
    if (/^\s*\|/.test(line) && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1] ?? '')) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      html += `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>`;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      html += `<blockquote>${renderMarkdown(body.join('\n'))}</blockquote>`;
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const body = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        (LIST_ITEM.test(lines[i]) || /^\s{2,}\S/.test(lines[i]))
      )
        body.push(lines[i++]);
      html += renderList(body);
      continue;
    }
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(```|#{1,6}\s|>)/.test(lines[i]) &&
      !LIST_ITEM.test(lines[i])
    )
      para.push(lines[i++].trim());
    html += `<p>${para.map(inline).join('<br>')}</p>`;
  }
  return html;
}

// For the exported PDF, where a note is plain text.
export function toPlainText(md) {
  return md
    .replace(/\r\n?/g, '\n')
    .replace(/^[ \t]*```.*$/gm, '')
    .replace(/^ {0,3}#{1,6}[ \t]+(.*?)[ \t]*#*$/gm, (_, t) => t.toUpperCase())
    .replace(/^([ \t]*)[-*+][ \t]+/gm, '$1• ')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*([^\s*][^*]*?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
