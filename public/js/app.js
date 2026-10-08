/* Public site for IrishBredEventingResults (IBER) and its sister sites; names come from js/site.js. */
(function () {
  const { esc, api, ordinal, niceDate, turnstileReady, mountTurnstile, turnstileToken, resetTurnstile } = window.IBE;
  const $ = id => document.getElementById(id);
  const SITE = window.SITE.name;
  const SHORT = window.SITE.short;
  const HOME_ROWS = window.matchMedia('(max-width: 720px)').matches ? 8 : 20;

  const state = {
    config: { currentYear: new Date().getFullYear(), turnstileSiteKey: '' },
    ads: { slots: {} },
    links: [],
    adOffset: Math.floor(Math.random() * 1000),
    season: null,
    seasonRows: [],
    searchField: 'all',
    news: null,
    loaded: {}
  };

  /* ---------- Routing ---------- */
  const VIEWS = ['home', 'results', 'search', 'horse', 'news', 'stallions', 'for-sale', 'about'];
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
    const names = { home: `${SITE} (${SHORT})`, results: 'Results', search: 'Search', news: 'News', stallions: 'Stallions', 'for-sale': 'For sale', about: 'About' };
    if (view !== 'horse') document.title = view === 'home' ? names.home : `${names[view]} · ${SITE}`;
  }

  // Private analytics for the owner area: a count of visits, page views and ad clicks. No cookies or personal data.
  function track(data) {
    try {
      const body = JSON.stringify(data);
      if (navigator.sendBeacon) navigator.sendBeacon('/api/track', body);
      else fetch('/api/track', { method: 'POST', body, keepalive: true }).catch(() => {});
    } catch { /* never in the way */ }
  }
  const PAGE_KEY = { home: 'home', results: 'results', news: 'news', stallions: 'stallions', 'for-sale': 'forsale', about: 'about', search: 'search' }; // horse pop-ups count in openHorse
  let lastTracked = null;

  let lastPath = null;
  function render() {
    const r = routeFromUrl();
    showView(r.view);
    const path = r.view + '/' + (r.id || '');
    if (path !== lastTracked && PAGE_KEY[r.view]) {
      lastTracked = path;
      track({ k: 'view', p: r.view === 'news' && r.id ? 'article' : r.view === 'stallions' && r.id ? 'stallion' : r.view === 'for-sale' && r.id ? (r.id === 'sell' ? 'sell' : 'listing') : PAGE_KEY[r.view] });
    }
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
    if (r.view === 'stallions') renderStallions(r.id);
    if (r.view === 'for-sale') renderForSale(r.id, r.params);
    renderAds(r.view);
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
  // Showjumping (IBSR) levels come from the FEI event code on each class (row.level), e.g. CSI2*, CSIO5*, CH-M-YH-S.
  const JUMPING = window.SITE.discipline === 'showjumping';
  const LEVEL_ORDER = JUMPING
    ? ['CSIO5*', 'CSIO4*', 'CSIO3*', 'CSIO2*', 'CSIO1*', 'CSI5*', 'CSI4*', 'CSI3*', 'CSI2*', 'CSI1*', 'Championships', 'Young horses', 'Juniors, young riders and ponies', 'Other']
    : ['CCI5*', 'CCI4*', 'CCI3*', 'CCI2*', 'CCI1*', 'Advanced', 'Intermediate', 'Pre-Novice', 'Novice', 'Beginner Novice',
      'BE105', 'BE100', 'BE90', 'BE80', 'Preliminary', 'Modified', 'Training', 'Other'];
  function jumpingLevel(event) {
    const e = String(event || '').toUpperCase();
    const o = e.match(/^CSIO\s*([1-5])\*/);
    if (o) return `CSIO${o[1]}*`;
    if (/YH/.test(e)) return 'Young horses';
    if (/^CSI[JYP]|^CH-[EM]-[JYP]|-J-|-Y-|-CH-/.test(e)) return 'Juniors, young riders and ponies';
    const c = e.match(/^CSI[A-Z]*\s*([1-5])\*/);
    if (c) return `CSI${c[1]}*`;
    if (/^CH-/.test(e)) return 'Championships';
    return 'Other';
  }
  function levelOf(cls, row) {
    if (JUMPING) return jumpingLevel(row && row.level);
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
  // Breeding that isn't known shows as UNK, and the horse is OIO (Of Irish Origin). Results with a real problem
  // never reach the site (the API leaves them out until Charlie verifies them), so there is no "Unverified" here.
  const isUnk = v => !v || /^(unk|unknown|n\/a|not known)$/i.test(String(v).trim());
  const unk = v => (isUnk(v) ? 'UNK' : v);
  const isOIO = h => (h.oio !== undefined ? !!h.oio : isUnk(h.sire) || isUnk(h.dam) || isUnk(h.dam_sire));
  const statusTag = h => (isOIO(h) ? '<span class="oio-tag" title="Of Irish Origin: part of the breeding is not recorded">OIO</span>' : '');
  function horseCell(h) {
    const facts = [h.breed, h.foaled, h.sex].filter(Boolean).join(' · ');
    const former = h.former_name ? `was ${esc(h.former_name)}` : '';
    const sub = [facts && esc(facts), former].filter(Boolean).join(' · ');
    const rider = h.rider_name ? `<span class="sub rider">Rider: ${esc(h.rider_name)}${h.rider_country ? ` (${esc(h.rider_country)})` : ''}</span>` : '';
    return `<a class="horse-link" href="${horseHref(h)}" data-link>${esc(h.horse_name)}</a>${statusTag(h)}${sub ? `<span class="sub">${sub}</span>` : ''}${rider}`;
  }
  function breedingCell(h) {
    // Unknown parts show as UNK; the dam's sire line only when the dam is known.
    return `${esc(unk(h.sire))}<span class="x">×</span>${esc(unk(h.dam))}${!isUnk(h.dam) ? `<span class="sub">dam by ${esc(unk(h.dam_sire))}</span>` : ''}`;
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
      <td data-label="Breeder">${esc(unk(h.breeder))}</td>
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
          // No source is named on the public site: every result is Charlie's.
          html += `<tr class="grp-event"><td colspan="5"><b>${esc(h.event_name)}</b><span>${details}</span></td></tr>`;
          eventId = h.event_id; cls = null;
        }
        if (h.class_name !== cls) { html += `<tr class="grp-class"><td colspan="5">${esc(h.class_name)}</td></tr>`; cls = h.class_name; }
        html += rowHTML(h, false);
      }
    }
    return html;
  }
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
    const levels = LEVEL_ORDER.filter(l => inWeek.some(r => levelOf(r.class_name, r) === l));
    fillSelect($('f-level'), levels.map(l => [l, l]), f.level, 'All levels');
    const inLevel = inWeek.filter(r => !$('f-level').value || levelOf(r.class_name, r) === $('f-level').value);
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
  // A known sire, dam or dam sire links to its breeding line: every result by that sire or out of that dam.
  const pedName = n => String(n).replace(/\s*[([].*$/, '').trim();
  const ped = (cls, role, name, missing = 'Not in the results', field = '') => name
    ? `<div class="ped ${cls}"><span>${role}</span><b>${field ? `<a href="/search?${new URLSearchParams({ q: pedName(name), field })}" data-link data-close-modal>${esc(name)}</a>` : esc(name)}</b></div>`
    : `<div class="ped ${cls} missing"><span>${role}</span><b>${missing}</b></div>`;

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
          <td data-label="Date">${esc(r.class_date ? niceDate(r.class_date) : (r.date_text || niceDate(r.start_date)))}</td>
          <td class="c-horse"><a href="${esc(eventHref(r))}" data-link data-close-modal>${esc(r.event_name)}</a><span class="sub">${esc(r.country)}</span></td>
          <td data-label="Class">${esc(r.class_name)}${statusTag(r)}</td>
          <td class="c-score">${scoreCell(r)}</td></tr>`;
    }).join('');
  }
  async function openHorse(id) {
    track({ k: 'view', p: 'horse' });
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
    // Showjumping: clear rounds and the biggest class jumped (heights are in the class name, e.g. "(1.45m)").
    const faultsKnown = runs.filter(r => r.faults !== null && r.faults !== undefined);
    const heights = runs.map(r => parseFloat((String(r.class_name).match(/\((\d\.\d{2})m\)/) || [])[1])).filter(n => !isNaN(n));
    const fact = (label, v) => `<div><span>${label}</span><b>${esc(v || '–')}</b></div>`;
    el.innerHTML = `${CLOSE}
      <p class="eyebrow">Horse</p>
      <h2 class="page-title horse-title">${esc(h.horse_name)}</h2>
      ${formers.length ? `<p class="horse-former">Formerly competed as ${esc(formers.join(', '))}</p>` : ''}
      <div class="facts">${fact('Breed', h.breed)}${fact('Foaled', h.foaled)}${fact('Sex', h.sex)}${fact('Breeder', unk(h.breeder))}</div>
      <div class="horse-grid">
        <div>
          <h3 class="section-title">Pedigree</h3>
          <div class="pedigree">
            ${ped('sire', 'Sire', isUnk(h.sire) ? '' : h.sire, 'UNK', 'sire')}${ped('dam', 'Dam', isUnk(h.dam) ? '' : h.dam, 'UNK', 'dam')}
            ${ped('ss', "Sire's sire", '')}${ped('sd', "Sire's dam", '')}
            ${ped('ds', 'Dam sire', isUnk(h.dam_sire) ? '' : h.dam_sire, 'UNK', 'sire')}${ped('dd', "Dam's dam", '')}
          </div>
        </div>
        <div>
          <h3 class="section-title">Record</h3>
          <div class="stats">
            <div><span>Runs recorded</span><b>${runs.length}</b></div>
            <div><span>Wins / Placings<small>1st / top three</small></span><b>${positions.filter(p => p === 1).length} / ${positions.filter(p => p <= 3).length}</b></div>
            ${JUMPING ? `<div><span>Clear rounds</span><b>${faultsKnown.length ? `${faultsKnown.filter(r => r.faults === 0).length} of ${faultsKnown.length}` : '–'}</b></div>
            <div><span>Biggest class</span><b>${heights.length ? `${Math.max(...heights).toFixed(2)}m` : '–'}</b></div>`
            : `<div><span>Best dressage</span><b>${dressage.length ? Math.min(...dressage) : '–'}</b></div>
            <div><span>Clear cross country</span><b>${xcKnown.length ? `${xcClear} of ${xcKnown.length}` : '–'}</b></div>`}
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
    // The spam check runs quietly in the background; give it a moment if the form is sent straight away.
    let token = turnstileToken(form);
    for (let i = 0; !token && i < 24 && form.querySelector('.ts-slot[data-widget]'); i++) {
      await new Promise(r => setTimeout(r, 250));
      token = turnstileToken(form);
    }
    body.turnstile = token;
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

  /* ---------- Adverts: each page's own pinned top banner and six side boxes ----------
     Every page (Home, Results, News, Stallions, About) has its own slots, sold separately: a top banner pinned
     to the top of the screen and three boxes down each side that stay in view. Nothing rotates or moves.
     A slot nobody has booked shows a small "available" box linking to the advertising enquiry. */
  // How the image sits in its box, as chosen in the owner area: cropped to fill (and which part stays in
  // view), or the whole image shown.
  const FOCUS = { center: 'center', top: 'center top', bottom: 'center bottom', left: 'left center', right: 'right center' };
  // Phones (720px and under, where the banner and boxes change shape) get the advert's own phone crop when it has one.
  const adImg = (ad, lazy) => {
    const img = `<img src="${imgUrl(ad.image_key)}" alt="${esc(ad.name)}"${lazy ? ' loading="lazy"' : ''}
    style="object-fit:${ad.fit === 'contain' ? `contain;background:${/^#[0-9a-f]{6}$/i.test(ad.bg || '') ? ad.bg : '#ffffff'}` : 'cover'};object-position:${FOCUS[ad.focus] || 'center'}">`;
    return ad.phone_key ? `<picture><source media="(max-width: 720px)" srcset="${imgUrl(ad.phone_key)}">${img}</picture>` : img;
  };
  const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const AD_PAGE = { home: 'home', results: 'results', horse: 'results', search: 'results', news: 'news', stallions: 'stallions', 'for-sale': 'forsale', about: 'about' };
  const AD_LABEL = ''; // adverts carry no label
  function adHTML(ad, banner, space = '') {
    const cls = banner ? 'banner' : 'slot ad-box';
    if (!ad) {
      return `<a class="${cls} ad-open" href="/about#advertise" data-link>${AD_LABEL}<span class="ad-open-text">${banner ? 'This banner space is available. Advertise here' : 'Advertise here'}</span></a>`;
    }
    const inner = ad.image_key ? adImg(ad, !banner) : `<span class="${banner ? 'banner-name' : 'ad-name'}">${esc(ad.name)}</span>`;
    const body = banner ? `${AD_LABEL}${inner}` : `${AD_LABEL}<span class="ad-body">${inner}</span>`;
    return ad.link ? `<a class="${cls}" href="${esc(ad.link)}" target="_blank" rel="noopener sponsored" data-ad-id="${ad.id}" data-space="${esc(space)}">${body}</a>` : `<div class="${cls}">${body}</div>`;
  }
  // A link card (an article on another website) fills a side space that has no advert, in the owner's order;
  // any space still empty shows "Advertise here".
  function linkCardHTML(l) {
    return `<a class="slot ad-box link-card" href="${esc(l.url)}" target="_blank" rel="noopener" data-link-id="${l.id}">
      <span class="ad-label">Read more</span>
      ${l.image_key ? `<span class="card-img"><img src="${imgUrl(l.image_key)}" alt="" loading="lazy"></span>` : ''}
      <span class="card-body"><span class="card-kicker">${esc(l.source_name || hostOf(l.url))} ↗</span><b>${esc(l.title)}</b></span></a>`;
  }
  let adsShown = null;
  function renderAds(view) {
    const page = AD_PAGE[view] || 'home';
    if (!state.adsLoaded || page === adsShown) return;
    adsShown = page;
    // The page's own advert for a space comes first, then one kept in that space on every page.
    const slot = pos => state.ads.slots[`${page}:${pos}`] || state.ads.slots[`all:${pos}`];
    const cards = [...(state.links || [])];
    const space = pos => `${page}:${pos}`;
    const side = pos => { const ad = slot(pos); return ad ? adHTML(ad, false, space(pos)) : cards.length ? linkCardHTML(cards.shift()) : adHTML(null, false); };
    $('banner-top').innerHTML = adHTML(slot('top'), true, space('top'));
    const order = ['left1', 'right1', 'left2', 'right2', 'left3', 'right3'].map(p => [p, side(p)]);
    const html = Object.fromEntries(order);
    $('side-left').innerHTML = ['left1', 'left2', 'left3'].map(p => html[p]).join('');
    $('side-right').innerHTML = ['right1', 'right2', 'right3'].map(p => html[p]).join('');
  }

  /* ---------- For sale: ads sent in by sellers, checked and paid, from the shared database ---------- */
  const listingImg = key => `/listing-media/${key}`;
  const THIS_YEAR = new Date().getFullYear();
  const euro = c => `€${(c / 100).toLocaleString('en-IE', { maximumFractionDigits: 0 })}`;
  const priceText = l => (l.price_on_request ? 'Price on request' : l.price_cents ? euro(l.price_cents) : '');
  const hh = v => (v ? `${Number(v).toFixed(1).replace(/\.0$/, '')}hh` : '');
  const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : '');
  const ageText = y => (y ? `${THIS_YEAR - y} yrs` : '');
  const listedText = iso => {
    if (!iso) return '';
    const days = Math.floor((Date.now() - new Date(iso.replace(' ', 'T') + 'Z')) / 86400000);
    return days <= 0 ? 'Listed today' : days === 1 ? 'Listed yesterday' : days < 30 ? `Listed ${days} days ago` : `Listed ${niceDate(iso)}`;
  };
  const factsLine = l => [cap(l.sex), ageText(l.foaled_year), hh(l.height_hh), l.studbook].filter(Boolean).map(esc).join(' · ');
  const breedingLine = l => (l.sire || l.dam ? `${l.sire ? `by ${esc(l.sire)}` : ''}${l.dam ? `${l.sire ? ' ' : ''}out of ${esc(l.dam)}` : ''}${l.dam_sire ? ` (by ${esc(l.dam_sire)})` : ''}` : '');
  const place = l => [l.county, l.country && l.country !== 'Ireland' ? l.country : (!l.county ? l.country : '')].filter(Boolean).map(esc).join(', ');

  function fillOptions(sel, values, label) {
    sel.insertAdjacentHTML('beforeend', values.map(v => `<option value="${v}">${esc(label(v))}</option>`).join(''));
  }
  const fsForm = $('fs-filters');
  fillOptions(fsForm.elements.age_min, [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15], v => `${v} yrs`);
  fillOptions(fsForm.elements.age_max, [2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20], v => `${v} yrs`);
  const HEIGHTS = [14, 14.2, 15, 15.2, 16, 16.2, 17, 17.2, 18];
  fillOptions(fsForm.elements.height_min, HEIGHTS, hh);
  fillOptions(fsForm.elements.height_max, HEIGHTS, hh);
  const PRICES = [2500, 5000, 7500, 10000, 15000, 20000, 30000, 50000, 75000, 100000];
  fillOptions(fsForm.elements.price_min, PRICES, v => euro(v * 100));
  fillOptions(fsForm.elements.price_max, PRICES, v => euro(v * 100));
  const FS_KEYS = ['q', 'sex', 'age_min', 'age_max', 'height_min', 'height_max', 'price_min', 'price_max', 'county', 'sort'];
  function fsQuery(page) {
    const q = new URLSearchParams();
    for (const k of FS_KEYS) { const v = fsForm.elements[k].value.trim(); if (v && !(k === 'sort' && v === 'newest')) q.set(k, v); }
    if (page > 1) q.set('page', page);
    return q;
  }
  let fsTimer = null;
  fsForm.addEventListener('input', () => { clearTimeout(fsTimer); fsTimer = setTimeout(() => navigate(`/for-sale${fsQuery(1).toString() ? `?${fsQuery(1)}` : ''}`, true), 300); });
  fsForm.addEventListener('submit', e => e.preventDefault());
  fsForm.addEventListener('reset', () => setTimeout(() => navigate('/for-sale', true), 0));

  function listingCard(l) {
    return `<a class="fs-card${l.status === 'sold' ? ' sold' : ''}" href="/for-sale/${l.id}" data-link>
      <span class="fs-photo">${l.photo ? `<img src="${listingImg(l.photo)}" alt="" loading="lazy">` : `<span class="card-fallback" aria-hidden="true">${esc(SHORT)}</span>`}
        ${l.status === 'sold' ? '<span class="fs-badge sold">Sold</span>' : `<span class="fs-badge">${esc(priceText(l))}</span>`}
        ${l.photos > 1 ? `<span class="fs-count">${l.photos} photos</span>` : ''}</span>
      <span class="fs-body">
        <b class="fs-title">${esc(l.title)}</b>
        <span class="fs-facts">${factsLine(l)}</span>
        ${breedingLine(l) ? `<span class="fs-breeding">${breedingLine(l)}</span>` : ''}
        ${l.level ? `<span class="fs-level">${esc(l.level)}</span>` : ''}
        <span class="fs-meta">${[place(l), listedText(l.published_at)].filter(Boolean).join(' · ')}</span>
      </span>
    </a>`;
  }

  async function renderForSale(id, params) {
    $('fs-list').hidden = !!id;
    $('fs-detail').hidden = !id || id === 'sell';
    $('fs-sell').hidden = id !== 'sell';
    if (id === 'sell') return showSellForm();
    if (id) return renderListing(Number(id));
    for (const k of FS_KEYS) fsForm.elements[k].value = params.get(k) || (k === 'sort' ? 'newest' : '');
    $('fs-grid').innerHTML = '<div class="empty-state">Loading…</div>';
    try {
      const d = await api(`/api/listings?${params}`);
      const county = fsForm.elements.county, chosen = params.get('county') || '';
      county.innerHTML = '<option value="">Anywhere</option>' + d.counties.map(c => `<option value="${esc(c.county)}">${esc(c.county)} (${c.n})</option>`).join('');
      county.value = chosen;
      const filtered = FS_KEYS.some(k => k !== 'sort' && params.get(k));
      $('fs-count').textContent = d.total ? `${d.total} horse${d.total === 1 ? '' : 's'} for sale` : '';
      $('fs-grid').innerHTML = d.listings.length ? d.listings.map(listingCard).join('')
        : `<div class="empty-state">${filtered ? 'No horses match those filters. Try widening them.' : 'No horses for sale yet.'} <a class="text-link" href="/for-sale/sell" data-link>Sell your horse here →</a></div>`;
      $('fs-pager').innerHTML = d.pages > 1 ? Array.from({ length: d.pages }, (_, i) => i + 1).map(n =>
        `<a class="chip${n === d.page ? ' active' : ''}" href="/for-sale?${fsQuery(n)}" data-link>${n}</a>`).join('') : '';
    } catch (e) {
      $('fs-grid').innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
      $('fs-pager').innerHTML = '';
    }
  }

  async function renderListing(id) {
    const el = $('fs-detail');
    el.innerHTML = '<div class="empty-state">Loading…</div>';
    let d;
    try { d = await api(`/api/listings/${id}`); } catch (e) {
      el.innerHTML = `<p><a class="text-link" href="/for-sale" data-link>← Horses for sale</a></p><div class="empty-state">${esc(e.message)}</div>`;
      return;
    }
    const l = d.listing, ped = d.horse && d.horse.pedigree;
    if (l.title) document.title = `${l.title} · For sale · ${SITE}`;
    const facts = [['Name', l.horse_name], ['Sex', cap(l.sex)], ['Age', l.foaled_year ? `${THIS_YEAR - l.foaled_year} (born ${l.foaled_year})` : ''],
      ['Height', hh(l.height_hh)], ['Colour', l.colour], ['Studbook', l.studbook], ['Sire', l.sire], ['Dam', l.dam], ["Dam's sire", l.dam_sire],
      ['Level', l.level], ['Location', place(l)], ['Seller', cap(l.seller_type === 'private' ? 'Private seller' : l.seller_type)]].filter(([, v]) => v);
    const cell = (k, cls = '') => {
      const h = ped && ped[k];
      return `<div class="fs-ped-cell ${cls}">${h ? `<b>${esc(h.name)}</b>${h.studbook ? ` <small>${esc(h.studbook)}</small>` : ''}` : '<span class="meta-line">Not recorded</span>'}</div>`;
    };
    const pedigree = ped && Object.keys(ped).length ? `
      <section class="block"><h3 class="section-title">Breeding</h3>
        <p class="meta-line">From the ${esc(SITE)} horse records${d.horse.breeder ? `. Bred by ${esc(d.horse.breeder)}${d.horse.breeder_county ? ` (${esc(d.horse.breeder_county)})` : ''}` : ''}.</p>
        <div class="fs-ped"><div class="fs-ped-col">${cell('s')}${cell('d')}</div><div class="fs-ped-col">${cell('ss', 'sm')}${cell('sd', 'sm')}${cell('ds', 'sm')}${cell('dd', 'sm')}</div></div>
      </section>` : '';
    const video = l.video_url && /^https:\/\//.test(l.video_url) ? `<p><a class="text-link" href="${esc(l.video_url)}" target="_blank" rel="noopener nofollow">Watch the video →</a></p>` : '';
    el.innerHTML = `
      <p><a class="text-link" href="/for-sale" data-link>← Horses for sale</a></p>
      <div class="fs-detail">
        <div class="fs-gallery">
          <div class="fs-main">${l.photos.length ? `<img id="fs-main-img" src="${listingImg(l.photos[0])}" alt="${esc(l.title)}">` : ''}${l.status === 'sold' ? '<span class="fs-badge sold">Sold</span>' : ''}</div>
          ${l.photos.length > 1 ? `<div class="fs-thumbrow">${l.photos.map((k, i) => `<button type="button" class="${i ? '' : 'active'}" data-photo="${esc(k)}" aria-label="Photo ${i + 1}"><img src="${listingImg(k)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
        </div>
        <div class="fs-side">
          <p class="eyebrow">For sale · Ad ${l.id}</p>
          <h2 class="fs-detail-title">${esc(l.title)}</h2>
          <p class="fs-price">${l.status === 'sold' ? 'Sold' : esc(priceText(l))}</p>
          <p class="meta-line">${factsLine(l)}${l.published_at ? ` · ${esc(listedText(l.published_at))}` : ''}</p>
          <dl class="fs-facts-table">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
          ${l.status === 'sold' ? '' : '<a class="btn" href="#fs-enquire">Ask the seller</a>'}
        </div>
      </div>
      ${l.description ? `<section class="block"><h3 class="section-title">About this horse</h3><div class="prose fs-description">${esc(l.description)}</div>${video}</section>` : video}
      ${pedigree}
      ${l.status === 'sold' ? '<section class="block"><div class="empty-state">This horse has been sold.</div></section>' : `
      <section class="block" id="fs-enquire"><h3 class="section-title">Ask the seller</h3>
        <p class="page-intro">Your message is emailed to the seller, who will reply to you directly.</p>
        <form class="form" id="fs-enquiry-form">
          <div class="form-row"><label>Your name<input type="text" name="name" required maxlength="80"></label>
          <label>Your email<input type="email" name="email" required maxlength="200"></label></div>
          <label>Phone (optional)<input type="tel" name="phone" maxlength="40"></label>
          <label>Message<textarea name="message" required maxlength="3000" placeholder="Is the horse still available? Can I come and see it?"></textarea></label>
          <div class="ts-slot"></div>
          <button class="btn" type="submit">Send to the seller</button>
          <div class="form-done" role="status"></div>
        </form>
      </section>`}`;
    el.querySelectorAll('[data-photo]').forEach(b => b.addEventListener('click', () => {
      $('fs-main-img').src = listingImg(b.dataset.photo);
      el.querySelectorAll('[data-photo]').forEach(x => x.classList.toggle('active', x === b));
    }));
    const form = $('fs-enquiry-form');
    if (form) {
      mountTurnstile(form);
      form.addEventListener('submit', e => submitForm(e, '/api/listings/enquire',
        f => ({ id: l.id, name: f.get('name'), email: f.get('email'), phone: f.get('phone'), message: f.get('message') }),
        'Sent. The seller will reply to you by email.'));
    }
  }

  /* "I want to sell": photos are made smaller in the browser before sending (long side 1600px), so uploads are quick. */
  const sellForm = $('sell-form');
  let sellPhotos = [];
  function showSellForm() {
    mountTurnstile(sellForm);
  }
  async function shrinkPhoto(file) {
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
      canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
      return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
    } catch { return file; }
  }
  function drawSellThumbs() {
    $('sell-thumbs').innerHTML = sellPhotos.map((p, i) => `<figure><img src="${p.url}" alt=""><figcaption>${i ? `Photo ${i + 1}` : 'Main photo'}</figcaption>
      <button type="button" class="btn-quiet" data-remove="${i}" aria-label="Remove photo ${i + 1}">Remove</button></figure>`).join('');
    $('sell-thumbs').querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => {
      URL.revokeObjectURL(sellPhotos[b.dataset.remove].url);
      sellPhotos.splice(Number(b.dataset.remove), 1);
      drawSellThumbs();
    }));
    $('sell-photos').required = !sellPhotos.length;
  }
  $('sell-photos').addEventListener('change', async e => {
    const files = [...e.target.files].slice(0, 8 - sellPhotos.length);
    for (const f of files) { const small = await shrinkPhoto(f); sellPhotos.push({ file: small, url: URL.createObjectURL(small) }); }
    e.target.value = '';
    drawSellThumbs();
  });
  sellForm.addEventListener('submit', async e => {
    e.preventDefault();
    const done = sellForm.querySelector('.form-done'), btn = sellForm.querySelector('button[type=submit]');
    if (!sellPhotos.length) { done.textContent = 'Add at least one photo.'; return; }
    const form = new FormData(sellForm);
    form.delete('photos');
    sellPhotos.forEach(p => form.append('photos', p.file));
    let token = turnstileToken(sellForm);
    for (let i = 0; !token && i < 24 && sellForm.querySelector('.ts-slot[data-widget]'); i++) { await new Promise(r => setTimeout(r, 250)); token = turnstileToken(sellForm); }
    form.set('turnstile', token || '');
    btn.disabled = true;
    done.textContent = 'Sending your ad…';
    try {
      await api('/api/listings/submit', { method: 'POST', form });
      sellForm.reset();
      sellPhotos.forEach(p => URL.revokeObjectURL(p.url));
      sellPhotos = [];
      drawSellThumbs();
      done.textContent = "Thanks, your ad has been sent. We'll check it and let you know the listing fee; payment is by phone to Charlie. It goes live once it's paid.";
    } catch (err) {
      done.textContent = err.message;
    } finally {
      btn.disabled = false;
      resetTurnstile(sellForm);
    }
  });

  /* ---------- Stallions: six paid listings, each with its progeny breakdown from the results ----------
     Every number on these pages covers the same rolling 12 months (the API works it out from today's date)
     and counts every appearance in the results, not only wins. */
  const fmt = n => Number(n || 0).toLocaleString('en-IE');
  const stallionPhoto = s => s.image_key ? `<img src="${imgUrl(s.image_key)}" alt="${esc(s.name)}" loading="lazy">` : `<span class="card-fallback" aria-hidden="true">${esc(SHORT)}</span>`;
  async function renderStallions(slot) {
    $('stallions-list').hidden = !!slot;
    $('stallion-detail').hidden = !slot;
    if (slot) return renderStallion(Number(slot));
    if (state.loaded.stallions) return;
    state.loaded.stallions = true;
    try {
      const d = await api('/api/stallions');
      $('stallions-window').textContent = `Progeny numbers: ${d.window.label}`;
      $('sire-chart-window').textContent = d.window.label;
      $('stallion-grid').innerHTML = d.listings.map(s => s.name ? `
        <a class="stallion-card" href="/stallions/${s.slot}" data-link>
          <span class="stallion-photo">${stallionPhoto(s)}</span>
          <span class="stallion-body">
            <b class="stallion-name">${esc(s.name)}</b>
            ${s.blurb ? `<span class="stallion-blurb">${esc(s.blurb)}</span>` : ''}
            <dl class="stallion-specs">
              <div><dt>Mentions</dt><dd>${fmt(s.totals.mentions)}</dd></div>
              <div><dt>Progeny</dt><dd>${fmt(s.totals.horses)}</dd></div>
              <div><dt>Wins</dt><dd>${fmt(s.totals.wins)}</dd></div>
            </dl>
            <span class="btn sm">See the progeny</span>
          </span>
        </a>` : `
        <a class="stallion-card open" href="/about#advertise" data-link>
          <span class="stallion-open"><b>Stallion listing ${s.slot}</b>This space is available. List your stallion here</span>
        </a>`).join('');
      // The sires mentioned most: every appearance of their progeny in the results over the same 12 months.
      const top = d.top || [], max = Math.max(0, ...top.map(t => t.mentions));
      $('sire-chart').innerHTML = top.length ? `
        <div class="bar-chart" role="img" aria-label="Sires mentioned most in the results, ${esc(d.window.label)}">${top.map(t => `
          <a class="bar-row" href="/search?${new URLSearchParams({ q: t.name, field: 'sire' })}" data-link>
            <span class="bar-label">${esc(t.name)}</span>
            <span class="bar-track"><span class="bar" style="width:${Math.max(4, (t.mentions / max) * 100)}%"></span><span class="bar-value">${t.mentions}</span></span>
            <span class="bar-tip">${esc(t.name)}: ${t.mentions} mention${t.mentions === 1 ? '' : 's'} by ${t.horses} horse${t.horses === 1 ? '' : 's'}, ${t.wins} win${t.wins === 1 ? '' : 's'}</span>
          </a>`).join('')}</div>
        <details class="chart-table"><summary>Show as a table</summary>
          <div class="rtable-wrap"><table class="rtable level-table">
            <thead><tr><th>Sire</th><th class="c-score">Mentions</th><th class="c-score">Horses</th><th class="c-score">Wins</th></tr></thead>
            <tbody>${top.map(t => `<tr class="row"><td>${esc(t.name)}</td><td class="c-score"><b>${t.mentions}</b></td><td class="c-score">${t.horses}</td><td class="c-score">${t.wins}</td></tr>`).join('')}</tbody>
          </table></div></details>` : '<div class="empty-state">No results in the last 12 months yet.</div>';
    } catch (e) {
      state.loaded.stallions = false;
      $('stallion-grid').innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
    }
  }
  // His own breeding, when the owner has filled it in: "By X out of Y (by Z). Bred by B. Foaled 2010."
  function pedigreeLine(p) {
    if (!p) return '';
    const by = p.sire ? `By ${esc(p.sire)}` : '', out = p.dam ? `${by ? ' out of' : 'Out of'} ${esc(p.dam)}${p.dam_sire ? ` by ${esc(p.dam_sire)}` : ''}` : '';
    const rest = [p.breeder ? `Bred by ${esc(p.breeder)}` : '', p.foaled ? `Foaled ${esc(p.foaled)}` : ''].filter(Boolean);
    const text = [`${by}${out}`.trim(), ...rest].filter(Boolean).join('. ');
    return text ? `<p class="stallion-pedigree">${text}.</p>` : '';
  }
  async function renderStallion(slot) {
    const el = $('stallion-detail');
    el.innerHTML = '<div class="empty-state">Loading…</div>';
    let d;
    try { d = await api(`/api/stallions/${slot}`); } catch (e) { el.innerHTML = `<p><a class="text-link" href="/stallions" data-link>← All stallions</a></p><div class="empty-state">That stallion listing is empty.</div>`; return; }
    const s = d.stallion, t = d.totals, rows = d.rows, win = d.window;
    // Mentions (every placing), top-three finishes and wins by level, for the chart and its table.
    const byLevel = LEVEL_ORDER.map(level => {
      const at = rows.filter(r => levelOf(r.class_name, r) === level);
      return { level, mentions: at.length, top3: at.filter(r => r.placing && r.placing <= 3).length, wins: at.filter(r => r.placing === 1).length };
    }).filter(x => x.mentions);
    const maxMentions = Math.max(0, ...byLevel.map(x => x.mentions));
    // One row per horse: runs, wins, best placing and the latest run.
    const horses = new Map();
    for (const r of rows) {
      const h = horses.get(r.horse_id) || { ...r, runs: 0, wins: 0, best: null };
      h.runs++;
      if (r.placing === 1) h.wins++;
      if (r.placing && (h.best === null || r.placing < h.best)) h.best = r.placing;
      horses.set(r.horse_id, h);
    }
    const list = [...horses.values()].sort((a, b) => b.wins - a.wins || (a.best ?? 99) - (b.best ?? 99) || b.runs - a.runs || a.horse.localeCompare(b.horse));
    el.innerHTML = `
      <p><a class="text-link" href="/stallions" data-link>← All stallions</a></p>
      <div class="stallion-head">
        <span class="stallion-photo">${stallionPhoto(s)}</span>
        <div>
          <p class="eyebrow">Stallion</p>
          <h2 class="page-title">${esc(s.name)}</h2>
          ${s.blurb ? `<p class="page-intro">${esc(s.blurb)}</p>` : ''}
          ${pedigreeLine(d.pedigree)}
          ${s.link ? `<p><a class="text-link" href="${esc(s.link)}" target="_blank" rel="noopener">Visit the stud's website ↗</a></p>` : ''}
        </div>
      </div>
      <h3 class="section-title">Progeny breakdown</h3>
      <p class="window-label">${esc(win.label)}</p>
      <div class="stat-tiles">
        <div><span>Mentions</span><b>${fmt(t.mentions)}</b></div>
        <div><span>Progeny</span><b>${fmt(t.horses)}</b></div>
        <div><span>Top-three finishes</span><b>${fmt(t.top3)}</b></div>
        <div><span>Wins</span><b>${fmt(t.wins)}</b></div>
      </div>
      ${rows.length ? `
      <h3 class="section-title">Mentions by level</h3>
      <p class="window-label">${esc(win.label)}</p>
      <div class="bar-chart" role="img" aria-label="Progeny mentions by level, ${esc(win.label)}">${byLevel.map(x => `
        <div class="bar-row" tabindex="0">
          <span class="bar-label">${esc(x.level)}</span>
          <span class="bar-track"><span class="bar" style="width:${Math.max(4, (x.mentions / maxMentions) * 100)}%"></span><span class="bar-value">${x.mentions}</span></span>
          <span class="bar-tip">${esc(x.level)}: ${x.mentions} mention${x.mentions === 1 ? '' : 's'}, ${x.top3} in the top three, ${x.wins} win${x.wins === 1 ? '' : 's'}</span>
        </div>`).join('')}</div>
      <div class="rtable-wrap"><table class="rtable level-table">
        <thead><tr><th>Level</th><th class="c-score">Mentions</th><th class="c-score">Top three</th><th class="c-score">Wins</th></tr></thead>
        <tbody>${byLevel.map(x => `<tr class="row"><td>${esc(x.level)}</td><td class="c-score"><b>${x.mentions}</b></td><td class="c-score">${x.top3}</td><td class="c-score">${x.wins}</td></tr>`).join('')}</tbody>
      </table></div>
      <h3 class="section-title">Progeny</h3>
      <div class="rtable-wrap"><table class="rtable">
        <thead><tr><th>Horse</th><th>Dam</th><th class="c-score">Runs</th><th class="c-score">Wins</th><th class="c-score">Best</th><th>Latest</th></tr></thead>
        <tbody>${list.map(h => `<tr class="row">
          <td class="c-horse">${h.placing_id ? `<a class="horse-link" href="/horse/${h.placing_id}" data-link>${esc(h.horse)}</a>` : esc(h.horse)}<span class="sub">${[h.birth_year, h.sex].filter(Boolean).map(esc).join(' · ')}</span></td>
          <td data-label="Dam">${esc(h.dam || '–')}</td>
          <td class="c-score" data-label="Runs">${h.runs}</td>
          <td class="c-score" data-label="Wins"><b>${h.wins}</b></td>
          <td class="c-score" data-label="Best">${esc(h.best ? ordinal(h.best) : '–')}</td>
          <td data-label="Latest">${esc(h.event_name)}<span class="sub">${esc(h.class_name)} · ${esc(niceDate(h.start_date))}</span></td></tr>`).join('')}</tbody>
      </table></div>
      <p class="note">Counted from every ${esc(SHORT)} result for horses by ${esc(s.name)} at events starting ${esc(niceDate(win.start))} to ${esc(niceDate(win.end))}. A mention is any placing, not only a win.</p>`
      : `<div class="empty-state">No progeny in the results in the ${esc(win.label.replace(/^Last/, 'last'))}.</div>`}`;
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

  // The fixed top section (header and banner) changes height with the screen; the side boxes sit just below it.
  const topbar = $('topbar');
  const setTopH = () => document.documentElement.style.setProperty('--top-h', `${topbar.offsetHeight}px`);
  if (window.ResizeObserver) new ResizeObserver(setTopH).observe(topbar);
  setTopH();

  /* ---------- Start ---------- */
  async function start() {
    $('year').textContent = new Date().getFullYear();
    showNotice();
    // One visit per browser session (kept in the tab's session storage, not a cookie).
    try { if (!sessionStorage.getItem('iber-visit')) { sessionStorage.setItem('iber-visit', '1'); track({ k: 'visit' }); } } catch { /* private mode */ }
    document.addEventListener('click', e => {
      const ad = e.target.closest('a[data-ad-id]'), card = e.target.closest('a[data-link-id]');
      if (ad) track({ k: 'ad', a: Number(ad.dataset.adId), s: ad.dataset.space });
      if (card) track({ k: 'link', a: Number(card.dataset.linkId) });
    });
    try { state.config = await api('/api/config'); } catch { /* keep defaults */ }
    turnstileReady(state.config.turnstileSiteKey);
    document.querySelectorAll('form .ts-slot').forEach(s => mountTurnstile(s.closest('form')));
    render();
    try { [state.ads, state.links] = await Promise.all([api('/api/ads'), api('/api/links').then(d => d.links || []).catch(() => [])]); } catch { /* the slots show as available */ }
    state.adsLoaded = true;
    renderAds(routeFromUrl().view);
  }
  start();
})();
