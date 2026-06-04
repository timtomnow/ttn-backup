// In-app Help — the ttn-docs vanilla-js adapter.
//
// Guides live in docs/help/: an index.json listing guide slugs, plus one
// Markdown file per slug with `title / category / order / summary` frontmatter.
// Drop new guides there (e.g. via the ttn-docs skill) and they appear
// automatically — no code change needed. See reference/adapters/vanilla-js.md
// in the ttn-docs skill.
//
// This file is the framework-free loader + Markdown renderer (mirrors
// plot-my-notes' help.ts). The page/views live in js/pages/help.js.

// Lowercase, dash-separated slug — used for both category ids and heading anchors.
function helpSlugify(t) {
  return String(t).toLowerCase().trim()
    .replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
}

// Pull ## / ### headings out of a body to build "on this page" / section ToCs.
function helpExtractHeadings(body) {
  const out = [];
  let fence = false;
  for (const line of body.split('\n')) {
    if (/^\s*```/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const m = /^(#{2,3})\s+(.+?)\s*#*$/.exec(line);
    if (!m) continue;
    const text = m[2].trim();
    out.push({ level: m[1].length, text, id: helpSlugify(text) });
  }
  return out;
}

// Lightweight Markdown renderer for guide bodies. Headings get ids (prefixed
// with `idPrefix` so several guides can share one page without colliding), and
// internal /help/<slug> links are tagged so clicks navigate within the page.
function renderGuideMarkdown(md, idPrefix = '') {
  const inline = (t) => esc(t)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, txt, href) => {
      const help = href.match(/^\/help\/(.+)$/);
      if (help) return `<a href="#" data-help="${esc(help[1])}">${txt}</a>`;
      return `<a href="${esc(href)}" target="_blank" rel="noopener">${txt}</a>`;
    });
  const lines = md.split('\n');
  let html = '', list = null;
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m, t;
    if (/^###\s+/.test(line))                   { t = line.slice(4); closeList(); html += `<h3 id="${idPrefix}${helpSlugify(t)}">${inline(t)}</h3>`; }
    else if (/^##\s+/.test(line))               { t = line.slice(3); closeList(); html += `<h2 id="${idPrefix}${helpSlugify(t)}">${inline(t)}</h2>`; }
    else if (/^#\s+/.test(line))                { closeList(); html += `<h1>${inline(line.slice(2))}</h1>`; }
    else if ((m = line.match(/^\d+\.\s+(.*)/)))  { if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = line.match(/^[-*]\s+(.*)/)))   { if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; }
    else if (line.trim() === '')                 { closeList(); }
    else                                         { closeList(); html += `<p>${inline(line)}</p>`; }
  }
  closeList();
  return html;
}

function parseGuide(slug, text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const fm = {};
  let body = text;
  if (m) {
    body = m[2];
    for (const l of m[1].split('\n')) {
      const i = l.indexOf(':');
      if (i > 0) fm[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  return {
    slug,
    title: fm.title || slug,
    category: fm.category || 'Help',
    order: parseInt(fm.order, 10) || 999,
    summary: fm.summary || '',
    body,
    headings: helpExtractHeadings(body),
  };
}

// Group the (already-sorted) guides into sections, preserving order.
function getGuidesByCategory(guides) {
  const groups = new Map();
  for (const g of guides) {
    if (!groups.has(g.category)) groups.set(g.category, []);
    groups.get(g.category).push(g);
  }
  return [...groups.entries()].map(([category, gs]) => ({ category, slug: helpSlugify(category), guides: gs }));
}

let _guides = null;   // cached after first load: array of parsed guides, or [] if none
async function loadGuides() {
  if (_guides) return _guides;
  try {
    const r = await fetch('./docs/help/index.json');
    if (!r.ok) throw new Error('no index');
    const slugs = await r.json();
    const guides = await Promise.all(slugs.map(async (slug) => {
      try {
        const gr = await fetch(`./docs/help/${slug}.md`);
        if (!gr.ok) return null;
        return parseGuide(slug, await gr.text());
      } catch { return null; }
    }));
    // Known categories lead in this order; anything else falls back to alphabetical.
    const CAT_RANK = ['Getting started', 'Backing up', 'Schedules & reminders', 'Restoring', 'Settings & data'];
    const rank = (c) => { const i = CAT_RANK.indexOf(c); return i === -1 ? CAT_RANK.length : i; };
    _guides = guides.filter(Boolean).sort((a, b) =>
      rank(a.category) - rank(b.category) ||
      a.category.localeCompare(b.category) ||
      a.order - b.order);
  } catch {
    _guides = [];
  }
  return _guides;
}
