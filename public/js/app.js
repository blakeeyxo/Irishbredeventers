/* IrishBredEventers public site. Behaviour ported from reference/irishbredeventers-mockup-v2.html. */
(function () {
  const { esc, api, ordinal, niceDate, scoreText, breedingText, turnstileReady, mountTurnstile, turnstileToken, resetTurnstile } = window.IBE;
  const $ = id => document.getElementById(id);

  const state = {
    config: { currentYear: new Date().getFullYear(), turnstileSiteKey: '' },
    ads: { large: [], small: [] },
    adOffset: Math.floor(Math.random() * 1000),
    season: null,
    searchField: 'all',
    news: null,
    loaded: {}
  };

  /* ---------- Routing ---------- */
  const VIEWS = ['home', 'results', 'search', 'news', 'about'];

  function routeFromUrl() {
    const url = new URL(location.href);
    const parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    const view = VIEWS.includes(parts[0]) ? parts[0] : 'home';
    return { view, id: parts[1], params: url.searchParams, hash: url.hash };
  }

  function navigate(href, replace) {
    if (replace) history.replaceState(null, '', href); else history.pushState(null, '', href);
    render();
  }

  function showView(view) {
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('active', a.dataset.tab === view));
    document.title = view === 'home' ? 'IrishBredEventers' : `${view[0].toUpperCase() + view.slice(1)} · IrishBredEventers`;
  }

  let lastView = null;
  function render() {
    const r = routeFromUrl();
    showView(r.view);
    if (r.view !== lastView && !r.hash) window.scrollTo({ top: 0 });
    lastView = r.view;
    if (r.view === 'home') renderHome();
    if (r.view === 'results') renderResults(Number(r.params.get('season')) || state.config.currentYear);
    if (r.view === 'search') {
      const q = r.params.get('q') || '';
      const input = $('global-search');
      if (document.activeElement !== input) input.value = q;
      state.searchField = r.params.get('field') || 'all';
      document.querySelectorAll('#search-fields button').forEach(b => b.classList.toggle('active', b.dataset.field === state.searchField));
      renderSearch(q);
    }
    if (r.view === 'news') renderNews().then(() => { if (r.id) openArticleModal(Number(r.id)); });
    if (r.hash) setTimeout(() => { const el = document.querySelector(r.hash); if (el) el.scrollIntoView(); }, 50);
  }

  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-link]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target) return;
    e.preventDefault();
    navigate(a.getAttribute('href'));
  });
  window.addEventListener('popstate', render);

  /* ---------- Entries ---------- */
  function entryRowHTML(h, showEvent) {
    const former = h.former_name ? `<div class="entry-former">was ${esc(h.former_name)}</div>` : '';
    const unv = h.verified ? '' : ' · <b class="unv-tag">Unverified</b>';
    const eventLine = showEvent
      ? `<div class="entry-breeding entry-event">${esc(h.event_name)} · ${esc(h.class_name)}${h.date_text ? ' · ' + esc(h.date_text) : ''}${unv}</div>`
      : '';
    return `
      <div class="entry-row" data-horse="${h.id}" role="button" tabindex="0" aria-label="${esc(h.horse_name)}, open profile">
        <div class="entry-row-wrap">
          <div class="entry-place">${esc(ordinal(h.position))}</div>
          <div class="entry-left">
            <div class="entry-name">${esc(h.horse_name)}</div>
            ${former}
            <div class="entry-breeding">${esc(breedingText(h))}</div>
            ${eventLine}
          </div>
        </div>
        <div class="entry-right"><div class="entry-score">${esc(scoreText(h))}</div></div>
      </div>`;
  }

  function groupedHTML(list) {
    let html = '', eventId, cls;
    // Rows arrive sorted by event date. Group by country in the order countries first appear.
    const byCountry = new Map();
    for (const h of list) {
      if (!byCountry.has(h.country)) byCountry.set(h.country, []);
      byCountry.get(h.country).push(h);
    }
    for (const [c, rows] of byCountry) {
      html += `<div class="group-country">${esc(c)}</div>`;
      eventId = null;
      for (const h of rows) {
        if (h.event_id !== eventId) {
          html += `<div class="group-event">${esc(h.event_name)}<span class="group-event-date">${esc(h.date_text)}</span></div>`;
          eventId = h.event_id; cls = null;
        }
        if (h.class_name !== cls) { html += `<div class="group-class">${esc(h.class_name)}</div>`; cls = h.class_name; }
        html += entryRowHTML(h, false);
      }
    }
    return html;
  }

  function onEntryActivate(e) {
    const row = e.target.closest('.entry-row[data-horse]');
    if (!row) return;
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    openProfile(Number(row.dataset.horse));
  }
  document.addEventListener('click', onEntryActivate);
  document.addEventListener('keydown', e => { if (e.target.closest && e.target.closest('.entry-row')) onEntryActivate(e); });

  /* ---------- Home ---------- */
  async function renderHome() {
    const year = state.config.currentYear;
    $('home-all-link').textContent = `See all of ${year}`;
    if (state.loaded.home) return;
    state.loaded.home = true;
    try {
      const d = await api('/api/home');
      if (d.headline) {
        $('hero-headline').textContent = d.headline.title;
        $('hero-copy').textContent = d.headline.snippet;
        $('hero-link').setAttribute('href', `/news/${d.headline.id}`);
      }
      $('home-preview').innerHTML = d.winners.length
        ? d.winners.map(h => entryRowHTML(h, true)).join('')
        : '<div class="empty-state">This week\'s results will appear here once they are published.</div>';
    } catch (e) {
      state.loaded.home = false;
      $('home-preview').innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
    }
  }

  /* ---------- Results ---------- */
  async function renderResults(season) {
    const extrasOnce = () => { if (!state.loaded.resultsComments) { state.loaded.resultsComments = true; renderComments('results', $('results-comments')); } };
    extrasOnce();
    if (state.season === season && state.loaded.results) return;
    state.season = season;
    state.loaded.results = true;
    const current = state.config.currentYear;
    $('results-title').textContent = season === current ? `All of ${season}` : `${season} season`;
    $('results-list').innerHTML = '<div class="empty-state">Loading…</div>';
    try {
      const d = await api(`/api/results?season=${season}`);
      $('season-toggle').innerHTML = d.seasons.map(y =>
        `<button data-year="${y}" class="${y === season ? 'active' : ''}">${y === current ? `All of ${y}` : y}</button>`).join('');
      const verified = d.rows.filter(h => h.verified);
      const unverified = d.rows.filter(h => !h.verified);
      let html = verified.length ? groupedHTML(verified) : '';
      if (unverified.length) html += `<div class="group-country unverified-head">Unverified results</div><p class="unv-note">These are still being checked and move up into their class once confirmed.</p>${groupedHTML(unverified)}`;
      $('results-list').innerHTML = html || `<div class="empty-state">No results for ${season} yet.${season < current ? ' Earlier seasons are being added from the archive.' : ''}</div>`;
    } catch (e) {
      state.loaded.results = false;
      $('results-list').innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
    }
  }

  $('season-toggle').addEventListener('click', e => {
    const b = e.target.closest('button[data-year]');
    if (!b) return;
    const y = Number(b.dataset.year);
    navigate(y === state.config.currentYear ? '/results' : `/results?season=${y}`);
  });
  $('legend-toggle').addEventListener('click', e => {
    const open = $('legend-drop').classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', open);
  });

  /* ---------- Search ---------- */
  let searchTimer, searchSeq = 0;
  async function renderSearch(q) {
    q = q.trim();
    const countEl = $('search-count'), out = $('search-results');
    if (!q) { countEl.textContent = ''; out.innerHTML = '<div class="empty-state">Start typing to search every result.</div>'; return; }
    const seq = ++searchSeq;
    try {
      const d = await api(`/api/search?q=${encodeURIComponent(q)}&field=${state.searchField}`);
      if (seq !== searchSeq) return;
      const shown = d.rows.length < d.total ? ` (showing the first ${d.rows.length})` : '';
      countEl.textContent = `${d.total} match${d.total === 1 ? '' : 'es'} for "${q}"${shown}`;
      out.innerHTML = d.rows.length ? d.rows.map(h => entryRowHTML(h, true)).join('') : '<div class="empty-state">No matches. Try part of a name, or a different field.</div>';
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

  /* ---------- Horse profile ---------- */
  function pedBox(cls, role, name, known) {
    if (known) return `<div class="ped-box ${cls}"><div class="ped-role">${role}</div><div class="ped-name-sm">${esc(name)}</div></div>`;
    return `<div class="ped-box ${cls} ped-missing"><div class="ped-missing-text">${role}<br>not in the results</div></div>`;
  }

  async function openProfile(id) {
    const card = $('profile-card');
    card.innerHTML = '<button class="profile-close" aria-label="Close">&times;</button><div class="empty-state">Loading…</div>';
    openOverlay('overlay');
    let d;
    try { d = await api(`/api/horse/${id}`); } catch (e) { card.innerHTML = `<button class="profile-close" aria-label="Close">&times;</button><div class="empty-state">${esc(e.message)}</div>`; return; }
    const h = d.horse, runs = d.runs;
    const formers = [...new Set(runs.map(r => r.former_name).filter(Boolean))];
    const positions = runs.map(r => r.position).filter(n => n);
    const dressage = runs.map(r => parseFloat(r.dressage)).filter(n => !isNaN(n));
    const xcClear = runs.filter(r => r.cross_country !== '' && parseFloat(r.cross_country) === 0).length;
    const xcKnown = runs.filter(r => r.cross_country !== '').length;
    card.innerHTML = `
      <button class="profile-close" aria-label="Close">&times;</button>
      <div class="profile-name">${esc(h.horse_name)}</div>
      ${formers.length ? `<div class="profile-former">Formerly competed as: ${esc(formers.join(', '))}</div>` : ''}
      <div class="profile-grid">
        ${h.breed ? `<span>Breed: <b>${esc(h.breed)}</b></span>` : ''}
        ${h.foaled || h.sex ? `<span>Foaled: <b>${esc([h.foaled, h.sex].filter(Boolean).join(' · '))}</b></span>` : ''}
        ${h.breeder ? `<span>Breeder: <b>${esc(h.breeder)}</b></span>` : ''}
      </div>
      <div class="profile-tabs" id="profile-tabs" role="tablist">
        <button class="active" data-pane="form">Form</button>
        <button data-pane="pedigree">Pedigree</button>
        <button data-pane="stats">Stats</button>
      </div>
      <div class="profile-pane active" id="pane-form">
        <div class="table-scroll"><table class="form-table">
          <tr><th>Date</th><th>Event / class</th><th>Score</th><th>Pos</th></tr>
          ${runs.map(r => `<tr>
            <td>${esc(r.date_text || r.start_date)}</td>
            <td>${esc(r.event_name)}<br><span style="color:var(--ink-faint);">${esc(r.class_name)}${r.verified ? '' : ' · Unverified'}</span></td>
            <td>${r.dressage !== '' ? `${esc(r.dressage)}, ${esc(r.show_jumping)}, ${esc(r.cross_country)}<br>` : ''}<b>${r.score !== null ? '= ' + esc(r.score) : ''}</b></td>
            <td class="pos">${esc(ordinal(r.position))}</td></tr>`).join('')}
        </table></div>
        <div class="ped-note">Every recorded run for ${esc(h.horse_name)}, newest first.</div>
      </div>
      <div class="profile-pane" id="pane-pedigree">
        <div class="ped-section-title">Bloodline</div>
        <div class="pedigree-chart">
          ${pedBox('ped-self', 'This horse', h.horse_name, true)}
          ${pedBox('ped-sire', 'Sire', h.sire, !!h.sire)}
          ${pedBox('ped-dam', 'Dam', h.dam, !!h.dam)}
          ${pedBox('ped-sire-sire', "Sire's sire", '', false)}
          ${pedBox('ped-sire-dam', "Sire's dam", '', false)}
          ${pedBox('ped-damsire', 'Dam sire', h.dam_sire, !!h.dam_sire)}
          ${pedBox('ped-dam-dam', "Dam's dam", '', false)}
        </div>
        <div class="ped-note">The weekly results carry sire, dam and dam sire.</div>
      </div>
      <div class="profile-pane" id="pane-stats">
        <div class="profile-result-row"><span>Runs recorded</span><span><b>${runs.length}</b></span></div>
        <div class="profile-result-row"><span>Best finish</span><span><b>${positions.length ? esc(ordinal(Math.min(...positions))) : '–'}</b></span></div>
        <div class="profile-result-row"><span>Wins</span><span><b>${positions.filter(p => p === 1).length}</b></span></div>
        <div class="profile-result-row"><span>Best dressage</span><span><b>${dressage.length ? Math.min(...dressage) : '–'}</b></span></div>
        <div class="profile-result-row"><span>Clear XC rounds</span><span><b>${xcKnown ? `${xcClear} of ${xcKnown}` : '–'}</b></span></div>
      </div>`;
  }
  $('profile-card').addEventListener('click', e => {
    const b = e.target.closest('#profile-tabs button');
    if (!b) return;
    document.querySelectorAll('#profile-tabs button').forEach(x => x.classList.toggle('active', x === b));
    document.querySelectorAll('#profile-card .profile-pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + b.dataset.pane));
  });

  /* ---------- Overlays ---------- */
  let lastFocus = null;
  function openOverlay(id) {
    lastFocus = document.activeElement;
    $(id).classList.add('active');
    document.body.classList.add('no-scroll');
    setTimeout(() => { const c = $(id).querySelector('.profile-close'); if (c) c.focus(); }, 0);
  }
  function closeOverlays() {
    const wasArticle = $('article-overlay').classList.contains('active');
    document.querySelectorAll('.overlay.active').forEach(o => o.classList.remove('active'));
    document.body.classList.remove('no-scroll');
    if (wasArticle && routeFromUrl().id) history.replaceState(null, '', '/news');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  document.querySelectorAll('.overlay').forEach(o => o.addEventListener('click', e => {
    if (e.target === o || e.target.closest('.profile-close')) closeOverlays();
  }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeOverlays(); });

  /* ---------- News ---------- */
  const imgUrl = key => `/media/${key}`;
  const paragraphs = t => String(t).split(/\n\s*\n/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');

  async function renderNews() {
    if (!state.loaded.newsComments) { state.loaded.newsComments = true; renderComments('news', $('news-comments')); }
    if (state.news) return;
    try {
      state.news = (await api('/api/news')).news;
    } catch (e) {
      $('news-list').innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
      return;
    }
    $('news-list').innerHTML = state.news.length ? state.news.map(a => `
      <a class="article ${a.image_key ? '' : 'article-text-only'}" href="/news/${a.id}" data-link>
        ${a.image_key ? `<div class="article-thumb"><div class="photo-frame"><img src="${imgUrl(a.image_key)}" alt="" loading="lazy"></div></div>` : ''}
        <div class="article-body">
          <div class="article-title">${esc(a.title)}</div>
          <div class="article-date">${esc(niceDate(a.published_at))}</div>
          <div class="article-snippet">${esc(a.snippet)}</div>
          <span class="read-more-link" style="font-size:13.5px;">Read more</span>
        </div>
      </a>`).join('') : '<div class="empty-state">No news yet.</div>';
  }

  function openArticleModal(id) {
    const a = (state.news || []).find(x => x.id === id);
    if (!a) return;
    $('article-modal-card').innerHTML = `
      <button class="profile-close" aria-label="Close">&times;</button>
      ${a.image_key ? `<div class="article-modal-photo"><div class="photo-frame"><img src="${imgUrl(a.image_key)}" alt=""></div></div>` : ''}
      <div class="article-modal-title">${esc(a.title)}</div>
      <div class="article-modal-date">${esc(niceDate(a.published_at))}</div>
      <div class="article-modal-body">${paragraphs(a.body)}</div>`;
    openOverlay('article-overlay');
  }

  /* ---------- Comments (held for approval) ---------- */
  async function renderComments(scope, el) {
    el.innerHTML = `<div class="extra-block">
      <h3 class="extra-title">Comments</h3>
      <div class="cm-list"><div class="empty-state">Loading…</div></div>
      <form class="site-form">
        <label>Your name<input type="text" name="name" required maxlength="60"></label>
        <label>Your comment<textarea name="body" required maxlength="600"></textarea></label>
        <div class="ts-slot"></div>
        <button class="site-btn" type="submit">Post comment</button>
        <div class="form-note">Comments appear once they have been approved.</div>
        <div class="form-done" role="status"></div>
      </form></div>`;
    const form = el.querySelector('form');
    mountTurnstile(form);
    form.addEventListener('submit', e => submitForm(e, '/api/comments', f => ({ scope, name: f.get('name'), body: f.get('body') }),
      'Thanks. Your comment will appear once it has been approved.'));
    try {
      const d = await api(`/api/comments?scope=${scope}`);
      el.querySelector('.cm-list').innerHTML = d.comments.length
        ? d.comments.map(c => `<div class="cm-item"><b>${esc(c.name)}</b> <small>${esc(niceDate(c.created_at))}</small><p>${esc(c.body)}</p></div>`).join('')
        : '<div class="empty-state">No comments yet.</div>';
    } catch (e) {
      el.querySelector('.cm-list').innerHTML = '';
    }
  }

  /* ---------- Forms: corrections and sign-up ---------- */
  async function submitForm(e, url, build, doneText) {
    e.preventDefault();
    const form = e.target, done = form.querySelector('.form-done, .signup-done'), btn = form.querySelector('button[type=submit]');
    const body = build(new FormData(form));
    body.turnstile = turnstileToken(form);
    btn.disabled = true;
    done.style.display = 'block';
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

  const corr = $('correction-form');
  corr.addEventListener('submit', e => submitForm(e, '/api/corrections',
    f => ({ event: f.get('event'), message: f.get('message'), email: f.get('email') }),
    'Sent. Thank you, it will be checked before the results are changed.'));

  document.querySelectorAll('.signup-slot').forEach(slot => {
    const form = $('signup-template').content.firstElementChild.cloneNode(true);
    slot.replaceWith(form);
    form.addEventListener('submit', e => submitForm(e, '/api/subscribe', f => ({ email: f.get('email') }),
      'Nearly there. Check your inbox and tap the link to confirm.'));
  });

  /* ---------- Ads ---------- */
  function placeholderTile(k) {
    return `<a class="ad-link" href="/about#advertise" data-link><span class="rail-eyebrow">Advertisement</span>
      <div class="ad-pic"><div class="photo-frame"><img src="/img/placeholder-${(k % 7) + 1}.jpg" alt="" loading="lazy"><div class="photo-label">ADVERTISE HERE</div></div></div>
      <div class="ad-cap">Small breeder or business</div></a>`;
  }
  function adInner(k) {
    const list = state.ads.small;
    if (!list.length) return placeholderTile(k);
    const a = list[(k + state.adOffset) % list.length];
    const pic = a.image_key ? `<img src="${imgUrl(a.image_key)}" alt="${esc(a.name)}" loading="lazy">` : `<div class="ad-text-only">${esc(a.name)}</div>`;
    const inner = `<span class="rail-eyebrow">Advertisement</span><div class="ad-pic">${pic}</div><div class="ad-cap">${esc(a.name)}</div>`;
    return a.link ? `<a class="ad-link" href="${esc(a.link)}" target="_blank" rel="noopener sponsored">${inner}</a>` : inner;
  }
  const adTiles = (n, start) => Array.from({ length: n }, (_, i) => `<div class="ad-tile">${adInner(start + i)}</div>`).join('');

  function renderAds() {
    for (let n = 1; n <= 8; n++) $('rail-' + n).innerHTML = adInner(n - 1);
    $('home-ads-1').innerHTML = adTiles(4, 8);
    $('home-ads-2').innerHTML = adTiles(4, 12);
    $('home-ads-3').innerHTML = adTiles(4, 16);
    $('results-ads').innerHTML = adTiles(8, 20);
    const b = state.ads.large[0];
    if (b) {
      const pic = b.image_key ? `<img src="${imgUrl(b.image_key)}" alt="${esc(b.name)}">` : `<span class="rail-eyebrow">Advertisement</span><div class="banner-title">${esc(b.name)}</div>`;
      const el = $('banner-ad');
      el.classList.add('banner-live');
      el.innerHTML = b.link ? `<a href="${esc(b.link)}" target="_blank" rel="noopener sponsored">${pic}</a>` : pic;
    }
  }

  /* ---------- Notices (email confirm / unsubscribe) ---------- */
  function showNotice() {
    const url = new URL(location.href);
    const s = url.searchParams.get('subscribe');
    const text = { confirmed: "You're on the list. You'll get an email each time new results are published.",
      invalid: 'That confirm link has expired or was already used. Sign up again below if you need to.',
      removed: "You're unsubscribed and your email address has been deleted." }[s];
    if (!text) return;
    $('notice').textContent = text;
    $('notice').hidden = false;
    url.searchParams.delete('subscribe');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }

  /* ---------- Start ---------- */
  async function start() {
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
