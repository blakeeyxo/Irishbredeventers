/* IrishBredEventingResults (IBER) public site. */
(function () {
  const { esc, api, ordinal, niceDate, turnstileReady, mountTurnstile, turnstileToken, resetTurnstile } = window.IBE;
  const $ = id => document.getElementById(id);
  const SITE = 'IrishBredEventingResults';
  const HOME_ROWS = window.matchMedia('(max-width: 720px)').matches ? 8 : 20;

  const state = {
    config: { currentYear: new Date().getFullYear(), turnstileSiteKey: '' },
    ads: { large: [], small: [] },
    links: [],
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
    if (r.view === 'horse') { showView('results'); renderResults(new URLSearchParams()); openHorse(Number(r.id)); }
    if (r.view === 'news') renderNews().then(() => { if (r.id) openArticle(Number(r.id)); });
    if (r.hash) setTimeout(() => { const el = document.querySelector(r.hash); if (el) el.scrollIntoView({ behavior: 'smooth' }); }, 60);
  }

  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-link]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target) return;
    e.preventDefault();
    // Horse names open the horse's record in a pop-up over the current page.
    const horse = a.getAttribute('href').match(/^\/horse\/(\d+)$/);
    if (horse) { openHorse(Number(horse[1])); return; }
    if (a.hasAttribute('data-close-modal')) closeOverlays();
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
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
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
    const rider = h.rider_name ? `<span class="sub rider">Rider: ${esc(h.rider_name)}${h.rider_country ? ` (${esc(h.rider_country)})` : ''}</span>` : '';
    return `<a class="horse-link" href="${horseHref(h)}" data-link>${esc(h.horse_name)}</a>${h.verified ? '' : '<span class="unv-tag">Unverified</span>'}${sub ? `<span class="sub">${sub}</span>` : ''}${rider}`;
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
          const evRows = rows.filter(x => x.event_id === h.event_id);
          const classes = new Set(evRows.map(x => x.class_name)).size;
          const details = [h.date_text, h.country, `${classes} class${classes === 1 ? '' : 'es'}`, `${evRows.length} Irish-bred placing${evRows.length === 1 ? '' : 's'}`]
            .filter(Boolean).map(esc).join(' · ');
          // Credited as plain text: results never link out to Horse Sport Ireland.
          const source = h.article_url ? ' · Horse Sport Ireland report' : '';
          html += `<tr class="grp-event"><td colspan="5"><b>${esc(h.event_name)}</b><span>${details}${source}</span></td></tr>`;
          eventId = h.event_id; cls = null;
        }
        if (h.class_name !== cls) { html += `<tr class="grp-class"><td colspan="5">${esc(h.class_name)}</td></tr>`; cls = h.class_name; }
        html += rowHTML(h, false);
      }
    }
    return html;
  }
  // Unverified placings come last in their own class (the API orders them that way), marked "Unverified".
  function groupedTable(rows) {
    return `<div class="rtable-wrap"><table class="rtable">${HEAD_GROUPED}<tbody>${groupedBody(rows)}</tbody></table></div>`;
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
      if (!rows.length) { $('week-table').innerHTML = '<div class="empty-state">This week\'s winners will appear here once the results are published.</div>'; return; }
      const dates = rows.map(r => r.start_date).filter(Boolean).sort();
      const events = new Set(rows.map(r => r.event_id)).size;
      // The week of the most recent event; a late result from an earlier week doesn't move the label back.
      const range = dates.length ? weekLabel(weekOf(dates[dates.length - 1])) : '';
      $('week-meta').innerHTML = `${range ? `<b>${esc(range)}</b> · ` : ''}${rows.length} Irish-bred winner${rows.length === 1 ? '' : 's'} across ${events} event${events === 1 ? '' : 's'}`;
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

  // Month tabs within the season: all twelve months for every year. Months without results yet are shown
  // lighter and fill in by themselves as results are imported (they come from the season's own rows).
  const ALL_MONTHS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  function renderMonths() {
    const withResults = new Set(state.seasonRows.map(r => (r.start_date || '').slice(5, 7)).filter(Boolean));
    if (!ALL_MONTHS.includes(state.month)) state.month = '';
    $('month-toggle').innerHTML = [['', 'All months'], ...ALL_MONTHS.map(m => [m, MONTH_NAMES[Number(m) - 1]])]
      .map(([m, l]) => `<button class="chip ${m === state.month ? 'active' : ''}${m && !withResults.has(m) ? ' empty' : ''}" data-month="${m}"${m && !withResults.has(m) ? ' title="No results yet"' : ''}>${l}</button>`).join('');
  }
  // What an empty month or year says: future months haven't happened yet; earlier ones are still to come from the archive.
  function emptyMessage() {
    const name = state.month ? `${MONTH_NAMES[Number(state.month) - 1]} ${state.season}` : String(state.season);
    const now = new Date(), thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const future = state.month ? `${state.season}-${state.month}` > thisMonth : state.season > now.getFullYear();
    return future ? `No results for ${name} yet. They appear here once the events have run.`
      : `Archive for ${name} coming soon. Results for this ${state.month ? 'month' : 'year'} are added as the archive is imported.`;
  }

  function applyFilters(push) {
    renderMonths();
    const rows = state.seasonRows.filter(r => !state.month || (r.start_date || '').slice(5, 7) === state.month);
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
    $('f-count').textContent = `${shown.length} placing${shown.length === 1 ? '' : 's'}${active.week || active.event || active.level || state.month ? ' match these filters' : ''}`;
    $('results-list').innerHTML = shown.length ? groupedTable(shown)
      : `<div class="empty-state">${rows.length ? 'No results match these filters.' : esc(emptyMessage())}</div>`;

    if (push) {
      const p = new URLSearchParams();
      if (state.season !== state.config.currentYear) p.set('season', state.season);
      if (state.month) p.set('month', state.month);
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
    state.month = /^\d{2}$/.test(params.get('month') || '') ? params.get('month') : '';
    // Selects are rebuilt in applyFilters; seed them with the URL values first.
    for (const k of ['week', 'event', 'level']) {
      const sel = $('f-' + k), v = params.get(k) || '';
      if (v && ![...sel.options].some(o => o.value === v)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(v)}">${esc(v)}</option>`);
      sel.value = v;
    }
    applyFilters(false);
  }

  ['f-week', 'f-level', 'f-event'].forEach(id => $(id).addEventListener('change', () => applyFilters(true)));
  $('f-clear').addEventListener('click', () => { ['f-week', 'f-event', 'f-level'].forEach(id => { $(id).value = ''; }); state.month = ''; applyFilters(true); });
  $('month-toggle').addEventListener('click', e => {
    const b = e.target.closest('button[data-month]');
    if (!b) return;
    state.month = b.dataset.month;
    ['f-week', 'f-event'].forEach(id => { $(id).value = ''; });
    applyFilters(true);
  });
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

  const CLOSE = '<button class="modal-close" aria-label="Close">&times;</button>';
  const monthOf = iso => (iso ? `${MONTH_NAMES[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : 'Date not given');
  const eventHref = r => `/results?${new URLSearchParams({ ...(r.season !== state.config.currentYear ? { season: r.season } : {}), month: r.start_date.slice(5, 7), event: r.event_id })}`;
  // Form: an index of the horse's classes, grouped by month so it reads like an event calendar.
  function formRows(runs) {
    let month = null;
    return runs.map(r => {
      const m = monthOf(r.start_date);
      const head = m !== month ? `<tr class="grp-class"><td colspan="5">${esc(m)}</td></tr>` : '';
      month = m;
      return `${head}<tr class="row">
          <td class="c-pl">${esc(ordinal(r.position))}</td>
          <td data-label="Date">${esc(r.date_text || niceDate(r.start_date))}</td>
          <td class="c-horse"><a href="${esc(eventHref(r))}" data-link data-close-modal>${esc(r.event_name)}</a><span class="sub">${esc(r.country)}</span></td>
          <td data-label="Class">${esc(r.class_name)}${r.verified ? '' : '<span class="unv-tag">Unverified</span>'}</td>
          <td class="c-score">${scoreCell(r)}</td></tr>`;
    }).join('');
  }
  async function openHorse(id) {
    const el = $('horse-modal');
    el.innerHTML = `${CLOSE}<div class="empty-state">Loading…</div>`;
    openOverlay('horse-overlay');
    let d;
    try { d = await api(`/api/horse/${id}`); } catch (e) { el.innerHTML = `${CLOSE}<div class="empty-state">${esc(e.message)}</div>`; return; }
    const h = d.horse, runs = d.runs;
    const formers = [...new Set(runs.map(r => r.former_name).filter(Boolean))];
    const positions = runs.map(r => r.position).filter(n => n);
    const dressage = runs.map(r => parseFloat(r.dressage)).filter(n => !isNaN(n));
    const xcKnown = runs.filter(r => r.cross_country !== '' && r.cross_country !== null);
    const xcClear = xcKnown.filter(r => parseFloat(r.cross_country) === 0).length;
    const fact = (label, v) => `<div><span>${label}</span><b>${esc(v || '–')}</b></div>`;
    el.innerHTML = `${CLOSE}
      <p class="eyebrow">Horse</p>
      <h2 class="page-title horse-title">${esc(h.horse_name)}</h2>
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
        </div>
        <div>
          <h3 class="section-title">Record</h3>
          <div class="stats">
            <div><span>Runs recorded</span><b>${runs.length}</b></div>
            <div><span>Wins / Placings<small>1st / top three</small></span><b>${positions.filter(p => p === 1).length} / ${positions.filter(p => p <= 3).length}</b></div>
            <div><span>Best dressage</span><b>${dressage.length ? Math.min(...dressage) : '–'}</b></div>
            <div><span>Clear cross country</span><b>${xcKnown.length ? `${xcClear} of ${xcKnown.length}` : '–'}</b></div>
          </div>
        </div>
      </div>
      <h3 class="section-title">Form</h3>
      <div class="rtable-wrap"><table class="rtable form-table">
        <thead><tr><th>Pl</th><th>Date</th><th>Event</th><th>Class</th><th class="c-score">Score</th></tr></thead>
        <tbody>${formRows(runs)}</tbody>
      </table></div>
      <p class="note">Every class ${esc(h.horse_name)} has run in, newest first, by month. Click an event to open its results.</p>`;
  }

  /* ---------- News ---------- */
  // The design preview supplies its own image lookup; the live site serves images from R2 at /media/.
  const imgUrl = key => (window.IBE_MEDIA_URL ? window.IBE_MEDIA_URL(key) : `/media/${key}`);
  const paragraphs = t => String(t).split(/\n\s*\n/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');

  let newsPromise = null;
  const loadNews = () => (newsPromise = newsPromise || api('/api/news').then(d => { state.news = d.news; return d.news; })
    .catch(e => { newsPromise = null; throw e; }));

  async function renderNews() {
    if (!state.loaded.newsComments) { state.loaded.newsComments = true; renderComments($('news-comments')); }
    try { await loadNews(); } catch (e) {
      $('news-list').innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
      return;
    }
    if ($('news-list').dataset.done) return;
    $('news-list').dataset.done = '1';
    $('news-list').innerHTML = state.news.length ? state.news.map(a => `
      <a class="article" href="/news/${a.id}" data-link>
        ${a.image_key ? `<div class="article-thumb"><img src="${imgUrl(a.image_key)}" alt="" loading="lazy"></div>` : ''}
        <div>
          <div class="article-date">${esc(niceDate(a.published_at))}${a.source_name ? ` · ${esc(a.source_name)}` : ''}</div>
          <div class="article-title">${esc(a.title)}</div>
          <div class="article-snippet">${esc(a.snippet)}</div>
        </div>
      </a>`).join('') : '<div class="empty-state">No news yet.</div>';
  }

  let lastFocus = null;
  function openOverlay(id) {
    if (!document.querySelector('.overlay.active')) lastFocus = document.activeElement;
    document.querySelectorAll('.overlay.active').forEach(o => { if (o.id !== id) o.classList.remove('active'); });
    $(id).classList.add('active');
    $(id).scrollTop = 0;
    document.body.classList.add('no-scroll');
    setTimeout(() => { const b = $(id).querySelector('.modal-close'); if (b) b.focus(); }, 0);
  }
  function closeOverlays() {
    const open = document.querySelector('.overlay.active');
    if (!open) return;
    open.classList.remove('active');
    document.body.classList.remove('no-scroll');
    const r = routeFromUrl();
    if (open.id === 'article-overlay' && r.view === 'news' && r.id) setUrl('/news', true);
    if (r.view === 'horse') setUrl('/results', true);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  document.querySelectorAll('.overlay').forEach(o => o.addEventListener('click', e => {
    if (e.target === o || e.target.closest('.modal-close')) closeOverlays();
  }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeOverlays(); });

  function openArticle(id) {
    const a = (state.news || []).find(x => x.id === id);
    if (!a) return;
    $('article-modal').innerHTML = `
      <button class="modal-close" aria-label="Close">&times;</button>
      ${a.image_key ? `<div class="modal-photo"><img src="${imgUrl(a.image_key)}" alt=""></div>` : ''}
      <div class="article-date">${esc(niceDate(a.published_at))}</div>
      <div class="modal-title">${esc(a.title)}</div>
      <div class="modal-body">${paragraphs(a.body)}</div>
      ${a.source_url ? `<p class="modal-source">${a.source_name ? `First published by ${esc(a.source_name)}. ` : ''}<a href="${esc(a.source_url)}" target="_blank" rel="noopener">Read the original ↗</a></p>` : ''}`;
    openOverlay('article-overlay');
  }

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

  /* ---------- Banners and the right-hand column ----------
     Banners show only when an ad is booked. The right-hand column runs the full height of the
     page. Each slot shows, in order of priority: the ad booked for that slot, otherwise a news
     card, otherwise an external link card. It never shows an empty box. */
  // How the image sits in its box, as chosen in the owner area: cropped to fill (and which part stays in
  // view), or the whole image shown.
  const FOCUS = { center: 'center', top: 'center top', bottom: 'center bottom', left: 'left center', right: 'right center' };
  // Phones (720px and under, where the banner and boxes change shape) get the advert's own phone crop when it has one.
  const adImg = (ad, lazy) => {
    const img = `<img src="${imgUrl(ad.image_key)}" alt="${esc(ad.name)}"${lazy ? ' loading="lazy"' : ''}
    style="object-fit:${ad.fit === 'contain' ? `contain;background:${/^#[0-9a-f]{6}$/i.test(ad.bg || '') ? ad.bg : '#ffffff'}` : 'cover'};object-position:${FOCUS[ad.focus] || 'center'}">`;
    return ad.phone_key ? `<picture><source media="(max-width: 720px)" srcset="${imgUrl(ad.phone_key)}">${img}</picture>` : img;
  };
  function bannerHTML(ad) {
    const inner = ad.image_key ? adImg(ad) : `<span class="banner-name">${esc(ad.name)}</span>`;
    return ad.link ? `<a class="banner" href="${esc(ad.link)}" target="_blank" rel="noopener sponsored">${inner}</a>` : `<div class="banner">${inner}</div>`;
  }
  function renderBanners() {
    const large = state.ads.large;
    $('banner-top').innerHTML = large[0] ? bannerHTML(large[0]) : '';
    $('banner-bottom').innerHTML = large[0] ? bannerHTML(large[1] || large[0]) : '';
    $('banner-top').parentElement.hidden = !large[0];
    $('banner-bottom').parentElement.hidden = !large[0];
  }

  const cardImage = key => key ? `<img src="${imgUrl(key)}" alt="" loading="lazy">` : '<span class="card-fallback" aria-hidden="true">IBER</span>';
  const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

  function adSlotHTML(ad) {
    const inner = ad.image_key ? adImg(ad, true) : `<span class="ad-name">${esc(ad.name)}</span>`;
    const body = `<span class="ad-body">${inner}</span>`;
    return ad.link ? `<a class="slot ad-box" href="${esc(ad.link)}" target="_blank" rel="noopener sponsored">${body}</a>` : `<div class="slot ad-box">${body}</div>`;
  }
  function newsCardHTML(n) {
    return `<a class="slot rcard" href="/news/${n.id}" data-link>
      <span class="card-img">${cardImage(n.image_key)}</span>
      <span class="card-body"><span class="card-kicker">News</span><b>${esc(n.title)}</b><span class="card-teaser">${esc(n.snippet)}</span></span></a>`;
  }
  function linkCardHTML(l) {
    const source = l.source_name || hostOf(l.url);
    return `<a class="slot rcard" href="${esc(l.url)}" target="_blank" rel="noopener">
      <span class="card-img">${cardImage(l.image_key)}</span>
      <span class="card-body"><span class="card-kicker">${esc(source)} ↗</span><b>${esc(l.title)}</b>${l.teaser ? `<span class="card-teaser">${esc(l.teaser)}</span>` : ''}</span></a>`;
  }

  const GAP = 14;
  const stackedRail = () => matchMedia('(max-width: 980px)').matches; // tablet and phone: the column sits under the page
  // How many roughly square slots fit beside the page content.
  function slotCount() {
    if (stackedRail()) return 8;
    const width = $('rail').clientWidth || 232;
    return Math.max(1, Math.round(($('main').offsetHeight + GAP) / (width + GAP)));
  }

  let lastRail = '';
  function buildRail() {
    const n = slotCount();
    const slots = new Array(n).fill(null);
    // a) Booked ads in their slot; ads without a slot fill the first free slots from the top.
    const small = state.ads.small || [];
    for (const ad of small.filter(a => a.slot)) if (ad.slot <= n && !slots[ad.slot - 1]) slots[ad.slot - 1] = adSlotHTML(ad);
    for (const ad of small.filter(a => !a.slot)) { const i = slots.indexOf(null); if (i >= 0) slots[i] = adSlotHTML(ad); }
    // b) News cards, then c) external link cards. If slots remain, the cards repeat so there is never a gap.
    const pool = (state.news || []).map(newsCardHTML).concat((state.links || []).map(linkCardHTML));
    let k = 0;
    for (let i = 0; i < n; i++) if (!slots[i] && pool.length) slots[i] = pool[k++ % pool.length];
    const html = slots.filter(Boolean).join('');
    if (html !== lastRail) { $('rail').innerHTML = html; lastRail = html; }
    $('rail').hidden = !html;
    // Beside the page, stretch the slots evenly so the column ends exactly where the page ends.
    const fit = !stackedRail() && !!html;
    $('rail').classList.toggle('fit', fit);
    $('rail').style.height = fit ? `${$('main').offsetHeight}px` : '';
  }
  let railTimer;
  const queueRail = () => { clearTimeout(railTimer); railTimer = setTimeout(buildRail, 80); };
  if (window.ResizeObserver) new ResizeObserver(queueRail).observe($('main'));
  window.addEventListener('resize', queueRail);

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
    try { state.config = await api('/api/config'); } catch { /* keep defaults */ }
    turnstileReady(state.config.turnstileSiteKey);
    document.querySelectorAll('form .ts-slot').forEach(s => mountTurnstile(s.closest('form')));
    render();
    const [ads, , links] = await Promise.allSettled([api('/api/ads'), loadNews(), api('/api/links')]);
    if (ads.status === 'fulfilled') state.ads = ads.value;
    if (links.status === 'fulfilled') state.links = links.value.links;
    renderBanners();
    buildRail();
  }
  start();
})();
