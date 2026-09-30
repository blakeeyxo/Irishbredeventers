/* IrishBredEventingResults (IBER) public site. */
(function () {
  const { esc, api, ordinal, niceDate, turnstileReady, mountTurnstile, turnstileToken, resetTurnstile } = window.IBE;
  const $ = id => document.getElementById(id);
  const SITE = 'IrishBredEventingResults';
  const HOME_ROWS = window.matchMedia('(max-width: 720px)').matches ? 8 : 20;

  const state = {
    config: { currentYear: new Date().getFullYear(), turnstileSiteKey: '' },
    ads: { large: [], small: [] },
    adOffset: Math.floor(Math.random() * 1000),
    season: null,
    seasonRows: [],
    searchField: 'all',
    news: null,
    loaded: {}
  };

  /* ---------- Routing ---------- */
  const VIEWS = ['home', 'results', 'search', 'horse', 'news', 'about'];
  // The design preview (a single static page) keeps the route in memory; the live site uses real paths.
  const MEMORY = window.IBE_MEMORY_ROUTES === true;
  let memoryUrl = '/';

  function currentUrl() {
    return new URL(MEMORY ? memoryUrl : location.pathname + location.search + location.hash, 'http://x');
  }
  function routeFromUrl() {
    const url = currentUrl();
    const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    const view = VIEWS.includes(parts[0]) ? parts[0] : 'home';
    return { view, id: parts[1], params: url.searchParams, hash: url.hash };
  }
  function setUrl(href, replace) {
    if (MEMORY) { memoryUrl = href; return; }
    if (replace) history.replaceState(null, '', href); else history.pushState(null, '', href);
  }
  function navigate(href, replace) { setUrl(href, replace); render(); }

  function showView(view) {
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    const tab = view === 'horse' || view === 'search' ? null : view;
    document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
    const names = { home: SITE + ' (IBER)', results: 'Results', search: 'Search', news: 'News', about: 'About' };
    if (view !== 'horse') document.title = view === 'home' ? names.home : `${names[view]} · ${SITE}`;
  }

  let lastPath = null;
  function render() {
    const r = routeFromUrl();
    showView(r.view);
    const path = r.view + '/' + (r.id || '');
    if (path !== lastPath && !r.hash) window.scrollTo({ top: 0 });
    lastPath = path;
    if (r.view === 'home') renderHome();
    if (r.view === 'results') renderResults(r.params);
    if (r.view === 'search') {
      const q = r.params.get('q') || '';
      const input = $('global-search');
      if (document.activeElement !== input) input.value = q;
      state.searchField = r.params.get('field') || 'all';
      document.querySelectorAll('#search-fields .chip').forEach(b => b.classList.toggle('active', b.dataset.field === state.searchField));
      renderSearch(q);
    }
    if (r.view === 'horse') renderHorse(Number(r.id));
    if (r.view === 'news') renderNews().then(() => { if (r.id) openArticle(Number(r.id)); });
    if (r.view === 'about') checkRateCard();
    if (r.hash) setTimeout(() => { const el = document.querySelector(r.hash); if (el) el.scrollIntoView({ behavior: 'smooth' }); }, 60);
  }

  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-link]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target) return;
    e.preventDefault();
    navigate(a.getAttribute('href'));
  });
  if (!MEMORY) window.addEventListener('popstate', render);

  /* ---------- Levels and weeks (for filters) ---------- */
  const LEVEL_ORDER = ['CCI5*', 'CCI4*', 'CCI3*', 'CCI2*', 'CCI1*', 'Advanced', 'Intermediate', 'Pre-Novice', 'Novice', 'Beginner Novice',
    'BE105', 'BE100', 'BE90', 'BE80', 'Preliminary', 'Modified', 'Training', 'Other'];
  function levelOf(cls) {
    const c = cls || '';
    const star = c.match(/\b(?:CCIO?|CIC|CCN)?\s*-?\s*([1-5])\s*\*/i);
    if (star) return `CCI${star[1]}*`;
    if (/advanced/i.test(c)) return 'Advanced';
    if (/intermediate/i.test(c)) return 'Intermediate';
    if (/pre[- ]?novice/i.test(c)) return 'Pre-Novice';
    if (/beginner novice/i.test(c)) return 'Beginner Novice';
    if (/novice/i.test(c)) return 'Novice';
    const be = c.match(/\bBE\s*(\d{2,3})/i);
    if (be) return `BE${be[1]}`;
    if (/preliminary/i.test(c)) return 'Preliminary';
    if (/modified/i.test(c)) return 'Modified';
    if (/training/i.test(c)) return 'Training';
    return 'Other';
  }
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function weekOf(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // back to Monday
    return d.toISOString().slice(0, 10);
  }
  function weekLabel(monday) {
    const a = new Date(monday + 'T00:00:00Z'), b = new Date(a); b.setUTCDate(b.getUTCDate() + 6);
    const left = a.getUTCMonth() === b.getUTCMonth() ? a.getUTCDate() : `${a.getUTCDate()} ${MON[a.getUTCMonth()]}`;
    return `${left} – ${b.getUTCDate()} ${MON[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
  }

  /* ---------- Results tables ---------- */
  const horseHref = h => `/horse/${h.id}`;
  function horseCell(h) {
    const facts = [h.breed, h.foaled, h.sex].filter(Boolean).join(' · ');
    const former = h.former_name ? `was ${esc(h.former_name)}` : '';
    const sub = [facts && esc(facts), former].filter(Boolean).join(' · ');
    return `<a class="horse-link" href="${horseHref(h)}" data-link>${esc(h.horse_name)}</a>${h.verified ? '' : '<span class="unv-tag">Unverified</span>'}${sub ? `<span class="sub">${sub}</span>` : ''}`;
  }
  function breedingCell(h) {
    return `${esc(h.sire || 'Sire not recorded')}<span class="x">×</span>${esc(h.dam || 'dam not recorded')}${h.dam_sire ? `<span class="sub">dam by ${esc(h.dam_sire)}</span>` : ''}`;
  }
  function scoreCell(h) {
    if (h.score === null || h.score === undefined) return '<span class="sub">–</span>';
    const parts = h.dressage !== '' && h.dressage !== null ? `<small>${esc(h.dressage)} · ${esc(h.show_jumping)} · ${esc(h.cross_country)}</small>` : '';
    return `<b>${esc(h.score)}</b>${parts}`;
  }
  function rowHTML(h, withEvent) {
    const ev = withEvent ? `<td data-label="Event">${esc(h.event_name)}<span class="sub">${esc(h.class_name)}</span></td>` : '';
    return `<tr class="row">
      <td class="c-pl">${esc(ordinal(h.position))}</td>
      <td class="c-horse">${horseCell(h)}</td>
      <td data-label="Sire × Dam">${breedingCell(h)}</td>
      <td data-label="Breeder">${esc(h.breeder || '–')}</td>
      ${ev}
      <td class="c-score">${scoreCell(h)}</td></tr>`;
  }
  const HEAD_FLAT = '<thead><tr><th>Pl</th><th>Horse</th><th>Sire × Dam</th><th>Breeder</th><th>Event</th><th class="c-score">Score</th></tr></thead>';
  const HEAD_GROUPED = '<thead><tr><th>Pl</th><th>Horse</th><th>Sire × Dam</th><th>Breeder</th><th class="c-score">Score</th></tr></thead>';

  function flatTable(rows, limit) {
    const shown = limit ? rows.slice(0, limit) : rows;
    const more = limit && rows.length > limit
      ? `<tr class="more-row"><td colspan="6"><button class="btn-quiet" type="button" data-more>Show all ${rows.length} placings</button></td></tr>` : '';
    return `<div class="rtable-wrap"><table class="rtable">${HEAD_FLAT}<tbody>${shown.map(h => rowHTML(h, true)).join('')}${more}</tbody></table></div>`;
  }

  function groupedBody(list) {
    let html = '';
    const byCountry = new Map();
    for (const h of list) {
      if (!byCountry.has(h.country)) byCountry.set(h.country, []);
      byCountry.get(h.country).push(h);
    }
    for (const [country, rows] of byCountry) {
      html += `<tr class="grp-country"><td colspan="5">${esc(country)}</td></tr>`;
      let eventId = null, cls = null;
      for (const h of rows) {
        if (h.event_id !== eventId) {
          html += `<tr class="grp-event"><td colspan="5"><b>${esc(h.event_name)}</b><span>${esc(h.date_text)}</span></td></tr>`;
          eventId = h.event_id; cls = null;
        }
        if (h.class_name !== cls) { html += `<tr class="grp-class"><td colspan="5">${esc(h.class_name)}</td></tr>`; cls = h.class_name; }
        html += rowHTML(h, false);
      }
    }
    return html;
  }
  function groupedTable(rows) {
    const verified = rows.filter(h => h.verified), unverified = rows.filter(h => !h.verified);
    let body = groupedBody(verified);
    if (unverified.length) {
      body += `<tr class="grp-unv"><td colspan="5">Unverified results<small>Still being checked. These move up into their class once confirmed.</small></td></tr>` + groupedBody(unverified);
    }
    return `<div class="rtable-wrap"><table class="rtable">${HEAD_GROUPED}<tbody>${body}</tbody></table></div>`;
  }

  /* ---------- Home ---------- */
  async function renderHome() {
    if (state.loaded.home) return;
    state.loaded.home = true;
    try {
      const d = await api('/api/home');
      if (d.headline) {
        $('hero-headline').textContent = d.headline.title;
        $('hero-copy').textContent = d.headline.snippet;
        $('hero-link').setAttribute('href', `/news/${d.headline.id}`);
      }
      const rows = d.week || [];
      if (!rows.length) { $('week-table').innerHTML = '<div class="empty-state">This week\'s results will appear here once they are published.</div>'; return; }
      const dates = rows.map(r => r.start_date).filter(Boolean).sort();
      const events = new Set(rows.map(r => r.event_id)).size;
      const range = dates.length ? weekLabel(weekOf(dates[0])) : '';
      $('week-meta').innerHTML = `${range ? `<b>${esc(range)}</b> · ` : ''}${events} event${events === 1 ? '' : 's'} · ${rows.length} Irish-bred placings`;
      $('week-table').innerHTML = flatTable(rows, HOME_ROWS);
      const more = $('week-table').querySelector('[data-more]');
      if (more) more.addEventListener('click', () => { $('week-table').innerHTML = flatTable(rows); });
    } catch (e) {
      state.loaded.home = false;
      $('week-table').innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
    }
  }

  /* ---------- Results ---------- */
  const filterVals = () => ({ week: $('f-week').value, event: $('f-event').value, level: $('f-level').value });

  function fillSelect(sel, items, value, allLabel) {
    sel.innerHTML = `<option value="">${allLabel}</option>` + items.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
    sel.value = items.some(([v]) => v === value) ? value : '';
  }

  function applyFilters(push) {
    const rows = state.seasonRows;
    const f = filterVals();
    // Week and level narrow the event list, so the dropdowns never offer an empty combination.
    const weeks = [...new Set(rows.map(r => weekOf(r.start_date)).filter(Boolean))].sort().reverse();
    fillSelect($('f-week'), weeks.map(w => [w, weekLabel(w)]), f.week, 'All weeks');
    const inWeek = rows.filter(r => !$('f-week').value || weekOf(r.start_date) === $('f-week').value);
    const levels = LEVEL_ORDER.filter(l => inWeek.some(r => levelOf(r.class_name) === l));
    fillSelect($('f-level'), levels.map(l => [l, l]), f.level, 'All levels');
    const inLevel = inWeek.filter(r => !$('f-level').value || levelOf(r.class_name) === $('f-level').value);
    const events = [...new Map(inLevel.map(r => [String(r.event_id), `${r.event_name} (${r.country})`])).entries()];
    fillSelect($('f-event'), events, f.event, 'All events');
    const shown = inLevel.filter(r => !$('f-event').value || String(r.event_id) === $('f-event').value);

    const active = filterVals();
    $('f-count').textContent = `${shown.length} placing${shown.length === 1 ? '' : 's'}${active.week || active.event || active.level ? ' match these filters' : ''}`;
    $('results-list').innerHTML = shown.length ? groupedTable(shown)
      : `<div class="empty-state">No results ${rows.length ? 'match these filters' : `for ${state.season} yet.${state.season < state.config.currentYear ? ' Earlier seasons are being added from the archive.' : ''}`}</div>`;

    if (push) {
      const p = new URLSearchParams();
      if (state.season !== state.config.currentYear) p.set('season', state.season);
      for (const k of ['week', 'event', 'level']) if (active[k]) p.set(k, active[k]);
      setUrl('/results' + (p.toString() ? '?' + p : ''), true);
    }
  }

  async function renderResults(params) {
    const current = state.config.currentYear;
    const season = Number(params.get('season')) || current;
    $('results-title').textContent = season === current ? `All of ${season}` : `${season} season`;
    if (state.season !== season || !state.loaded.results) {
      state.season = season;
      state.loaded.results = true;
      $('results-list').innerHTML = '<div class="empty-state">Loading…</div>';
      try {
        const d = await api(`/api/results?season=${season}`);
        state.seasonRows = d.rows;
        $('season-toggle').innerHTML = d.seasons.map(y =>
          `<button class="chip ${y === season ? 'active' : ''}" data-year="${y}">${y === current ? `All of ${y}` : y}</button>`).join('');
      } catch (e) {
        state.loaded.results = false;
        $('results-list').innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
        return;
      }
    }
    // Selects are rebuilt in applyFilters; seed them with the URL values first.
    for (const k of ['week', 'event', 'level']) {
      const sel = $('f-' + k), v = params.get(k) || '';
      if (v && ![...sel.options].some(o => o.value === v)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(v)}">${esc(v)}</option>`);
      sel.value = v;
    }
    applyFilters(false);
  }

  ['f-week', 'f-level', 'f-event'].forEach(id => $(id).addEventListener('change', () => applyFilters(true)));
  $('f-clear').addEventListener('click', () => { ['f-week', 'f-event', 'f-level'].forEach(id => { $(id).value = ''; }); applyFilters(true); });
  $('season-toggle').addEventListener('click', e => {
    const b = e.target.closest('button[data-year]');
    if (!b) return;
    const y = Number(b.dataset.year);
    navigate(y === state.config.currentYear ? '/results' : `/results?season=${y}`);
  });
  $('legend-toggle').addEventListener('click', e => {
    const open = $('legend').classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', open);
  });

  /* ---------- Search ---------- */
  let searchTimer, searchSeq = 0;
  async function renderSearch(q) {
    q = q.trim();
    const countEl = $('search-count'), out = $('search-results');
    if (!q) { countEl.textContent = ''; out.innerHTML = '<div class="empty-state">Type a horse, sire, dam or breeder in the search box above.</div>'; return; }
    const seq = ++searchSeq;
    try {
      const d = await api(`/api/search?q=${encodeURIComponent(q)}&field=${state.searchField}`);
      if (seq !== searchSeq) return;
      const shown = d.rows.length < d.total ? ` (showing the first ${d.rows.length})` : '';
      countEl.textContent = `${d.total} match${d.total === 1 ? '' : 'es'} for "${q}"${shown}`;
      out.innerHTML = d.rows.length ? flatTable(d.rows) : '<div class="empty-state">No matches. Try part of a name, or a different field.</div>';
    } catch (e) {
      if (seq === searchSeq) out.innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
    }
  }
  function searchHref(q) {
    const p = new URLSearchParams({ q });
    if (state.searchField !== 'all') p.set('field', state.searchField);
    return `/search?${p}`;
  }
  $('global-search').addEventListener('input', e => {
    clearTimeout(searchTimer);
    const q = e.target.value;
    const onSearch = routeFromUrl().view === 'search';
    searchTimer = setTimeout(() => navigate(searchHref(q), onSearch), onSearch ? 200 : 0);
  });
  $('search-form').addEventListener('submit', e => { e.preventDefault(); navigate(searchHref($('global-search').value), routeFromUrl().view === 'search'); });
  $('search-fields').addEventListener('click', e => {
    const b = e.target.closest('button[data-field]');
    if (!b) return;
    state.searchField = b.dataset.field;
    navigate(searchHref($('global-search').value), true);
  });

  /* ---------- Horse page ---------- */
  const ped = (cls, role, name) => name
    ? `<div class="ped ${cls}"><span>${role}</span><b>${esc(name)}</b></div>`
    : `<div class="ped ${cls} missing"><span>${role}</span><b>Not in the results</b></div>`;

  async function renderHorse(id) {
    const el = $('horse-page');
    el.innerHTML = '<div class="empty-state">Loading…</div>';
    let d;
    try { d = await api(`/api/horse/${id}`); } catch (e) { el.innerHTML = `<div class="empty-state">${esc(e.message)}</div>`; return; }
    const h = d.horse, runs = d.runs;
    document.title = `${h.horse_name} · ${SITE}`;
    const formers = [...new Set(runs.map(r => r.former_name).filter(Boolean))];
    const positions = runs.map(r => r.position).filter(n => n);
    const dressage = runs.map(r => parseFloat(r.dressage)).filter(n => !isNaN(n));
    const xcKnown = runs.filter(r => r.cross_country !== '' && r.cross_country !== null);
    const xcClear = xcKnown.filter(r => parseFloat(r.cross_country) === 0).length;
    const fact = (label, v) => `<div><span>${label}</span><b>${esc(v || '–')}</b></div>`;
    el.innerHTML = `
      <a class="back-link" href="/results" data-link>← Back to results</a>
      <p class="eyebrow">Horse</p>
      <h2 class="page-title">${esc(h.horse_name)}</h2>
      ${formers.length ? `<p class="horse-former">Formerly competed as ${esc(formers.join(', '))}</p>` : ''}
      <div class="facts">${fact('Breed', h.breed)}${fact('Foaled', h.foaled)}${fact('Sex', h.sex)}${fact('Breeder', h.breeder)}</div>
      <div class="horse-grid">
        <div>
          <h3 class="section-title">Pedigree</h3>
          <div class="pedigree">
            ${ped('sire', 'Sire', h.sire)}${ped('dam', 'Dam', h.dam)}
            ${ped('ss', "Sire's sire", '')}${ped('sd', "Sire's dam", '')}
            ${ped('ds', 'Dam sire', h.dam_sire)}${ped('dd', "Dam's dam", '')}
          </div>
          <p class="note">The weekly results carry sire, dam and dam sire.</p>
        </div>
        <div>
          <h3 class="section-title">Record</h3>
          <div class="stats">
            <div><span>Runs recorded</span><b>${runs.length}</b></div>
            <div><span>Best finish</span><b>${positions.length ? esc(ordinal(Math.min(...positions))) : '–'}</b></div>
            <div><span>Wins</span><b>${positions.filter(p => p === 1).length}</b></div>
            <div><span>Best dressage</span><b>${dressage.length ? Math.min(...dressage) : '–'}</b></div>
            <div><span>Clear cross country</span><b>${xcKnown.length ? `${xcClear} of ${xcKnown.length}` : '–'}</b></div>
          </div>
        </div>
      </div>
      <h3 class="section-title">Form</h3>
      <div class="rtable-wrap"><table class="rtable">
        <thead><tr><th>Pl</th><th>Date</th><th>Event</th><th>Class</th><th class="c-score">Score</th></tr></thead>
        <tbody>${runs.map(r => `<tr class="row">
          <td class="c-pl">${esc(ordinal(r.position))}</td>
          <td data-label="Date">${esc(r.date_text || niceDate(r.start_date))}</td>
          <td class="c-horse">${esc(r.event_name)}<span class="sub">${esc(r.country)}</span></td>
          <td data-label="Class">${esc(r.class_name)}${r.verified ? '' : '<span class="unv-tag">Unverified</span>'}</td>
          <td class="c-score">${scoreCell(r)}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="note">Every recorded run for ${esc(h.horse_name)}, newest first.</p>`;
  }

  /* ---------- News ---------- */
  // The design preview supplies its own image lookup; the live site serves images from R2 at /media/.
  const imgUrl = key => (window.IBE_MEDIA_URL ? window.IBE_MEDIA_URL(key) : `/media/${key}`);
  const paragraphs = t => String(t).split(/\n\s*\n/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');

  async function renderNews() {
    if (!state.loaded.newsComments) { state.loaded.newsComments = true; renderComments($('news-comments')); }
    if (state.news) return;
    try {
      state.news = (await api('/api/news')).news;
    } catch (e) {
      $('news-list').innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
      return;
    }
    $('news-list').innerHTML = state.news.length ? state.news.map(a => `
      <a class="article" href="/news/${a.id}" data-link>
        ${a.image_key ? `<div class="article-thumb"><img src="${imgUrl(a.image_key)}" alt="" loading="lazy"></div>` : ''}
        <div>
          <div class="article-date">${esc(niceDate(a.published_at))}</div>
          <div class="article-title">${esc(a.title)}</div>
          <div class="article-snippet">${esc(a.snippet)}</div>
        </div>
      </a>`).join('') : '<div class="empty-state">No news yet.</div>';
  }

  let lastFocus = null;
  function openArticle(id) {
    const a = (state.news || []).find(x => x.id === id);
    if (!a) return;
    lastFocus = document.activeElement;
    $('article-modal').innerHTML = `
      <button class="modal-close" aria-label="Close">&times;</button>
      ${a.image_key ? `<div class="modal-photo"><img src="${imgUrl(a.image_key)}" alt=""></div>` : ''}
      <div class="article-date">${esc(niceDate(a.published_at))}</div>
      <div class="modal-title">${esc(a.title)}</div>
      <div class="modal-body">${paragraphs(a.body)}</div>`;
    $('article-overlay').classList.add('active');
    document.body.classList.add('no-scroll');
    setTimeout(() => $('article-modal').querySelector('.modal-close').focus(), 0);
  }
  function closeArticle() {
    if (!$('article-overlay').classList.contains('active')) return;
    $('article-overlay').classList.remove('active');
    document.body.classList.remove('no-scroll');
    if (routeFromUrl().id) setUrl('/news', true);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $('article-overlay').addEventListener('click', e => { if (e.target === e.currentTarget || e.target.closest('.modal-close')) closeArticle(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeArticle(); });

  /* ---------- Comments (News page, held for approval) ---------- */
  async function renderComments(el) {
    el.innerHTML = `
      <h3 class="section-title">Comments</h3>
      <div class="cm-list"><div class="empty-state">Loading…</div></div>
      <form class="form" style="margin-top:18px;">
        <label>Your name<input type="text" name="name" required maxlength="60"></label>
        <label>Your comment<textarea name="body" required maxlength="600"></textarea></label>
        <div class="ts-slot"></div>
        <button class="btn" type="submit">Post comment</button>
        <div class="form-note">Comments appear once they have been approved.</div>
        <div class="form-done" role="status"></div>
      </form>`;
    const form = el.querySelector('form');
    mountTurnstile(form);
    form.addEventListener('submit', e => submitForm(e, '/api/comments', f => ({ scope: 'news', name: f.get('name'), body: f.get('body') }),
      'Thanks. Your comment will appear once it has been approved.'));
    try {
      const d = await api('/api/comments?scope=news');
      el.querySelector('.cm-list').innerHTML = d.comments.length
        ? d.comments.map(c => `<div class="cm-item"><b>${esc(c.name)}</b><small>${esc(niceDate(c.created_at))}</small><p>${esc(c.body)}</p></div>`).join('')
        : '<p class="meta-line">No comments yet. Be the first.</p>';
    } catch {
      el.querySelector('.cm-list').innerHTML = '';
    }
  }

  /* ---------- Forms ---------- */
  async function submitForm(e, url, build, doneText) {
    e.preventDefault();
    const form = e.target, done = form.querySelector('.form-done'), btn = form.querySelector('button[type=submit]');
    const body = build(new FormData(form));
    body.turnstile = turnstileToken(form);
    btn.disabled = true;
    done.textContent = 'Sending…';
    try {
      await api(url, { method: 'POST', body });
      form.reset();
      done.textContent = doneText;
    } catch (err) {
      done.textContent = err.message;
    } finally {
      btn.disabled = false;
      resetTurnstile(form);
    }
  }

  $('correction-form').addEventListener('submit', e => submitForm(e, '/api/corrections',
    f => ({ event: f.get('event'), message: f.get('message'), email: f.get('email') }),
    'Sent. Thank you, it will be checked before the results are changed.'));

  $('enquiry-form').addEventListener('submit', e => submitForm(e, '/api/enquiries',
    f => Object.fromEntries(['name', 'business', 'email', 'phone', 'interest', 'message'].map(k => [k, f.get(k)])),
    "Thanks. We'll be in touch about advertising shortly."));

  document.querySelectorAll('.signup-slot').forEach(slot => {
    const form = $('signup-template').content.firstElementChild.cloneNode(true);
    slot.appendChild(form);
    form.addEventListener('submit', e => submitForm(e, '/api/subscribe', f => ({ email: f.get('email') }),
      'Nearly there. Check your inbox and tap the link to confirm.'));
  });

  let rateCardChecked = false;
  function checkRateCard() {
    if (rateCardChecked) return;
    rateCardChecked = true;
    const link = $('pdf-link');
    fetch(link.getAttribute('href'), { method: 'HEAD' })
      .then(r => { if (!r.ok || !/pdf/i.test(r.headers.get('content-type') || '')) throw new Error(); })
      .catch(() => { $('pdf-line').textContent = 'The rate card is on its way. Send an enquiry below and we will reply with current rates.'; });
  }

  /* ---------- Ads: banner top and bottom, 8 boxes on the right ---------- */
  const ADV = '/about#advertise';
  function bannerHTML(ad) {
    if (!ad) return `<a class="banner" href="${ADV}" data-link><span class="ad-eyebrow">Advertisement</span>
      <span class="adv-here"><b>Advertise here</b><small>Full-width banner on every page · Enquire →</small></span></a>`;
    const inner = ad.image_key ? `<img src="${imgUrl(ad.image_key)}" alt="${esc(ad.name)}">`
      : `<span class="ad-eyebrow">Advertisement</span><span class="adv-here"><b>${esc(ad.name)}</b></span>`;
    return ad.link ? `<a class="banner" href="${esc(ad.link)}" target="_blank" rel="noopener sponsored">${inner}</a>` : `<div class="banner">${inner}</div>`;
  }
  // Each live ad shows once, starting at a random one so all get time near the top.
  // Slots with no ad show a neutral "Advertise here" box.
  function boxHTML(k) {
    const list = state.ads.small;
    if (k >= list.length) {
      return `<a class="ad-box" href="${ADV}" data-link><span class="ad-eyebrow">Advertisement</span>
        <span class="ad-body"><span class="adv-here"><b>Advertise here</b><small>Enquire →</small></span></span></a>`;
    }
    const ad = list[(k + state.adOffset) % list.length];
    const inner = ad.image_key ? `<img src="${imgUrl(ad.image_key)}" alt="${esc(ad.name)}" loading="lazy">` : `<span class="ad-name">${esc(ad.name)}</span>`;
    const body = `<span class="ad-eyebrow">Advertisement</span><span class="ad-body">${inner}</span>`;
    return ad.link ? `<a class="ad-box live" href="${esc(ad.link)}" target="_blank" rel="noopener sponsored">${body}</a>` : `<div class="ad-box live">${body}</div>`;
  }
  function renderAds() {
    const large = state.ads.large;
    $('banner-top').innerHTML = bannerHTML(large[0]);
    $('banner-bottom').innerHTML = bannerHTML(large[1] || large[0]);
    $('rail').innerHTML = Array.from({ length: 8 }, (_, k) => boxHTML(k)).join('');
  }

  /* ---------- Notices (email confirm / unsubscribe) ---------- */
  function showNotice() {
    const url = new URL(location.href);
    const s = url.searchParams.get('subscribe');
    const text = { confirmed: "You're on the list. You'll get an email each time new results are published.",
      invalid: 'That confirm link has expired or was already used. Sign up again if you need to.',
      removed: "You're unsubscribed and your email address has been deleted." }[s];
    if (!text) return;
    $('notice').textContent = text;
    $('notice').hidden = false;
    url.searchParams.delete('subscribe');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }

  /* ---------- Start ---------- */
  async function start() {
    $('year').textContent = new Date().getFullYear();
    showNotice();
    renderAds();
    try { state.config = await api('/api/config'); } catch { /* keep defaults */ }
    turnstileReady(state.config.turnstileSiteKey);
    document.querySelectorAll('form .ts-slot').forEach(s => mountTurnstile(s.closest('form')));
    render();
    try { state.ads = await api('/api/ads'); renderAds(); } catch { /* placeholders stay */ }
  }
  start();
})();
