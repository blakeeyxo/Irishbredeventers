/* Owner area. Every action works on a phone. */
(function () {
  const { esc, api, ordinal, niceDate, scoreText } = window.IBE;
  const $ = id => document.getElementById(id);

  /* ---------- Tabs ---------- */
  const loaders = { results: loadBatches, unverified: loadUnverified, news: loadNews, ads: loadAds, comments: loadComments, corrections: loadCorrections, enquiries: loadEnquiries };
  $('adm-tabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-a]');
    if (!b) return;
    document.querySelectorAll('#adm-tabs button').forEach(x => x.classList.toggle('active', x === b));
    document.querySelectorAll('.adm-pane').forEach(x => x.classList.toggle('active', x.id === 'adm-' + b.dataset.a));
    loaders[b.dataset.a]();
  });

  async function loadSummary() {
    const s = await api('/api/admin/summary');
    $('who').textContent = `Logged in as ${s.user}`;
    for (const k of ['unverified', 'comments', 'corrections', 'enquiries']) {
      const el = $('n-' + k);
      el.textContent = s[k];
      el.hidden = !s[k];
    }
    if (!$('adm-country').options.length) {
      $('adm-country').innerHTML = s.countries.map(c => `<option>${esc(c)}</option>`).join('');
      $('adm-country').value = 'England';
    }
    return s;
  }
  let summary = null;
  const refreshSummary = () => loadSummary().then(s => { summary = s; }).catch(showLoginError);

  function showLoginError(e) {
    document.querySelector('main').insertAdjacentHTML('afterbegin', `<div class="notice">${esc(e.message)}</div>`);
  }

  const btnMsg = (el, t) => { el.textContent = t; };

  /* ---------- Weekly results: paste or upload → preview → confirm ---------- */
  // State for the current paste. Nothing is saved until CONFIRM.
  let imp = null; // { rows, weekLabel, notes, events, classes, questions, decisions, onlyProblems, editing }

  $('adm-year').value = new Date().getFullYear();
  $('adm-clear').addEventListener('click', () => {
    $('parse-form').reset(); $('adm-year').value = new Date().getFullYear();
    imp = null; renderImport(); btnMsg($('adm-msg'), '');
  });
  $('adm-file').addEventListener('change', () => { if ($('adm-file').files[0]) $('parse-form').requestSubmit(); });

  $('parse-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = new FormData(e.target);
    if (!$('adm-file').files[0]) form.delete('file');
    btnMsg($('adm-msg'), 'Reading…');
    try {
      const d = await api('/api/admin/parse', { method: 'POST', form });
      $('adm-text').value = d.text;
      $('adm-file').value = '';
      imp = { rows: d.rows.map(r => ({ ...r, skip: false })), weekLabel: d.weekLabel || '', notes: d.notes, events: d.events, classes: d.classes,
        questions: [], decisions: {}, onlyProblems: false, editing: null, summary: null };
      btnMsg($('adm-msg'), d.rows.length ? '' : 'No placings found. Each placing starts with its position, e.g. "1st Westwick Rebel [ISH] - 2014 gelding by …".');
      await runCheck();
      if (d.rows.length) $('adm-preview').scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      btnMsg($('adm-msg'), err.message);
    }
  });

  // Ask the server which names already exist and which look like an existing record.
  let checkSeq = 0;
  async function runCheck() {
    if (!imp || !imp.rows.length) { renderImport(); return; }
    const seq = ++checkSeq;
    try {
      const d = await api('/api/admin/import/check', { method: 'POST', body: { rows: imp.rows, decisions: imp.decisions } });
      if (seq !== checkSeq || !imp) return;
      imp.questions = d.questions;
      imp.newCounts = d.newCounts;
    } catch (err) {
      btnMsg($('adm-msg'), err.message);
    }
    renderImport();
  }
  let recheckTimer;
  const recheckSoon = () => { clearTimeout(recheckTimer); recheckTimer = setTimeout(runCheck, 500); };

  const tagged = (n, b, t) => n ? `${esc(n)}${b ? ` <small>(${esc(b)})</small>` : ''}${t ? ' <small class="tih">TIH</small>' : ''}` : '<span class="iss">?</span>';
  const EDIT_FIELDS = [
    ['position', 'Place'], ['horse_name', 'Horse'], ['former_name', 'Former name(s)'], ['breed', 'Breed code'], ['tih_flag', 'Horse TIH', 'check'],
    ['foaled', 'Year'], ['sex', 'Sex'], ['sire', 'Sire'], ['sire_breed', 'Sire code'], ['sire_tih', 'Sire TIH', 'check'],
    ['dam', 'Dam'], ['dam_breed', 'Dam code'], ['dam_tih', 'Dam TIH', 'check'], ['dam_sire', 'Dam sire'], ['dam_sire_breed', 'Dam sire code'],
    ['dam_sire_tih', 'Dam sire TIH', 'check'], ['breeder', 'Breeder'], ['breeder_county', 'County'], ['rider_name', 'Rider'], ['rider_country', 'Rider country'],
    ['dressage', 'Dressage'], ['show_jumping', 'Show jumping'], ['cross_country', 'Cross country'], ['score', 'Total'],
    ['class_name', 'Class'], ['event_name', 'Event'], ['country', 'Country'], ['start_date', 'Event start (YYYY-MM-DD)']
  ];

  function rowHTML(r, i) {
    const status = r.skip ? 'skip' : r.issues.length ? 'bad' : r.warnings.length ? 'warn' : '';
    const edit = imp.editing === i ? `<tr class="edit-row"><td colspan="8"><div class="adm-row-edit">${EDIT_FIELDS.map(([k, l, t]) => t === 'check'
      ? `<label class="chk"><input type="checkbox" data-f="${k}" data-i="${i}" ${r[k] ? 'checked' : ''}> ${l}</label>`
      : `<label>${l}<input data-f="${k}" data-i="${i}" value="${esc(r[k] ?? '')}"></label>`).join('')}</div>
      <div class="adm-actions"><button class="btn sm" type="button" data-done="${i}">Done</button></div></td></tr>` : '';
    return `<tr class="${status}">
      <td data-label="Place">${esc(ordinal(r.position))}</td>
      <td data-label="Horse"><b>${esc(r.horse_name || '?')}</b>${r.breed ? ` <small>(${esc(r.breed)})</small>` : ''}${r.tih_flag ? ' <small class="tih">TIH</small>' : ''}
        ${r.former_name ? `<br><small>was ${esc(r.former_name)}</small>` : ''}<br><small>${esc([r.foaled, r.sex].filter(Boolean).join(' ') || 'year and sex?')}</small></td>
      <td data-label="Sire × Dam">${tagged(r.sire, r.sire_breed, r.sire_tih)} × ${tagged(r.dam, r.dam_breed, r.dam_tih)}<br><small>dam by ${r.dam_sire ? tagged(r.dam_sire, r.dam_sire_breed, r.dam_sire_tih) : '–'}</small></td>
      <td data-label="Breeder">${r.breeder ? esc(r.breeder) : '–'}${r.breeder_county ? `<br><small>${esc(r.breeder_county)}</small>` : ''}</td>
      <td data-label="Rider">${esc(r.rider_name || '–')}${r.rider_country ? ` <small>${esc(r.rider_country)}</small>` : ''}</td>
      <td data-label="Score">${esc(scoreText(r) || '–')}</td>
      <td data-label="Event">${esc(r.event_name || '?')}<br><small>${esc(r.class_name || '?')} · ${esc(r.country || '?')}</small>
        ${r.issues.length ? `<div class="iss">⚠ ${esc(r.issues.join('; '))}</div>` : ''}
        ${r.warnings.length ? `<div class="adm-warn">${esc(r.warnings.join('; '))}</div>` : ''}</td>
      <td data-label="Options" class="opts">
        <label class="chk"><input type="checkbox" data-unv="${i}" ${r.verified ? '' : 'checked'}> Unverified</label>
        <label class="chk"><input type="checkbox" data-skip="${i}" ${r.skip ? 'checked' : ''}> Leave out</label>
        <button class="btn sm alt" type="button" data-edit="${i}">${imp.editing === i ? 'Close' : 'Fix'}</button></td></tr>${edit}`;
  }

  function questionsHTML() {
    if (!imp.questions.length) return '';
    const kinds = { sire: 'Sire', dam: 'Dam', breeder: 'Breeder', horse: 'Horse' };
    const open = imp.questions.filter(q => !imp.decisions[q.key]).length;
    return `<div class="match-box">
      <h4>Names that look like ones already on file <span class="${open ? 'iss' : 'ok'}">${open ? `${open} to answer` : 'all answered'}</span></h4>
      <p class="intro">Choose "Same" if it is the same horse or person spelled differently, or "Different" to keep it as a new record.</p>
      ${imp.questions.map(q => `<div class="match">
        <div><b>${esc(kinds[q.kind])}: ${esc(q.name)}</b> <small>${esc(q.context)}</small></div>
        <div class="match-opts">
          ${q.candidates.map(c => `<label class="chk"><input type="radio" name="${esc(q.key)}" value="${esc(c.id)}" ${String(imp.decisions[q.key]) === String(c.id) ? 'checked' : ''}>
            Same as <b>${esc(c.label)}</b> <small>${esc(c.detail || '')}</small></label>`).join('')}
          <label class="chk"><input type="radio" name="${esc(q.key)}" value="new" ${imp.decisions[q.key] === 'new' ? 'checked' : ''}> Different (new record)</label>
        </div></div>`).join('')}
    </div>`;
  }

  function renderImport() {
    const box = $('adm-preview');
    if (!imp) { box.innerHTML = ''; return; }
    if (imp.summary) {
      const s = imp.summary;
      box.innerHTML = `<div class="summary-box">
        <h4>Saved ${esc(imp.weekLabel || 'this week')}</h4>
        <div class="summary-grid">
          <div><b>${s.results}</b><span>results</span></div><div><b>${s.horses}</b><span>new horses</span></div>
          <div><b>${s.sires}</b><span>new sires</span></div><div><b>${s.dams}</b><span>new dams</span></div><div><b>${s.breeders}</b><span>new breeders</span></div>
        </div>
        <p class="intro">${s.alreadySaved ? `${s.alreadySaved} of these results were already saved, so they were left as they were. ` : ''}${s.emailed ? `Emailing ${s.emailed} subscribers now.` : ''}</p>
        <button class="btn alt" type="button" id="imp-new">Paste another week</button></div>`;
      $('imp-new').addEventListener('click', () => { imp = null; $('parse-form').reset(); $('adm-year').value = new Date().getFullYear(); renderImport(); window.scrollTo({ top: 0 }); });
      return;
    }
    if (!imp.rows.length) { box.innerHTML = ''; return; }
    const incl = imp.rows.filter(r => !r.skip);
    const bad = incl.filter(r => r.issues.length).length, warn = incl.filter(r => !r.issues.length && r.warnings.length).length;
    const open = imp.questions.filter(q => !imp.decisions[q.key]).length;
    const subs = summary ? summary.subscribers : 0;
    const shown = imp.rows.map((r, i) => [r, i]).filter(([r]) => !imp.onlyProblems || r.issues.length || r.warnings.length);
    const nc = imp.newCounts || {};
    box.innerHTML = `<div style="margin-top:30px;">
      <h3>Check before saving</h3>
      <p class="intro"><b>${incl.length}</b> placings in <b>${imp.events}</b> event${imp.events === 1 ? '' : 's'} and <b>${imp.classes}</b> class${imp.classes === 1 ? '' : 'es'}.
        <span class="iss">${bad} could not be read cleanly</span> and are ticked Unverified. ${warn} ${warn === 1 ? 'has' : 'have'} notes. Click <b>Fix</b> on any row to correct it.</p>
      ${questionsHTML()}
      <div class="adm-bar"><label class="chk"><input type="checkbox" id="imp-only" ${imp.onlyProblems ? 'checked' : ''}> Show only rows with warnings</label>
        <span>New on file if saved: ${nc.horses ?? '…'} horses, ${nc.sires ?? '…'} sires, ${nc.dams ?? '…'} dams, ${nc.breeders ?? '…'} breeders</span></div>
      <div class="table-scroll"><table class="adm-table stack imp-table"><tr><th>Place</th><th>Horse</th><th>Sire × Dam</th><th>Breeder</th><th>Rider</th><th>Score</th><th>Event · class</th><th></th></tr>
      ${shown.map(([r, i]) => rowHTML(r, i)).join('')}</table></div>
      ${imp.notes.length ? `<details class="adm-notes"><summary>${imp.notes.length} line${imp.notes.length === 1 ? '' : 's'} not used (commentary or notes)</summary>${imp.notes.map(n => `<p>${esc(n)}</p>`).join('')}</details>` : ''}
      <div class="form confirm-box">
        <label>Week<input type="text" id="imp-week" maxlength="120" value="${esc(imp.weekLabel)}" placeholder="e.g. Week of 6 April 2026"></label>
        <label class="chk"><input type="checkbox" id="imp-email" ${subs ? 'checked' : ''}> Email subscribers a link to the new results (${subs} subscriber${subs === 1 ? '' : 's'}${summary && !summary.mailReady ? ', email not set up yet' : ''})</label>
        <button class="btn gold" type="button" id="imp-confirm" ${open ? 'disabled' : ''}>Confirm and save ${incl.length} results</button>
        <div class="form-note">${open ? `Answer the ${open} name question${open === 1 ? '' : 's'} above first.` : 'Saving twice is safe: results already on file are not added again.'}</div>
        <div class="form-done" id="imp-msg" role="status"></div>
      </div></div>`;
  }

  // One set of listeners on the preview box handles every control inside it.
  const box = $('adm-preview');
  box.addEventListener('change', e => {
    const t = e.target;
    if (!imp) return;
    if (t.id === 'imp-only') { imp.onlyProblems = t.checked; renderImport(); return; }
    if (t.id === 'imp-week') { imp.weekLabel = t.value; return; }
    if (t.dataset.unv !== undefined) { imp.rows[t.dataset.unv].verified = !t.checked; return; }
    if (t.dataset.skip !== undefined) { imp.rows[t.dataset.skip].skip = t.checked; renderImport(); recheckSoon(); return; }
    if (t.type === 'radio') { imp.decisions[t.name] = t.value === 'new' ? 'new' : t.value; renderImport(); return; }
    if (t.dataset.f) {
      const r = imp.rows[t.dataset.i];
      r[t.dataset.f] = t.type === 'checkbox' ? t.checked : t.value;
      r.edited = true;
      recheckSoon();
    }
  });
  box.addEventListener('input', e => { if (e.target.id === 'imp-week' && imp) imp.weekLabel = e.target.value; });
  box.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !imp) return;
    if (b.dataset.edit !== undefined) { const i = Number(b.dataset.edit); imp.editing = imp.editing === i ? null : i; renderImport(); }
    if (b.dataset.done !== undefined) {
      const r = imp.rows[b.dataset.done];
      if (r.edited) {
        revalidate(r);
        if (!r.warnings.includes('Edited by hand')) r.warnings = r.warnings.concat('Edited by hand');
      }
      imp.editing = null; renderImport();
    }
    if (b.id === 'imp-confirm') confirmImport();
  });

  // After a fix, drop the problems that are now solved. Charlie still decides the Unverified tick.
  function revalidate(r) {
    const solved = {
      'Horse name not found': !!r.horse_name, 'Year or sex not found': !!(r.foaled && r.sex), 'Sex not found': !!r.sex,
      'Sire not found': !!r.sire, 'Dam not found': !!r.dam, 'Breeding not found': !!(r.sire || r.dam),
      '"out of" appears twice': !/\bout of\b/i.test(r.dam || ''), 'No event heading above it': !!r.event_name,
      'No class heading above it': !!r.class_name, 'No country for the event': !!r.country
    };
    r.issues = r.issues.filter(x => (x.startsWith('Could not tell') ? !r.breeder : !solved[x]));
    const warnSolved = { 'No breeder given': !!r.breeder, 'No dam sire given': !!r.dam_sire, 'No scores given': r.score !== null && r.score !== '', 'Sire unknown': !!r.sire };
    r.warnings = r.warnings.filter(x => !warnSolved[x]);
  }

  async function confirmImport() {
    const btn = $('imp-confirm');
    btn.disabled = true;
    btnMsg($('imp-msg'), 'Saving…');
    try {
      const res = await fetch('/api/admin/import', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rows: imp.rows, decisions: imp.decisions, weekLabel: $('imp-week').value, notify: $('imp-email').checked }) });
      const d = await res.json().catch(() => ({}));
      if (res.status === 409) { imp.questions = d.needsDecision; renderImport(); btnMsg($('imp-msg'), 'Some names changed. Answer the questions above, then confirm again.'); return; }
      if (!res.ok) throw new Error(d.error || `Could not save (${res.status})`);
      imp.summary = d;
      renderImport();
      loadBatches(); refreshSummary();
    } catch (err) {
      btn.disabled = false;
      btnMsg($('imp-msg'), err.message);
    }
  }

  async function loadBatches() {
    const d = await api('/api/admin/batches');
    $('adm-batches').innerHTML = d.batches.length ? d.batches.map(b => `<div class="adm-card"><b>${esc(b.label || 'Upload')}</b>
      <div class="meta">${esc(niceDate(b.created_at))} · ${b.row_count} results · ${b.unverified_count} unverified</div>
      <div class="adm-actions"><button class="btn sm alt" data-del-batch="${b.id}" data-name="${esc(b.label)}">Remove this upload</button></div></div>`).join('')
      : '<div class="empty-state">Nothing uploaded yet.</div>';
  }
  $('adm-batches').addEventListener('click', async e => {
    const b = e.target.closest('[data-del-batch]');
    if (!b || !confirm(`Remove "${b.dataset.name}" and all its results from the site?`)) return;
    await api(`/api/admin/batches?id=${b.dataset.delBatch}`, { method: 'DELETE' });
    loadBatches(); refreshSummary();
  });

  /* ---------- Unverified ---------- */
  const FIELDS = [['position', 'Pos'], ['horse_name', 'Horse'], ['former_name', 'Former name(s)'], ['breed', 'Breed'], ['foaled', 'Foaled'], ['sex', 'Sex'],
    ['sire', 'Sire'], ['dam', 'Dam'], ['dam_sire', 'Dam sire'], ['breeder', 'Breeder'], ['dressage', 'Dressage'], ['show_jumping', 'Show jumping'], ['cross_country', 'Cross country'], ['score', 'Final score']];

  async function loadUnverified() {
    const d = await api('/api/admin/unverified');
    $('unv-list').innerHTML = d.rows.length ? d.rows.map(r => `<form class="adm-card" data-id="${r.id}">
      <b>${esc(r.horse_name || '?')}</b> <span class="meta">${esc(r.country)} · ${esc(r.event_name)} · ${esc(r.class_name)}</span>
      <div class="adm-row-edit">${FIELDS.map(([k, l]) => `<label>${l}<input name="${k}" value="${esc(r[k] ?? '')}"></label>`).join('')}</div>
      <div class="adm-actions">
        <button class="btn sm" data-act="verify">Save and mark as verified</button>
        <button class="btn sm alt" data-act="save">Save, keep unverified</button>
        <button class="btn sm alt" data-act="remove">Delete</button>
      </div></form>`).join('') : '<div class="empty-state">No unverified results.</div>';
  }
  $('unv-list').addEventListener('click', async e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    e.preventDefault();
    const form = b.closest('form'), id = Number(form.dataset.id);
    if (b.dataset.act === 'remove' && !confirm('Delete this result from the site?')) return;
    const body = b.dataset.act === 'remove' ? { id, remove: true } : { id, fields: Object.fromEntries(new FormData(form)), verify: b.dataset.act === 'verify' };
    b.disabled = true;
    try { await api('/api/admin/unverified', { method: 'POST', body }); loadUnverified(); refreshSummary(); }
    catch (err) { alert(err.message); b.disabled = false; }
  });

  /* ---------- Images: shrink before upload ---------- */
  function shrinkImage(file, maxW) {
    return new Promise(resolve => {
      if (!file || !file.size) return resolve(null);
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return resolve(file);
      const img = new Image();
      img.onload = () => {
        const sc = Math.min(1, maxW / img.width);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(b => resolve(b ? new File([b], 'image.jpg', { type: 'image/jpeg' }) : file), 'image/jpeg', 0.85);
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => resolve(file);
      img.src = URL.createObjectURL(file);
    });
  }

  async function submitWithImage(e, url, maxW, after) {
    e.preventDefault();
    const formEl = e.target, done = formEl.querySelector('.form-done'), btn = formEl.querySelector('button[type=submit]');
    const form = new FormData(formEl);
    const img = await shrinkImage(form.get('image'), maxW);
    form.delete('image');
    if (img) form.append('image', img);
    btn.disabled = true; done.textContent = 'Saving…';
    try { await api(url, { method: 'POST', form }); formEl.reset(); done.textContent = after; }
    catch (err) { done.textContent = err.message; }
    finally { btn.disabled = false; }
  }

  /* ---------- News ---------- */
  $('news-form').addEventListener('submit', e => submitWithImage(e, '/api/admin/news', 1400,
    'Published. It is now the home page headline and the top of the News page.').then(loadNews));
  async function loadNews() {
    const d = await api('/api/admin/news');
    $('news-list').innerHTML = d.news.length ? d.news.map(n => `<div class="adm-card">
      ${n.image_key ? `<img class="adm-thumb" src="/media/${esc(n.image_key)}" alt="">` : ''}<b>${esc(n.title)}</b>
      <div class="meta">${esc(niceDate(n.published_at))}</div>
      <div class="adm-actions"><button class="btn sm alt" data-del-news="${n.id}">Delete</button></div></div>`).join('') : '<div class="empty-state">No news yet.</div>';
  }
  $('news-list').addEventListener('click', async e => {
    const b = e.target.closest('[data-del-news]');
    if (!b || !confirm('Delete this news post?')) return;
    await api(`/api/admin/news?id=${b.dataset.delNews}`, { method: 'DELETE' });
    loadNews();
  });

  /* ---------- Ads ---------- */
  $('ad-form').addEventListener('submit', e => submitWithImage(e, '/api/admin/ads', 1940, 'Advert added. It is live on the site now.').then(loadAds));
  async function loadAds() {
    const d = await api('/api/admin/ads');
    const today = new Date().toISOString().slice(0, 10);
    $('ad-list').innerHTML = d.ads.length ? d.ads.map(a => `<div class="adm-card">
      ${a.image_key ? `<img class="adm-thumb" src="/media/${esc(a.image_key)}" alt="">` : ''}<b>${esc(a.name)}</b>
      <div class="meta">${a.tier === 'large' ? 'Banner (top and bottom)' : 'Side box'}${a.ends_on ? ` · until ${esc(niceDate(a.ends_on))}` : ''}${a.ends_on && a.ends_on < today ? ' · <b class="iss">ended, no longer showing</b>' : ''}${a.link ? ` · ${esc(a.link)}` : ''}</div>
      <div class="adm-actions"><button class="btn sm alt" data-del-ad="${a.id}">Remove</button></div></div>`).join('')
      : '<div class="empty-state">No ads yet. Placeholders show until one is added.</div>';
  }
  $('ad-list').addEventListener('click', async e => {
    const b = e.target.closest('[data-del-ad]');
    if (!b || !confirm('Remove this advert?')) return;
    await api(`/api/admin/ads?id=${b.dataset.delAd}`, { method: 'DELETE' });
    loadAds();
  });

  /* ---------- Comments ---------- */
  async function loadComments() {
    const d = await api('/api/admin/comments');
    const pending = d.comments.filter(c => c.status === 'pending'), approved = d.comments.filter(c => c.status === 'approved');
    const item = c => `<div class="adm-card"><b>${esc(c.name)}</b> <span class="meta">${esc(niceDate(c.created_at))} · on ${c.scope === 'news' ? 'News' : 'Results'}</span>
      <p style="margin:6px 0;">${esc(c.body)}</p><div class="adm-actions">
      ${c.status === 'pending' ? `<button class="btn sm" data-cm="approve" data-id="${c.id}">Approve</button>` : ''}
      <button class="btn sm alt" data-cm="delete" data-id="${c.id}">Delete</button></div></div>`;
    $('cm-list').innerHTML = `<div class="cm-queue"><b>Waiting for approval (${pending.length})</b>${pending.map(item).join('') || '<p>No comments waiting.</p>'}</div>
      ${approved.length ? `<details class="adm-notes"><summary>Approved comments (${approved.length})</summary>${approved.map(item).join('')}</details>` : ''}`;
  }
  $('cm-list').addEventListener('click', async e => {
    const b = e.target.closest('[data-cm]');
    if (!b) return;
    if (b.dataset.cm === 'delete' && !confirm('Delete this comment?')) return;
    await api('/api/admin/comments', { method: 'POST', body: { id: Number(b.dataset.id), action: b.dataset.cm } });
    loadComments(); refreshSummary();
  });

  /* ---------- Corrections ---------- */
  async function loadCorrections() {
    const d = await api('/api/admin/corrections');
    $('corr-list').innerHTML = d.corrections.length ? d.corrections.map(c => `<div class="adm-card">
      <b>${esc(c.event_text)}</b> <span class="meta">${esc(niceDate(c.created_at))}${c.status === 'done' ? ' · done' : ''}</span>
      <p style="margin:6px 0;white-space:pre-wrap;">${esc(c.message)}</p>
      ${c.email ? `<div class="meta">Reply to: <a href="mailto:${esc(c.email)}">${esc(c.email)}</a></div>` : ''}
      <div class="adm-actions">${c.status === 'open' ? `<button class="btn sm" data-corr="done" data-id="${c.id}">Done</button>` : ''}
      <button class="btn sm alt" data-corr="delete" data-id="${c.id}">Delete</button></div></div>`).join('')
      : '<div class="empty-state">No corrections sent in.</div>';
  }
  $('corr-list').addEventListener('click', async e => {
    const b = e.target.closest('[data-corr]');
    if (!b) return;
    if (b.dataset.corr === 'delete' && !confirm('Delete this correction?')) return;
    await api('/api/admin/corrections', { method: 'POST', body: { id: Number(b.dataset.id), action: b.dataset.corr } });
    loadCorrections(); refreshSummary();
  });

  /* ---------- Advertising enquiries ---------- */
  const INTEREST = { banner: 'Banner', box: 'Side box', unsure: 'Not sure yet' };
  async function loadEnquiries() {
    const d = await api('/api/admin/enquiries');
    $('enq-list').innerHTML = d.enquiries.length ? d.enquiries.map(q => `<div class="adm-card">
      <b>${esc(q.business || q.name)}</b> <span class="meta">${esc(niceDate(q.created_at))} · ${esc(INTEREST[q.interest] || q.interest)}${q.status === 'done' ? ' · done' : ''}</span>
      <div class="meta">${esc(q.name)} · <a href="mailto:${esc(q.email)}">${esc(q.email)}</a>${q.phone ? ` · <a href="tel:${esc(q.phone)}">${esc(q.phone)}</a>` : ''}</div>
      ${q.message ? `<p style="margin:6px 0;white-space:pre-wrap;">${esc(q.message)}</p>` : ''}
      <div class="adm-actions">${q.status === 'open' ? `<button class="btn sm" data-enq="done" data-id="${q.id}">Done</button>` : ''}
      <button class="btn sm alt" data-enq="delete" data-id="${q.id}">Delete</button></div></div>`).join('')
      : '<div class="empty-state">No advertising enquiries yet.</div>';
  }
  $('enq-list').addEventListener('click', async e => {
    const b = e.target.closest('[data-enq]');
    if (!b) return;
    if (b.dataset.enq === 'delete' && !confirm('Delete this enquiry?')) return;
    await api('/api/admin/enquiries', { method: 'POST', body: { id: Number(b.dataset.id), action: b.dataset.enq } });
    loadEnquiries(); refreshSummary();
  });

  refreshSummary().then(loadBatches);
})();
