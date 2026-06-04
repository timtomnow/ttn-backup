// Help page — the four ttn-docs views (index / process / section / full docs)
// rendered into a single `help` page. The page is reached from Settings
// (navigate('help')) and the bottom-nav active state stays on Settings.
//
// renderHelp() returns synchronous markup (a #help-root shell) so it slots into
// the navigate() flow; the actual guide content loads async and is painted into
// #help-root by goHelp().

// Current view within the help page: { type: 'index'|'all'|'section'|'process', slug }
let helpView = { type: 'index', slug: null };

function renderHelp() {
  helpView = { type: 'index', slug: null };
  // Paint the loaded view once navigate() has injected this markup into #main.
  setTimeout(goHelpRender, 0);
  return `
    <div class="page-header">
      <div><h1>Help &amp; guides</h1><p>How to back up, schedule, and restore your apps.</p></div>
    </div>
    <div id="help-root"><div class="card"><p class="muted">Loading…</p></div></div>
  `;
}

// Switch the active help view and repaint.
function goHelp(type, slug) {
  helpView = { type, slug: slug || null };
  goHelpRender();
}

async function goHelpRender() {
  const root = document.getElementById('help-root');
  if (!root) return;
  const guides = await loadGuides();
  const sections = getGuidesByCategory(guides);

  if (!guides.length) {
    root.innerHTML = `<div class="card"><p class="muted">No help guides have been published yet. Check back soon.</p></div>`;
    return;
  }

  if (helpView.type === 'process') root.innerHTML = helpProcessHtml(guides);
  else if (helpView.type === 'section') root.innerHTML = helpSectionHtml(sections);
  else if (helpView.type === 'all') root.innerHTML = helpAllHtml(sections);
  else root.innerHTML = helpIndexHtml(sections);

  root.scrollTop = 0;
  window.scrollTo(0, 0);
}

// ── shared fragments ────────────────────────────────────────────────────────
function helpBreadcrumbs(items) {
  return `<nav class="bc">` + items.map((it, i) => {
    const sep = i > 0 ? '<span class="bc-sep">›</span>' : '';
    return it.current
      ? `${sep}<span class="bc-cur">${esc(it.label)}</span>`
      : `${sep}<a href="#" ${it.attr}>${esc(it.label)}</a>`;
  }).join('') + `</nav>`;
}

function helpStepsHtml(guide, idPrefix) {
  if (!guide.headings.length) return '';
  return `<ul class="toc-steps">` + guide.headings.map((h) =>
    `<li style="padding-left:${(h.level - 2) * 12}px"><a href="#${idPrefix}${h.id}">${esc(h.text)}</a></li>`
  ).join('') + `</ul>`;
}

const helpTocBox = (title, inner) => `<div class="toc-box"><div class="toc-title">${esc(title)}</div>${inner}</div>`;

function helpArticleHtml(g, tag) {
  return `<${tag} id="${g.slug}" class="guide-sec">
    <div class="guide-sec-title">${esc(g.title)}</div>
    ${g.summary ? `<div class="guide-sec-sum">${esc(g.summary)}</div>` : ''}
    <div class="guide-body">${renderGuideMarkdown(g.body, g.slug + '--')}</div>
  </${tag}>`;
}

// ── 1. Index ────────────────────────────────────────────────────────────────
function helpIndexHtml(sections) {
  const body = sections.map((s) => `
    <a class="help-cat-link" href="#" data-section="${s.slug}">${esc(s.category)} <span>›</span></a>
    ${s.guides.map((g) => `<a class="help-item" href="#" data-help="${esc(g.slug)}">
      <div class="help-item-title">${esc(g.title)}</div>
      ${g.summary ? `<div class="help-item-sum">${esc(g.summary)}</div>` : ''}
    </a>`).join('')}`).join('');
  return `<div class="card">
    <div class="help-card-head">
      <h3 style="margin:0">Guides</h3>
      <a class="help-viewall" href="#" data-all>View all docs →</a>
    </div>${body}</div>`;
}

// ── 2. Process — one guide, with an "On this page" ToC ───────────────────────
function helpProcessHtml(guides) {
  const g = guides.find((x) => x.slug === helpView.slug);
  if (!g) { helpView = { type: 'index', slug: null }; return helpIndexHtml(getGuidesByCategory(guides)); }
  const crumbs = helpBreadcrumbs([
    { label: 'Help', attr: 'data-home' },
    { label: g.category, attr: `data-section="${helpSlugify(g.category)}"` },
    { label: g.title, current: true },
  ]);
  const toc = g.headings.length ? helpTocBox('On this page', helpStepsHtml(g, '')) : '';
  return `${crumbs}<div class="card">${toc}<div class="guide-body">${renderGuideMarkdown(g.body)}</div></div>`;
}

// ── 3. Section — every process in one category ───────────────────────────────
function helpSectionHtml(sections) {
  const section = sections.find((s) => s.slug === helpView.slug);
  if (!section) { helpView = { type: 'index', slug: null }; return helpIndexHtml(sections); }
  const crumbs = helpBreadcrumbs([
    { label: 'Help', attr: 'data-home' },
    { label: section.category, current: true },
  ]);
  const toc = helpTocBox('In this section', `<ul>` + section.guides.map((g) =>
    `<li><a class="toc-guide" href="#${g.slug}">${esc(g.title)}</a>${helpStepsHtml(g, g.slug + '--')}</li>`
  ).join('') + `</ul>`);
  const articles = section.guides.map((g) => helpArticleHtml(g, 'section')).join('');
  return `${crumbs}<div class="card">${toc}${articles}</div>`;
}

// ── 4. Full docs — the entire manual on one page ─────────────────────────────
function helpAllHtml(sections) {
  const crumbs = helpBreadcrumbs([
    { label: 'Help', attr: 'data-home' },
    { label: 'Full docs', current: true },
  ]);
  const contents = helpTocBox('Contents', `<ul>` + sections.map((s) =>
    `<li><a class="toc-sec" href="#section-${s.slug}">${esc(s.category)}</a>
      <ul class="toc-sub">` + s.guides.map((g) =>
        `<li><a class="toc-guide" href="#${g.slug}">${esc(g.title)}</a>${helpStepsHtml(g, g.slug + '--')}</li>`
      ).join('') + `</ul></li>`
  ).join('') + `</ul>`);
  const body = sections.map((s) => `
    <section id="section-${s.slug}" class="docs-sec">
      <div class="docs-sec-title">${esc(s.category)}</div>
      ${s.guides.map((g) => helpArticleHtml(g, 'article')).join('')}
    </section>`).join('');
  return `${crumbs}<div class="card">${contents}${body}</div>`;
}

// Delegate clicks inside the help page: switch views or scroll to an in-page
// anchor. Registered once; ignores clicks outside #help-root.
document.addEventListener('click', (e) => {
  const root = document.getElementById('help-root');
  if (!root) return;
  const a = e.target.closest('a');
  if (!a || !root.contains(a)) return;
  if (a.hasAttribute('data-home'))    { e.preventDefault(); return goHelp('index'); }
  if (a.hasAttribute('data-all'))     { e.preventDefault(); return goHelp('all'); }
  if (a.hasAttribute('data-section')) { e.preventDefault(); return goHelp('section', a.getAttribute('data-section')); }
  if (a.hasAttribute('data-help'))    { e.preventDefault(); return goHelp('process', a.getAttribute('data-help')); }
  const href = a.getAttribute('href') || '';
  if (href.length > 1 && href.startsWith('#')) {
    const el = document.getElementById(decodeURIComponent(href.slice(1)));
    if (el) { e.preventDefault(); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }
});
