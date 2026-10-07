/* Owner area. Every action works on a phone. */
(function () {
  const { esc, api, ordinal, niceDate, scoreText } = window.IBE;
  const $ = id => document.getElementById(id);

  /* ---------- Tabs ---------- */
  const loaders = { results: loadBatches, unverified: loadUnverified, news: () => loadNews(), ads: () => { loadAds(); loadLinks(); }, stallions: loadStallions, breeding: () => loadBreeding(), comments: loadComments, corrections: loadCorrections, enquiries: loadEnquiries };
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

  // The owner API answers "Not found" once the login has run out (it never says why to strangers).
  function showLoginError(e) {
    const msg = e.message === 'Not found'
      ? 'Your login has run out. <a href="/signin">Log in again</a>, then reload this page.'
      : esc(e.message);
    document.querySelector('main').insertAdjacentHTML('afterbegin', `<div class="notice">${msg}</div>`);
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
      const evLink = e => `/results?${new URLSearchParams({ season: e.season, month: e.start_date.slice(5, 7), event: e.id })}`;
      box.innerHTML = `<div class="summary-box">
        <h4>${s.added || s.failed ? 'Saved' : 'Nothing new in'} ${esc(imp.weekLabel || 'this upload')}</h4>
        <p class="upload-result"><b>${s.rows}</b> rows read: <b class="n-new">${s.added} new</b> · <b class="n-dup">${s.duplicates} duplicate${s.duplicates === 1 ? '' : 's'} skipped</b> · <b class="n-fail">${s.failed} failed</b></p>
        <p class="meta">New: added and on the site now. Duplicates: the same horse in the same class of the same event is already on the site, so it was left as it was. Failed: saved, but a line couldn't be read properly or looks wrong, so it is hidden from the site until you fix it in the Unverified tab.</p>
        ${s.events && s.events.length ? `<table class="upload-events"><thead><tr><th>Event</th><th>Date</th><th>In this upload</th><th>New</th><th>Duplicates</th><th>Failed</th><th>On the site now</th></tr></thead><tbody>
          ${s.events.map(e => `<tr><td>${esc(e.name)} <small>${esc(e.country)}</small></td><td>${esc(niceDate(e.start_date))}</td><td>${e.rows}</td><td>${e.new}</td><td>${e.duplicates}</td><td>${e.failed}</td>
            <td><a href="${evLink(e)}" target="_blank" rel="noopener">${e.onSite} results ↗</a></td></tr>`).join('')}</tbody></table>` : ''}
        <div class="summary-grid">
          <div><b>${s.horses}</b><span>new horses</span></div>
          <div><b>${s.sires}</b><span>new sires</span></div><div><b>${s.dams}</b><span>new dams</span></div><div><b>${s.breeders}</b><span>new breeders</span></div>
        </div>
        ${s.emailed ? `<p class="intro">Emailing ${s.emailed} subscribers now.</p>` : ''}
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

  // Published uploads: a table grouped by season and month of the events in each upload, newest first.
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const shortDate = iso => { const d = new Date(`${iso}T00:00:00Z`); return `${d.getUTCDate()} ${MONTHS_LONG[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`; };
  const dateRange = (a, z) => !a ? '–' : a === z || !z ? shortDate(a) : a.slice(0, 7) === z.slice(0, 7)
    ? `${Number(a.slice(8))}–${shortDate(z)}` : `${shortDate(a).replace(/ \d{4}$/, a.slice(0, 4) === z.slice(0, 4) ? '' : ` ${a.slice(0, 4)}`)} – ${shortDate(z)}`;
  async function loadBatches() {
    const d = await api('/api/admin/batches');
    if (!d.batches.length) { $('adm-batches').innerHTML = '<div class="empty-state">Nothing uploaded yet.</div>'; return; }
    let html = '', season = null, month = null;
    for (const b of d.batches) {
      const s = b.season || 'No events', m = b.week_date ? b.week_date.slice(0, 7) : '';
      if (s !== season) { if (season !== null) html += '</tbody></table>'; html += `<h4 class="batch-season">${esc(s)} season</h4><table class="batch-table"><thead><tr><th>Event dates</th><th>Upload (week)</th><th class="num">Results</th><th>Status</th><th></th></tr></thead><tbody>`; season = s; month = null; }
      if (m !== month) { html += `<tr class="batch-month"><td colspan="5">${m ? `${MONTHS_LONG[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}` : 'Empty uploads'}</td></tr>`; month = m; }
      const names = (b.event_names || '').split(',').filter(Boolean);
      const status = !b.published ? '<span class="st st-off">Unpublished</span>'
        : b.held ? `<span class="st st-live">Live</span> <span class="st st-held">${b.held} hidden until verified</span>` : '<span class="st st-live">Live</span>';
      html += `<tr data-batch="${b.id}" class="${b.published ? '' : 'off'}">
        <td>${esc(dateRange(b.first_date, b.last_date))}</td>
        <td><b>${esc(b.label || 'Upload')}</b><small>${b.events} event${b.events === 1 ? '' : 's'}${names.length ? `: ${esc(names.slice(0, 3).join(', '))}${names.length > 3 ? ` and ${names.length - 3} more` : ''}` : ''} · uploaded ${esc(niceDate(b.created_at))}</small></td>
        <td class="num">${b.results}</td>
        <td>${status}</td>
        <td class="acts"><button class="btn sm" data-edit-batch="${b.id}">Edit</button>
          <button class="btn sm alt" data-pub-batch="${b.id}" data-pub="${b.published ? 0 : 1}">${b.published ? 'Unpublish' : 'Re-publish'}</button>
          <button class="btn sm alt danger" data-del-batch="${b.id}" data-name="${esc(b.label)}">Delete</button></td></tr>
        <tr class="batch-edit-row" hidden><td colspan="5"><div class="batch-edit"></div></td></tr>`;
    }
    $('adm-batches').innerHTML = html + '</tbody></table>';
  }
  async function openBatch(row) {
    const editRow = row.nextElementSibling, box = editRow.querySelector('.batch-edit');
    if (!editRow.hidden) { editRow.hidden = true; box.innerHTML = ''; return; }
    editRow.hidden = false;
    box.innerHTML = '<div class="empty-state">Loading…</div>';
    const id = Number(row.dataset.batch), label = row.querySelector('b').textContent;
    const d = await api(`/api/admin/batches?id=${id}`);
    box.innerHTML = `<form class="form batch-label" data-id="${id}"><label>Upload name<input name="label" value="${esc(label)}" maxlength="120"></label>
        <div class="adm-actions"><button class="btn sm" type="submit">Save name</button></div></form>
      <p class="meta">${d.rows.length} results. Correct any field and press Save; Delete takes one result off the site.</p>
      <div class="unv-list">${d.rows.map(rowEditCard).join('')}</div>`;
  }
  $('adm-batches').addEventListener('click', async e => {
    const del = e.target.closest('[data-del-batch]'), edit = e.target.closest('[data-edit-batch]'), pub = e.target.closest('[data-pub-batch]');
    if (edit) return openBatch(edit.closest('[data-batch]'));
    if (pub) {
      const on = pub.dataset.pub === '1';
      if (!on && !confirm('Take this upload off the public site? Its results are kept and you can re-publish it any time.')) return;
      await api('/api/admin/batches', { method: 'POST', body: { id: Number(pub.dataset.pubBatch), published: on } });
      return loadBatches();
    }
    if (!del || !confirm(`Delete "${del.dataset.name}" and all its results? This can't be undone (Unpublish hides it instead).`)) return;
    await api(`/api/admin/batches?id=${del.dataset.delBatch}`, { method: 'DELETE' });
    loadBatches(); refreshSummary();
  });
  $('adm-batches').addEventListener('submit', async e => {
    const f = e.target.closest('form.batch-label');
    if (!f) return;
    e.preventDefault();
    try { await api('/api/admin/batches', { method: 'POST', body: { id: Number(f.dataset.id), label: f.elements.label.value } }); f.closest('.batch-edit-row').previousElementSibling.querySelector('b').textContent = f.elements.label.value; }
    catch (err) { alert(err.message); }
  });

  /* ---------- Unverified ---------- */
  const FIELDS = [['position', 'Pos'], ['horse_name', 'Horse'], ['former_name', 'Former name(s)'], ['breed', 'Breed'], ['foaled', 'Foaled'], ['sex', 'Sex'],
    ['sire', 'Sire'], ['dam', 'Dam'], ['dam_sire', 'Dam sire'], ['breeder', 'Breeder'], ['dressage', 'Dressage'], ['show_jumping', 'Show jumping'], ['cross_country', 'Cross country'], ['score', 'Final score']];

  // One result as an editable card: in the Unverified tab, and under an upload opened with Edit.
  function rowEditCard(r) {
    return `<form class="adm-card" data-id="${r.id}" data-verified="${r.verified ? 1 : 0}">
      <b>${esc(r.horse_name || '?')}</b>${r.doubtful ? ' <span class="iss">Unverified: hidden from the site until verified</span>' : r.oio ? ' <span class="gap-tag">OIO on the site</span>' : ''} <span class="meta">${esc(r.country)} · ${esc(r.event_name)} · ${esc(r.class_name)}</span>
      ${r.raw_line ? `<p class="meta">${r.parse_ok ? 'As written' : 'Could not be read cleanly. As written'}: ${esc(r.raw_line)}</p>` : ''}
      <div class="adm-row-edit">${FIELDS.map(([k, l]) => `<label>${l}<input name="${k}" value="${esc(r[k] ?? '')}"></label>`).join('')}</div>
      <div class="adm-actions">${r.verified
        ? '<button class="btn sm" data-act="save-verified">Save</button>'
        : '<button class="btn sm" data-act="verify">Save and mark as verified</button><button class="btn sm alt" data-act="save">Save, keep unverified</button>'}
        <button class="btn sm alt" data-act="remove">Delete</button><span class="form-done" role="status"></span>
      </div></form>`;
  }
  async function loadUnverified() {
    const d = await api('/api/admin/unverified');
    $('unv-list').innerHTML = d.rows.length ? d.rows.map(rowEditCard).join('') : '<div class="empty-state">Nothing to check. Every result is on the site.</div>';
  }
  async function rowAction(e) {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    e.preventDefault();
    const form = b.closest('form'), id = Number(form.dataset.id), inUnverified = !!b.closest('#unv-list');
    if (b.dataset.act === 'remove' && !confirm('Delete this result from the site?')) return;
    const body = b.dataset.act === 'remove' ? { id, remove: true }
      : { id, fields: Object.fromEntries(new FormData(form)), verify: b.dataset.act === 'verify' || b.dataset.act === 'save-verified' };
    b.disabled = true;
    try {
      await api('/api/admin/unverified', { method: 'POST', body });
      refreshSummary();
      if (inUnverified) return loadUnverified();
      if (b.dataset.act === 'remove') form.remove();
      else { b.disabled = false; form.querySelector('.form-done').textContent = 'Saved.'; }
    } catch (err) { alert(err.message); b.disabled = false; }
  }
  $('unv-list').addEventListener('click', rowAction);
  $('adm-batches').addEventListener('click', rowAction);

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
        // WebP stays WebP (smaller, same quality); everything else becomes JPEG. If the browser can't make WebP
        // it hands back a PNG, which is named for what it is.
        const want = file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
        c.toBlob(b => resolve(b ? new File([b], b.type === 'image/webp' ? 'image.webp' : b.type === 'image/png' ? 'image.png' : 'image.jpg', { type: b.type }) : file), want, 0.85);
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
    try { await api(url, { method: 'POST', form }); formEl.reset(); done.textContent = after; return true; }
    catch (err) { done.textContent = err.message; return false; }
    finally { btn.disabled = false; }
  }

  /* ---------- News articles and link cards: add, edit, delete, re-order ---------- */
  function contentEditor({ key, url, listKey, form, list, titleEl, noun, addTitle, maxW, describe }) {
    let items = [];
    const f = $(form);
    const setEditing = item => {
      f.reset();
      f.elements.id.value = item ? item.id : '';
      f.querySelectorAll('.edit-only').forEach(el => { el.hidden = !item; });
      $(titleEl).textContent = item ? `Edit ${noun}: ${item.title}` : addTitle;
      f.querySelector('button[type=submit]').textContent = item ? 'Save changes' : (key === 'news' ? 'Publish article' : 'Save link card');
      if (!item) return;
      for (const el of f.elements) {
        if (!el.name || el.type === 'file' || el.type === 'checkbox' || el.name === 'id') continue;
        const v = el.name === 'date' ? String(item.published_at || item.card_date || '').slice(0, 10) : item[el.name];
        if (v !== undefined && v !== null) el.value = v;
      }
      f.scrollIntoView({ behavior: 'smooth' });
    };
    async function load() {
      items = (await api(url))[listKey];
      $(list).innerHTML = items.length ? items.map((it, i) => `<div class="adm-card order-card">
        <div class="order-btns"><button class="btn sm alt" data-move="-1" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
          <button class="btn sm alt" data-move="1" data-i="${i}" ${i === items.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button></div>
        <div>${it.image_key ? `<img class="adm-thumb" src="/media/${esc(it.image_key)}" alt="">` : ''}<b>${esc(it.title)}</b>
          <div class="meta">${describe(it)}</div>
          <div class="adm-actions"><button class="btn sm" data-edit="${i}">Edit</button><button class="btn sm alt" data-del="${i}">Delete</button></div></div></div>`).join('')
        : `<div class="empty-state">No ${noun}s yet.</div>`;
    }
    f.addEventListener('submit', async e => {
      const editing = !!f.elements.id.value;
      if (!(await submitWithImage(e, url, maxW, editing ? 'Saved.' : 'Added. It is on the site now.'))) return;
      setEditing(null);
      load();
    });
    f.querySelector('[data-cancel]').addEventListener('click', () => setEditing(null));
    $(list).addEventListener('click', async e => {
      const b = e.target.closest('button');
      if (!b) return;
      const i = Number(b.dataset.i ?? b.dataset.edit ?? b.dataset.del);
      if (b.dataset.edit !== undefined) setEditing(items[i]);
      if (b.dataset.del !== undefined) {
        if (!confirm(`Delete "${items[i].title}"?`)) return;
        await api(`${url}?id=${items[i].id}`, { method: 'DELETE' });
        load();
      }
      if (b.dataset.move !== undefined) {
        const j = i + Number(b.dataset.move);
        [items[i], items[j]] = [items[j], items[i]];
        await api(url, { method: 'POST', body: { order: items.map(x => x.id) } });
        load();
      }
    });
    return load;
  }
  const loadNews = contentEditor({
    key: 'news', url: '/api/admin/news', listKey: 'news', form: 'news-form', list: 'news-list', titleEl: 'news-form-title',
    noun: 'article', addTitle: 'Add a news article', maxW: 1600,
    describe: n => `${esc(niceDate(n.published_at))}${n.source_name ? ` · ${esc(n.source_name)}` : ''}${n.source_url ? ` · <a href="${esc(n.source_url)}" target="_blank" rel="noopener">original ↗</a>` : ''}`
  });
  const loadLinks = contentEditor({
    key: 'links', url: '/api/admin/links', listKey: 'links', form: 'links-form', list: 'links-list', titleEl: 'links-form-title',
    noun: 'link card', addTitle: 'Add a link card', maxW: 1200,
    describe: l => `${l.card_date ? esc(niceDate(l.card_date)) + ' · ' : ''}${esc(l.source_name || '')} <a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.url)}</a>`
  });

  /* ---------- Ads: sizes, crop, preview, edit, remove ---------- */
  const AD_FOCUS = { center: 'center', top: 'center top', bottom: 'center bottom', left: 'left center', right: 'right center' };
  const adForm = $('ad-form');
  const PIXEL_DENSITY = 2; // recommended images are twice the box size, so they stay sharp on high-resolution screens

  // 1. Box sizes, measured from the live layout: the public home page is loaded out of sight at laptop and
  //    phone width and the real banner and right-hand-column boxes are measured, so the recommendations follow
  //    any change to the site's layout. If measuring fails, the sizes from the stylesheet are used.
  const FALLBACK = { laptop: { banner: [1256, 110], box: [170, 170] }, phone: { banner: [358, 56], box: [112, 112] } };
  function measureAt(width) {
    return new Promise(resolve => {
      const f = document.createElement('iframe');
      f.style.cssText = `position:absolute;left:-10000px;top:0;width:${width}px;height:1000px;border:0;visibility:hidden;`;
      f.setAttribute('aria-hidden', 'true');
      f.tabIndex = -1;
      let finished = false;
      const done = v => { if (finished) return; finished = true; f.remove(); resolve(v); };
      setTimeout(() => done(null), 20000);
      f.onload = () => {
        const d = f.contentDocument;
        const size = el => { const b = el.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; };
        const measure = tries => {
          const banner = d.querySelector('#banner-top .banner'), box = d.querySelector('#side-left .ad-box');
          if ((!banner || !box) && tries < 40) return setTimeout(() => measure(tries + 1), 250);
          done(banner && box ? { banner: size(banner), box: size(box) } : null);
        };
        measure(0);
      };
      f.src = '/?layout-probe';
      document.body.appendChild(f);
    });
  }
  let layout = { ...FALLBACK, measured: false };
  const layoutReady = Promise.all([measureAt(1360), measureAt(390)]).then(([laptop, phone]) => {
    const ok = v => v && v[0] > 0 && v[1] > 0;
    const pick = (m, fb) => ({ banner: ok(m && m.banner) ? m.banner : fb.banner, box: ok(m && m.box) ? m.box : fb.box });
    layout = { laptop: pick(laptop, FALLBACK.laptop), phone: pick(phone, FALLBACK.phone), measured: !!(laptop && phone) };
    renderSizes();
    return layout;
  });
  const recommended = ([w, h]) => [w * PIXEL_DENSITY, h * PIXEL_DENSITY];
  const ratioText = ([w, h]) => { const r = w / h; return r >= 1 ? `${r.toFixed(r >= 10 ? 1 : 2).replace(/\.?0+$/, '')} : 1` : `1 : ${(1 / r).toFixed(2).replace(/\.?0+$/, '')}`; };
  const px = ([w, h]) => `${w} × ${h}`;
  // The shapes the crop tool offers, from the measured boxes.
  function shapes(tier, view = crop.view) {
    const L = layout.laptop, P = layout.phone;
    if (view === 'phone') {
      return tier === 'large'
        ? [['phone-banner', `Phone top banner (${ratioText(P.banner)})`, P.banner], ['free', 'Free shape', null]]
        : [['phone-box', `Phone side box (${ratioText(P.box)})`, P.box], ['free', 'Free shape', null]];
    }
    return tier === 'large'
      ? [['banner', `Top banner (${ratioText(L.banner)})`, L.banner], ['free', 'Free shape', null]]
      : [['box', `Side box (${ratioText(L.box)})`, L.box], ['free', 'Free shape', null]];
  }
  function renderSizes() {
    const L = layout.laptop, P = layout.phone;
    const row = (name, where, lap, ph) => `<tr><th>${name}<small>${where}</small></th><td>${px(lap)} px<small>phone ${px(ph)}</small></td><td><b>${px(recommended(lap))} px</b><small>ratio ${ratioText(lap)}</small></td></tr>`;
    $('ad-sizes').innerHTML = `<table class="ad-size-table"><thead><tr><th>Where it shows</th><th>Box on screen (laptop)</th><th>Recommended image</th></tr></thead><tbody>
      ${row('Top banner', 'pinned to the top of the screen on its page', L.banner, P.banner)}
      ${row('Side boxes', 'Left 1–3 and Right 1–3; on phones, in a block under the page', L.box, P.box)}
      </tbody></table>
      <p class="meta">${layout.measured ? 'Measured from the site as it is now.' : 'Could not measure the site just now, so these are the sizes from the stylesheet.'}
      The recommended size is twice the box so it stays sharp on high-resolution screens. A smaller image still works,
      but you'll see a warning: it will be stretched to fit and may look soft or blurry. A small "Advertisement" label sits in the
      top-left corner of every advert, so keep important words away from that corner.</p>`;
  }

  // 2. Crop tool: the picture moves and zooms under a fixed crop box (or a free-shape box with corner handles).
  // Two crops of the same picture: one for laptops and tablets, one for phones (720px and under), where the
  // banner and boxes are a different shape. The tool edits one at a time; the other is kept in crop.views.
  const crop = { img: null, file: null, origUrl: '', shape: 'box', box: null, scale: 1, base: 1, tx: 0, ty: 0, changed: false,
    view: 'laptop', views: { laptop: null, phone: null } };
  const VIEW_FIELDS = ['shape', 'box', 'scale', 'base', 'tx', 'ty'];
  const snap = () => Object.fromEntries(VIEW_FIELDS.map(k => [k, k === 'box' && crop.box ? { ...crop.box } : crop[k]]));
  const viewState = name => (name === crop.view ? snap() : crop.views[name]);
  const stage = $('crop-stage'), boxEl = $('crop-box'), imgEl = $('crop-img');
  const stageSize = () => [stage.clientWidth, stage.clientHeight];
  const shapeRatio = () => { const s = shapes(adForm.elements.tier.value).find(x => x[0] === crop.shape); return s && s[2] ? s[2][0] / s[2][1] : null; };
  function fitBox(ratio) {
    const [sw, sh] = stageSize(), m = 24, aw = sw - 2 * m, ah = sh - 2 * m;
    let w = aw, h = aw / ratio;
    if (h > ah) { h = ah; w = ah * ratio; }
    return { x: (sw - w) / 2, y: (sh - h) / 2, w, h };
  }
  function clamp() {
    const b = crop.box, W = crop.img.naturalWidth * crop.scale, H = crop.img.naturalHeight * crop.scale;
    crop.tx = Math.min(b.x, Math.max(b.x + b.w - W, crop.tx));
    crop.ty = Math.min(b.y, Math.max(b.y + b.h - H, crop.ty));
  }
  function setBase(keepZoom) {
    const b = crop.box, z = keepZoom ? crop.scale / crop.base : 1;
    crop.base = Math.max(b.w / crop.img.naturalWidth, b.h / crop.img.naturalHeight);
    crop.scale = crop.base * z;
    $('crop-zoom').value = z;
  }
  function drawCrop() {
    if (!crop.img) return;
    clamp();
    const b = crop.box;
    Object.assign(boxEl.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
    boxEl.classList.toggle('free', crop.shape === 'free');
    Object.assign(imgEl.style, { width: `${crop.img.naturalWidth * crop.scale}px`, transform: `translate(${crop.tx}px, ${crop.ty}px)` });
    queuePreview();
  }
  // A crop as fractions of the original image (the one being edited, or the other view's).
  function rectOf(v) {
    const W = crop.img.naturalWidth, H = crop.img.naturalHeight, b = v.box;
    const x = Math.max(0, (b.x - v.tx) / v.scale), y = Math.max(0, (b.y - v.ty) / v.scale);
    return { x: x / W, y: y / H, w: Math.min(W - x, b.w / v.scale) / W, h: Math.min(H - y, b.h / v.scale) / H, shape: v.shape };
  }
  const cropRect = () => rectOf(snap());
  // Both crops from a picture just loaded: saved ones are put back, otherwise each is centred in its own shape.
  function initViews(savedLaptop, savedPhone) {
    for (const [name, saved] of [['phone', savedPhone], ['laptop', savedLaptop]]) {
      crop.view = name;
      fillShapes(saved && saved.shape);
      resetCrop(saved);
      crop.views[name] = snap();
    }
    showViewTabs();
  }
  function switchView(name) {
    if (name === crop.view || !crop.img) return;
    crop.views[crop.view] = snap();
    crop.view = name;
    const v = crop.views[name];
    fillShapes(v && v.shape);
    if (v) { Object.assign(crop, v, { box: { ...v.box } }); $('crop-zoom').value = crop.scale / crop.base; drawCrop(); } else resetCrop();
    showViewTabs();
  }
  function showViewTabs() {
    document.querySelectorAll('[data-crop-view]').forEach(b => b.classList.toggle('active', b.dataset.cropView === crop.view));
    const P = layout.phone, big = adForm.elements.tier.value === 'large';
    $('crop-view-note').textContent = crop.view === 'phone'
      ? `Phones (up to 720px wide) show this crop. The ${big ? 'banner' : 'side box'} there is ${px(big ? P.banner : P.box)}, a different shape from laptops, so frame the picture for it here.`
      : 'Laptops and tablets show this crop. Then open "Phone crop" to frame the picture for phones, where the box is a different shape.';
  }
  document.querySelectorAll('[data-crop-view]').forEach(b => b.addEventListener('click', () => switchView(b.dataset.cropView)));
  function resetCrop(saved) {
    const sw = stageSize()[0];
    if (!crop.img || !sw) return;
    const ratio = shapeRatio();
    if (saved && saved.w > 0) {
      // Put a saved crop back: the box takes the crop's shape and the picture is placed under it.
      const r = ratio || (saved.w * crop.img.naturalWidth) / (saved.h * crop.img.naturalHeight);
      crop.box = fitBox(r);
      crop.base = Math.max(crop.box.w / crop.img.naturalWidth, crop.box.h / crop.img.naturalHeight);
      crop.scale = crop.box.w / (saved.w * crop.img.naturalWidth);
      crop.tx = crop.box.x - saved.x * crop.img.naturalWidth * crop.scale;
      crop.ty = crop.box.y - saved.y * crop.img.naturalHeight * crop.scale;
      $('crop-zoom').value = crop.scale / crop.base;
    } else {
      crop.box = fitBox(ratio || crop.img.naturalWidth / crop.img.naturalHeight);
      setBase(false);
      crop.tx = crop.box.x + (crop.box.w - crop.img.naturalWidth * crop.scale) / 2;
      crop.ty = crop.box.y + (crop.box.h - crop.img.naturalHeight * crop.scale) / 2;
    }
    drawCrop();
  }
  function zoomTo(z, cx, cy) {
    if (!crop.img) return;
    z = Math.min(6, Math.max(1, z));
    const b = crop.box, ox = cx ?? b.x + b.w / 2, oy = cy ?? b.y + b.h / 2;
    const k = (crop.base * z) / crop.scale;
    crop.tx = ox - (ox - crop.tx) * k;
    crop.ty = oy - (oy - crop.ty) * k;
    crop.scale = crop.base * z;
    $('crop-zoom').value = z;
    crop.changed = true;
    drawCrop();
  }
  $('crop-zoom').addEventListener('input', e => zoomTo(Number(e.target.value)));
  $('crop-in').addEventListener('click', () => zoomTo(crop.scale / crop.base * 1.15));
  $('crop-out').addEventListener('click', () => zoomTo(crop.scale / crop.base / 1.15));
  $('crop-reset').addEventListener('click', () => { crop.changed = true; resetCrop(); });
  stage.addEventListener('wheel', e => {
    if (!crop.img) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    zoomTo(crop.scale / crop.base * (e.deltaY < 0 ? 1.08 : 1 / 1.08), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  // Drag the picture to move it; drag a corner of a free-shape box to resize it.
  stage.addEventListener('pointerdown', e => {
    if (!crop.img) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    const handle = e.target.closest('.crop-handle');
    const start = { x: e.clientX, y: e.clientY, tx: crop.tx, ty: crop.ty, box: { ...crop.box } };
    const move = ev => {
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      if (handle && crop.shape === 'free') {
        const [sw, sh] = stageSize(), b = { ...start.box }, min = 30, h = handle.dataset.h;
        if (h.includes('w')) { const nx = Math.min(b.x + b.w - min, Math.max(0, b.x + dx)); b.w += b.x - nx; b.x = nx; }
        if (h.includes('e')) b.w = Math.min(sw - b.x, Math.max(min, b.w + dx));
        if (h.includes('n')) { const ny = Math.min(b.y + b.h - min, Math.max(0, b.y + dy)); b.h += b.y - ny; b.y = ny; }
        if (h.includes('s')) b.h = Math.min(sh - b.y, Math.max(min, b.h + dy));
        crop.box = b;
        setBase(true);
      } else {
        crop.tx = start.tx + dx;
        crop.ty = start.ty + dy;
      }
      crop.changed = true;
      drawCrop();
    };
    const up = () => { stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerup', up); stage.removeEventListener('pointercancel', up); };
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
  });
  $('crop-shape').addEventListener('change', e => { crop.shape = e.target.value; crop.changed = true; resetCrop(); });
  function fillShapes(selected) {
    const list = shapes(adForm.elements.tier.value);
    if (!list.some(x => x[0] === selected)) selected = list[0][0];
    $('crop-shape').innerHTML = list.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
    $('crop-shape').value = selected;
    crop.shape = selected;
  }
  window.addEventListener('resize', () => { if (crop.img && crop.box && !$('ad-cropper').hidden) resetCrop(cropRect()); });

  // The picture as it will be saved: the cropped part ("Crop to fill") or the whole image ("Show the whole image"),
  // never enlarged, at most maxW wide.
  function render(maxW, view = crop.view) {
    const W = crop.img.naturalWidth, H = crop.img.naturalHeight;
    const r = adForm.elements.fit.value === 'contain' ? { x: 0, y: 0, w: 1, h: 1 } : rectOf(viewState(view));
    const sw = r.w * W, sh = r.h * H, k = Math.min(1, maxW / sw);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
    c.getContext('2d').drawImage(crop.img, r.x * W, r.y * H, sw, sh, 0, 0, c.width, c.height);
    return { canvas: c, w: Math.round(sw), h: Math.round(sh) };
  }
  const outputType = () => (crop.file && /png|gif|webp/.test(crop.file.type)) || /\.png$/i.test(crop.origUrl) ? 'image/png' : 'image/jpeg';
  const toBlob = (canvas, type) => new Promise(res => canvas.toBlob(b => res(b), type, 0.9));

  // 3. Warning when the picture (or the cropped part) is smaller than recommended for where it shows.
  function sizeWarning(sizes) {
    const tier = adForm.elements.tier.value, L = layout.laptop, P = layout.phone;
    const contain = adForm.elements.fit.value === 'contain';
    const lines = [];
    for (const [view, [w, h]] of sizes) {
      const target = view === 'phone' ? (tier === 'large' ? ['phone top banner', P.banner] : ['phone side box', P.box])
        : tier === 'large' ? ['top banner', L.banner] : ['side box', L.box];
      const [rw, rh] = recommended(target[1]);
      // With the whole image shown, it only has to be big enough in the direction that touches the box edges.
      const short = contain ? (w / h > rw / rh ? w < rw : h < rh) : (w < rw || h < rh);
      if (short) lines.push(`${contain ? 'This image' : view === 'phone' ? 'The phone crop' : 'The laptop crop'} is ${w} × ${h} pixels; the recommended size for a ${target[0]} is ${rw} × ${rh}.`);
    }
    const el = $('ad-warning');
    el.hidden = !lines.length;
    if (lines.length) el.textContent = `Smaller than recommended: ${lines.join(' ')} It can still be saved, but it will be stretched to fit the box and may look soft or blurry, `
      + `especially on high-resolution screens. ${contain ? 'Use a larger image if you have one.' : 'Zoom out, use a bigger crop box, or upload a larger image.'}`;
  }

  // 4. Live preview in the site's own boxes, at their real (measured) proportions.
  let previewQueued = false;
  function queuePreview() { if (!previewQueued) { previewQueued = true; requestAnimationFrame(() => { previewQueued = false; adPreview(); }); } }
  function adPreview() {
    const f = adForm.elements, name = f.name.value.trim(), contain = f.fit.value === 'contain';
    $('ad-cropper').hidden = !crop.img || contain;
    adForm.querySelector('.bg-only').hidden = !contain;
    if (!crop.img && !name) { $('ad-preview').hidden = true; $('ad-warning').hidden = true; return; }
    const src = { laptop: '', phone: '' };
    if (crop.img) {
      const sizes = [];
      for (const view of contain ? ['laptop'] : ['laptop', 'phone']) {
        if (!contain && !(viewState(view) || {}).box) continue;
        const out = render(900, view);
        src[view] = out.canvas.toDataURL('image/jpeg', 0.85);
        sizes.push([view, [out.w, out.h]]);
      }
      if (contain) src.phone = src.laptop;
      sizeWarning(sizes);
    }
    const style = `width:100%;height:100%;display:block;object-fit:${contain ? `contain;background:${f.bg.value}` : 'cover'}`;
    const inner = (cls, view) => src[view] ? `<img src="${src[view]}" alt="" style="${style}">` : `<span class="${cls}">${esc(name)}</span>`;
    const L = layout.laptop, P = layout.phone;
    const label = '<span class="ad-label">Advertisement</span>';
    const box = (size, text, view) => `<figure><div class="ad-box" style="aspect-ratio:auto;max-height:none;width:${size[0]}px;height:${size[1]}px;">${label}<span class="ad-body">${inner('ad-name', view)}</span></div><figcaption>${text}</figcaption></figure>`;
    const where = esc(slotName(f.placement.value));
    $('ad-preview-boxes').innerHTML = f.tier.value === 'large'
      ? `<div class="banner" style="height:auto;aspect-ratio:${L.banner[0]}/${L.banner[1]};">${label}${inner('banner-name', 'laptop')}</div><p class="meta">${where} on a laptop or tablet (${px(L.banner)}), from the laptop crop</p>
         <div class="banner" style="height:${P.banner[1]}px;width:${P.banner[0]}px;max-width:100%;">${label}${inner('banner-name', 'phone')}</div><p class="meta">${where} on a phone (${px(P.banner)}), from the phone crop</p>`
      : `<div class="ad-preview-row">${box(L.box, `${where} on a laptop (${px(L.box)})`, 'laptop')}${box(P.box, `${where} on a phone (${px(P.box)}), from the phone crop`, 'phone')}</div>`;
    $('ad-preview').hidden = false;
  }

  // Loading a picture into the crop tool: a new file, or the saved original when editing.
  function loadPicture(url, saved, savedPhone) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        crop.img = img;
        imgEl.src = url;
        $('ad-cropper').hidden = adForm.elements.fit.value === 'contain';
        requestAnimationFrame(() => { initViews(saved, savedPhone); adPreview(); resolve(true); });
      };
      img.onerror = () => { crop.img = null; resolve(false); };
      img.src = url;
    });
  }
  adForm.elements.image.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    crop.file = file; crop.changed = true;
    if (crop.objectUrl) URL.revokeObjectURL(crop.objectUrl);
    crop.objectUrl = URL.createObjectURL(file);
    await loadPicture(crop.objectUrl);
  });
  // Choosing a slot: a top banner and a side box are different shapes, so changing between them starts the crop again.
  adForm.elements.every_page.addEventListener('change', () => setPlacement(adForm.elements.every_page.checked ? `all:${String(adForm.elements.placement.value).split(':')[1] || 'top'}` : adForm.elements.placement.value));
  adForm.elements.placement.addEventListener('change', () => {
    const before = adForm.elements.tier.value;
    setPlacement(adForm.elements.placement.value);
    if (adForm.elements.tier.value !== before) { if (crop.img) { crop.changed = true; initViews(null, null); } else fillShapes(); }
    adPreview();
  });
  ['input', 'change'].forEach(ev => adForm.addEventListener(ev, e => { if (e.target.name !== 'image' && e.target.name !== 'placement' && e.target.id !== 'crop-zoom') queuePreview(); }));
  // Back to "Crop to fill": crops made while the tool was hidden are set up now it can be measured.
  const savedRect = name => { const v = viewState(name); return v && v.box ? rectOf(v) : null; };
  adForm.elements.fit.addEventListener('change', () => {
    crop.changed = true;
    if (crop.img) requestAnimationFrame(() => { $('ad-cropper').hidden = adForm.elements.fit.value === 'contain'; initViews(savedRect('laptop'), savedRect('phone')); adPreview(); });
  });

  // 5. Add and edit.
  let ads = [], editingAd = null;
  function setEditingAd(ad) {
    editingAd = ad;
    adForm.reset();
    if (ad) adForm.querySelector('.form-done').textContent = '';
    Object.assign(crop, { img: null, file: null, origUrl: '', changed: false, view: 'laptop', views: { laptop: null, phone: null } });
    adForm.elements.id.value = ad ? ad.id : '';
    adForm.querySelectorAll('.edit-only').forEach(el => { el.hidden = !ad; });
    $('ad-form-title').textContent = ad ? `Edit advert: ${ad.name}` : 'Add an advert';
    adForm.querySelector('button[type=submit]').textContent = ad ? 'Save changes' : 'Add advert';
    $('ad-cropper').hidden = true;
    let saved = null, savedPhone = null;
    setPlacement(ad ? ad.placement || '' : nextPlacement);
    nextPlacement = '';
    if (ad) {
      for (const k of ['name', 'link', 'starts_on', 'ends_on', 'fit', 'bg']) adForm.elements[k].value = ad[k] ?? '';
      if (!/^#[0-9a-f]{6}$/i.test(adForm.elements.bg.value)) adForm.elements.bg.value = '#ffffff';
      try { saved = ad.crop ? JSON.parse(ad.crop) : null; } catch { saved = null; }
      try { savedPhone = ad.phone_crop ? JSON.parse(ad.phone_crop) : null; } catch { savedPhone = null; }
      adForm.scrollIntoView({ behavior: 'smooth' });
    }
    fillShapes(saved && saved.shape);
    const key = ad && (ad.orig_key || ad.image_key);
    if (key) {
      crop.origUrl = `/media/${key}`;
      // If the original can't be loaded, start again from the picture as it shows now.
      loadPicture(crop.origUrl, saved, savedPhone).then(ok => {
        if (ok || key === ad.image_key || !ad.image_key) return adPreview();
        crop.origUrl = `/media/${ad.image_key}`;
        editingAd = { ...ad, orig_key: null };
        loadPicture(crop.origUrl, null);
      });
    } else adPreview();
  }
  adForm.addEventListener('submit', async e => {
    e.preventDefault();
    const done = adForm.querySelector('.form-done'), btn = adForm.querySelector('button[type=submit]');
    const form = new FormData(adForm);
    // "Keep this ad in this space across all pages": saved against the space itself (all:left1).
    if (form.get('every_page')) form.set('placement', `all:${String(form.get('placement')).split(':')[1]}`);
    form.delete('every_page');
    form.delete('image');
    if (crop.img) {
      const contain = adForm.elements.fit.value === 'contain';
      const needsPhone = !contain && editingAd && !editingAd.phone_key;
      if (crop.file || crop.changed || !editingAd || needsPhone) {
        const out = render(adForm.elements.tier.value === 'large' ? 2600 : 1400, 'laptop');
        form.append('image', new File([await toBlob(out.canvas, outputType())], 'advert', { type: outputType() }));
        form.append('crop', contain ? '' : JSON.stringify(rectOf(viewState('laptop'))));
        if (contain) form.append('phone_clear', '1');
        else {
          const phone = render(1400, 'phone');
          form.append('phone_image', new File([await toBlob(phone.canvas, outputType())], 'advert-phone', { type: outputType() }));
          form.append('phone_crop', JSON.stringify(rectOf(viewState('phone'))));
        }
      } else {
        form.append('crop', editingAd.crop || '');
        form.append('phone_crop', editingAd.phone_crop || '');
      }
      // The untouched picture (kept so the advert can be re-cropped): a new upload, or an older advert's only picture.
      if (crop.file) form.append('original', await shrinkImage(crop.file, 3000));
      else if (editingAd && !editingAd.orig_key && crop.changed) form.append('original', new File([await (await fetch(crop.origUrl)).blob()], 'original', { type: outputType() }));
    }
    btn.disabled = true; done.textContent = 'Saving…';
    try {
      await api('/api/admin/ads', { method: 'POST', form });
      done.textContent = editingAd ? 'Saved. The change is live on the site now.' : 'Advert added. It is live on the site now.';
      setEditingAd(null);
      loadAds();
    } catch (err) { done.textContent = err.message; }
    finally { btn.disabled = false; }
  });
  adForm.querySelector('[data-cancel]').addEventListener('click', () => setEditingAd(null));
  // 6. The slot index: every page's seven slots as a little page diagram, with who is booked in each.
  let slotPages = [], slotPositions = [];
  const slotName = v => {
    const [page, pos] = String(v || '').split(':');
    const p = [...slotPages, ['all', 'Every page']].find(x => x[0] === page), q = slotPositions.find(x => x[0] === pos);
    return p && q ? `${p[1]} – ${q[1]}` : 'No slot chosen';
  };
  const today = () => new Date().toISOString().slice(0, 10);
  const isLive = a => (!a.starts_on || a.starts_on <= today()) && (!a.ends_on || a.ends_on >= today());
  let nextPlacement = '';
  function setPlacement(v) {
    const sel = adForm.elements.placement;
    // An advert kept on every page is shown in the form as the Home space with the box ticked.
    const every = String(v).startsWith('all:');
    adForm.elements.every_page.checked = every;
    if (every) v = `home:${v.slice(4)}`;
    sel.value = v;
    if (sel.value !== v) sel.value = '';
    adForm.elements.tier.value = String(sel.value).endsWith(':top') ? 'large' : 'small';
    $('slot-mini').innerHTML = sel.value ? miniMap(sel.value, adForm.elements.every_page.checked) : '<p class="meta">Choose a slot to see where it sits on the page.</p>';
  }
  // A small drawing of a page with the chosen slot picked out.
  function miniMap(selected, every) {
    const page = selected.split(':')[0];
    const cell = pos => `<span class="mm-${pos.startsWith('left') ? 'l' : pos.startsWith('right') ? 'r' : 't'}${`${page}:${pos}` === selected ? ' on' : ''}">${pos === 'top' ? 'Top' : pos.replace(/^left/, 'L').replace(/^right/, 'R')}</span>`;
    return `<div class="mm"><div class="mm-head">${every ? 'Every page' : `${esc(slotName(`${page}:top`).split(' – ')[0])} page`}</div>${cell('top')}
      <div class="mm-body"><div class="mm-col">${cell('left1')}${cell('left2')}${cell('left3')}</div><div class="mm-main">Page content</div><div class="mm-col">${cell('right1')}${cell('right2')}${cell('right3')}</div></div></div>`;
  }
  function slotIndex() {
    const box = (page, pos) => {
      const v = `${page}:${pos}`, own = ads.filter(a => a.placement === v);
      // The page's own advert first, otherwise one kept in this space on every page.
      const here = own.some(isLive) ? own : [...own, ...ads.filter(a => a.placement === `all:${pos}`)];
      const now = here.find(isLive), next = here.filter(a => !isLive(a) && a.starts_on && a.starts_on > today()).sort((x, y) => x.starts_on.localeCompare(y.starts_on))[0];
      return `<button type="button" class="si-slot si-${pos === 'top' ? 'top' : 'side'}${now ? ' booked' : ''}" data-slot="${v}" title="${esc(slotName(v))}">
        <span class="si-name">${esc(slotName(v))}</span>
        <span class="si-who">${now ? `${esc(now.name)}${now.placement.startsWith('all:') ? ' <small>every page</small>' : ''}` : 'Available'}${now && now.ends_on ? ` <small>until ${esc(niceDate(now.ends_on))}</small>` : ''}${next ? ` <small>next: ${esc(next.name)} from ${esc(niceDate(next.starts_on))}</small>` : ''}</span></button>`;
    };
    $('ad-index').innerHTML = slotPages.map(([page, label]) => `<section class="si-page"><h4>${esc(label)}</h4>${box(page, 'top')}
      <div class="si-body"><div class="si-col">${['left1', 'left2', 'left3'].map(p => box(page, p)).join('')}</div><div class="si-main">${esc(label)} page content</div><div class="si-col">${['right1', 'right2', 'right3'].map(p => box(page, p)).join('')}</div></div></section>`).join('');
  }
  $('ad-index').addEventListener('click', e => {
    const b = e.target.closest('[data-slot]');
    if (!b) return;
    const v = b.dataset.slot, pos = v.split(':')[1];
    const live = ads.find(a => a.placement === v && isLive(a)) || ads.find(a => a.placement === `all:${pos}` && isLive(a));
    if (live) return setEditingAd(live);
    nextPlacement = v;
    setEditingAd(null);
    adPreview();
    adForm.scrollIntoView({ behavior: 'smooth' });
  });

  async function loadAds() {
    layoutReady.then(() => { if (crop.img) initViews(savedRect('laptop'), savedRect('phone')); else fillShapes(crop.shape); });
    const d = await api('/api/admin/ads');
    ads = d.ads; slotPages = d.pages; slotPositions = d.positions;
    const sel = adForm.elements.placement, keep = sel.value;
    sel.innerHTML = '<option value="">Choose a slot…</option>' + slotPages.map(([page, label]) => `<optgroup label="${esc(label)}">${slotPositions.map(([pos]) => {
      const v = `${page}:${pos}`; return `<option value="${v}">${esc(slotName(v))} (${pos === 'top' ? 'banner' : 'side box'})</option>`; }).join('')}</optgroup>`).join('');
    setPlacement(editingAd ? editingAd.placement || '' : keep);
    slotIndex();
    const order = v => { if (v && v.startsWith('all:')) return -10 + slotPositions.findIndex(p => v.endsWith(':' + p[0])); const i = slotPages.findIndex(p => v && v.startsWith(p[0] + ':')), j = slotPositions.findIndex(p => v && v.endsWith(':' + p[0])); return i < 0 ? 999 : i * 10 + j; };
    const sorted = [...ads].sort((a, b) => order(a.placement) - order(b.placement));
    const t = today();
    $('ad-list').innerHTML = sorted.length ? sorted.map(a => `<div class="adm-card">
      ${a.image_key ? `<img class="adm-thumb" src="/media/${esc(a.image_key)}" alt="" style="object-fit:${a.fit === 'contain' ? `contain;background:${esc(a.bg || '#ffffff')}` : 'cover'};object-position:${AD_FOCUS[a.focus] || 'center'}">` : ''}<span class="si-tag">${esc(slotName(a.placement))}</span> <b>${esc(a.name)}</b>
      <div class="meta">${a.placement ? '' : '<b class="iss">Not showing: choose a slot for it</b> · '}${a.starts_on ? `from ${esc(niceDate(a.starts_on))} · ` : ''}${a.ends_on ? `until ${esc(niceDate(a.ends_on))} · ` : ''}${a.ends_on && a.ends_on < t ? '<b class="iss">ended, no longer showing</b> · ' : ''}${a.starts_on && a.starts_on > t ? 'not started yet · ' : ''}${a.fit === 'contain' ? 'whole image' : a.phone_key ? 'cropped to fill, with a phone crop' : 'cropped to fill (no phone crop yet)'}${a.link ? ` · ${esc(a.link)}` : ''}</div>
      <div class="adm-actions"><button class="btn sm" data-edit-ad="${a.id}">Edit</button><button class="btn sm alt" data-del-ad="${a.id}">Remove</button></div></div>`).join('')
      : '<div class="empty-state">No adverts yet. Every slot shows a small "Advertise here" box until it is booked.</div>';
  }
  $('ad-list').addEventListener('click', async e => {
    const edit = e.target.closest('[data-edit-ad]'), del = e.target.closest('[data-del-ad]');
    if (edit) setEditingAd(ads.find(a => a.id === Number(edit.dataset.editAd)));
    if (del) {
      const ad = ads.find(a => a.id === Number(del.dataset.delAd));
      if (!confirm(`Remove the advert for "${ad.name}" (${slotName(ad.placement)})? It comes off the site straight away.`)) return;
      await api(`/api/admin/ads?id=${ad.id}`, { method: 'DELETE' });
      if (editingAd && editingAd.id === ad.id) setEditingAd(null);
      loadAds();
    }
  });
  fillShapes();

  /* ---------- Stallions: the six listings on the Stallions page ---------- */
  // What a save found, in words that can't be mistaken for an error.
  function savedText(r) {
    const time = new Date().toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' });
    if (!r.matched.length) return { ok: true, text: `✓ Saved at ${time}. It is live on the Stallions page. No results found yet for this sire spelling; check "Sire name in the results" against the list of sires (start typing to see them).` };
    const names = r.matched.join(', ');
    return { ok: true, text: r.totals.mentions
      ? `✓ Saved at ${time}. It is live on the Stallions page. Matched in the results: ${names}. ${r.window.label}: ${r.totals.mentions} mention${r.totals.mentions === 1 ? '' : 's'} by ${r.totals.horses} horse${r.totals.horses === 1 ? '' : 's'}.`
      : `✓ Saved at ${time}. It is live on the Stallions page. Matched in the results: ${names}, but none of their progeny ran in the ${r.window.label.replace(/^Last/, 'last')}.` };
  }
  let stallionNote = null; // { slot, ok, text } shown under that listing after it re-draws
  const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  async function loadStallions() {
    const d = await api('/api/admin/stallions');
    $('sire-names').innerHTML = d.sires.map(n => `<option value="${esc(n)}">`).join('');
    renderFeature(d);
    $('st-list').innerHTML = d.listings.map(s => `<form class="form st-card" data-slot="${s.slot}">
      <h4>Stallions – Listing ${s.slot}${s.name ? '' : ' <small>(available)</small>'}</h4>
      ${s.image_key ? `<img class="adm-thumb" src="/media/${esc(s.image_key)}" alt="">` : ''}
      <label>Stallion name<input type="text" name="name" maxlength="80" value="${esc(s.name || '')}" required></label>
      <label>Sire name in the results <small>(commas between spellings; blank = the stallion name; breed codes, capitals and small typos don't matter)</small><input type="text" name="sire_names" maxlength="300" list="sire-names" value="${esc(s.sire_names || '')}"></label>
      <label>Short blurb (optional)<textarea name="blurb" maxlength="400" style="min-height:70px;">${esc(s.blurb || '')}</textarea></label>
      <label>Stud website (optional)<input type="text" name="link" placeholder="https://" inputmode="url" value="${esc(s.link || '')}"></label>
      <label>Photo${s.image_key ? ' (leave empty to keep the current one)' : ''} <small>JPG, PNG, WebP or GIF</small><input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif"></label>
      ${s.name ? `<p class="meta">${s.matched.length ? `Matches in the results: <b>${esc(s.matched.join(', '))}</b>. ${esc(d.window.label)}: <b>${s.totals.mentions}</b> mentions by ${s.totals.horses} horses, ${s.totals.wins} wins.` : '<b>No results found yet for this sire spelling.</b>'} <a href="/stallions/${s.slot}" target="_blank" rel="noopener">See the page ↗</a> · <a href="#" data-st-breeding="${esc(s.sire_names || s.name)}">Edit the progeny's breeding records →</a></p>` : ''}
      <div class="adm-actions"><button class="btn sm" type="submit">Save listing ${s.slot}</button>${s.name ? `<button class="btn sm alt" type="button" data-st-clear>Clear</button>` : ''}</div>
      <div class="form-done${stallionNote && stallionNote.slot === s.slot ? (stallionNote.ok ? ' ok' : ' err') : ''}" role="status">${stallionNote && stallionNote.slot === s.slot ? esc(stallionNote.text) : ''}</div>
    </form>`).join('');
  }
  // Sires mentioned most (and any other sire): one click puts him into a listing.
  function renderFeature(d) {
    const featured = new Map(d.listings.filter(l => l.name).flatMap(l => (l.matched || []).map(m => [m, l.slot])));
    const free = d.listings.filter(l => !l.name).map(l => l.slot);
    const slotSel = () => `<select class="feat-slot">${d.listings.map(l => `<option value="${l.slot}"${l.slot === free[0] ? ' selected' : ''}>Listing ${l.slot}${l.name ? ` (replaces ${esc(l.name)})` : ' (free)'}</option>`).join('')}</select>`;
    $('st-feature').innerHTML = `<h4>Sires mentioned most <small>${esc(d.window.label)}</small></h4>
      <p class="meta">Put any sire into one of the six listings with one click (you can add a photo and blurb afterwards). ${free.length ? `${free.length} listing${free.length === 1 ? ' is' : 's are'} free.` : 'All six are taken: choose which listing to replace.'}</p>
      <table class="feat-table"><thead><tr><th>#</th><th>Sire</th><th class="num">Mentions</th><th class="num">Horses</th><th class="num">Wins</th><th></th></tr></thead><tbody>
      ${d.top.map((t, i) => `<tr data-sire="${esc(t.name)}"><td>${i + 1}</td><td><b>${esc(t.name)}</b></td><td class="num">${t.mentions}</td><td class="num">${t.horses}</td><td class="num">${t.wins}</td>
        <td class="acts">${featured.has(t.name) ? `<span class="st st-live">In listing ${featured.get(t.name)}</span>` : `${slotSel()} <button class="btn sm" type="button" data-feature>Feature</button>`}</td></tr>`).join('')}
      </tbody></table>
      <div class="feat-any" data-any><label>Any other sire<input class="feat-name" list="sire-names" placeholder="Start typing a sire's name"></label> ${slotSel()} <button class="btn sm" type="button" data-feature>Feature</button></div>
      <div class="form-done" role="status" id="feat-done"></div>`;
  }
  $('st-feature').addEventListener('click', async e => {
    const b = e.target.closest('[data-feature]');
    if (!b) return;
    const row = b.closest('[data-sire], [data-any]');
    const name = row.dataset.sire || row.querySelector('.feat-name').value.trim();
    const slot = Number(row.querySelector('.feat-slot').value);
    if (!name) return;
    const sel = row.querySelector('.feat-slot'), replacing = /replaces/.test(sel.options[sel.selectedIndex].text);
    if (replacing && !confirm(`Put ${name} into Listing ${slot}? It replaces the stallion there now.`)) return;
    const form = new FormData(); form.append('slot', slot); form.append('name', name); form.append('sire_names', name);
    b.disabled = true;
    try {
      const r = await api('/api/admin/stallions', { method: 'POST', form });
      stallionNote = { slot, ...savedText(r) };
      await loadStallions();
      $('feat-done').className = 'form-done ok';
      $('feat-done').textContent = `✓ ${name} is now Stallions – Listing ${slot}. Add a photo and blurb below.`;
    } catch (err) { $('feat-done').className = 'form-done err'; $('feat-done').textContent = `Not saved: ${err.message}`; b.disabled = false; }
  });
  $('st-list').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, done = f.querySelector('.form-done'), btn = f.querySelector('button[type=submit]'), form = new FormData(f);
    const slot = Number(f.dataset.slot), fail = text => { done.className = 'form-done err'; done.textContent = text; };
    form.append('slot', slot);
    const file = f.elements.image.files[0];
    form.delete('image');
    if (file) {
      // Checked here first, so a wrong file is explained before anything is sent.
      if (!PHOTO_TYPES.includes(file.type)) return fail(`That file (${file.name}) isn't a picture we can use. Photos must be JPG, PNG, WebP or GIF.`);
      if (file.size > 25 * 1048576) return fail(`That photo is too big (${(file.size / 1048576).toFixed(1)} MB). Use one under 25 MB; it is made smaller before uploading.`);
      const small = await shrinkImage(file, 1400);
      if (small.size > 5 * 1048576) return fail(`That photo is still too big after resizing (${(small.size / 1048576).toFixed(1)} MB). The limit is 5 MB; try a JPG or WebP.`);
      form.append('image', small);
    }
    done.className = 'form-done'; done.textContent = 'Saving…'; btn.disabled = true;
    try {
      const r = await api('/api/admin/stallions', { method: 'POST', form });
      stallionNote = { slot, ...savedText(r) };
      await loadStallions();
    } catch (err) { fail(`Not saved: ${err.message}`); }
    finally { btn.disabled = false; }
  });
  $('st-list').addEventListener('click', async e => {
    const br = e.target.closest('[data-st-breeding]');
    if (br) { e.preventDefault(); return openBreedingFor(br.dataset.stBreeding); }
    if (!e.target.closest('[data-st-clear]')) return;
    const f = e.target.closest('form');
    if (!confirm(`Clear Stallions – Listing ${f.dataset.slot}? It shows as available straight away.`)) return;
    try {
      await api(`/api/admin/stallions?slot=${f.dataset.slot}`, { method: 'DELETE' });
      stallionNote = { slot: Number(f.dataset.slot), ok: true, text: '✓ Cleared. The listing shows as available on the Stallions page.' };
      loadStallions();
    } catch (err) { const d = f.querySelector('.form-done'); d.className = 'form-done err'; d.textContent = `Not cleared: ${err.message}`; }
  });

  /* ---------- Breeding records: find a horse, correct its breeding ---------- */
  const taggedName = (name, breed, tih) => name ? `${name}${breed ? ` (${breed})` : ''}${tih ? '[TIH]' : ''}` : '';
  function breedCard(h) {
    const v = {
      sire: taggedName(h.sire, h.sire_breed, h.sire_tih), dam: taggedName(h.dam, h.dam_breed, h.dam_tih),
      dam_sire: taggedName(h.dam_sire, h.dam_sire_breed, h.dam_sire_tih), breeder: h.breeder ? `${h.breeder}${h.breeder_county ? ` (${h.breeder_county})` : ''}` : ''
    };
    const missing = ['sire', 'dam', 'dam_sire', 'breeder'].filter(k => !v[k]).map(k => ({ sire: 'sire', dam: 'dam', dam_sire: 'dam sire', breeder: 'breeder' }[k]));
    const field = (k, label, extra = '') => `<label>${label}<input name="${k}" value="${esc(v[k])}" placeholder="UNK"${extra}></label>`;
    return `<form class="form breed-card" data-id="${h.id}">
      <div class="breed-head"><b>${esc(h.name)}</b> <span class="meta">${[h.birth_year, h.sex, h.breed_code].filter(Boolean).map(esc).join(' · ')}${h.former ? ` · was ${esc(h.former)}` : ''} · ${h.runs} result${h.runs === 1 ? '' : 's'}${h.last_run ? `, latest ${esc(niceDate(h.last_run))}` : ''}</span>
        ${missing.length ? `<span class="gap-tag">Missing: ${missing.join(', ')}</span>` : '<span class="st st-live">Complete</span>'}
        ${h.placing_id ? `<a class="breed-look" href="/horse/${h.placing_id}" target="_blank" rel="noopener">View on site ↗</a>` : ''}</div>
      <div class="breed-grid">
        ${field('sire', 'Sire', ' list="breed-sires"')}${field('dam', 'Dam')}${field('dam_sire', 'Dam sire', ' list="breed-sires"')}${field('breeder', 'Breeder (county)')}
        <label>Year of birth<input name="birth_year" type="number" min="1950" max="2100" value="${esc(h.birth_year ?? '')}"></label>
        <label>Sex<select name="sex">${['', 'Gelding', 'Mare', 'Stallion'].map(x => `<option${x === h.sex ? ' selected' : ''}>${x}</option>`).join('')}${['', 'Gelding', 'Mare', 'Stallion'].includes(h.sex) ? '' : `<option selected>${esc(h.sex)}</option>`}</select></label>
        <label>Breed<input name="breed" value="${esc(h.breed_code || '')}" placeholder="e.g. ISH" maxlength="8"></label>
        <label class="chk"><input type="checkbox" name="tih" value="1"${h.tih_flag ? ' checked' : ''}> Traditional Irish Horse [TIH]</label>
      </div>
      <div class="adm-actions"><button class="btn sm" type="submit">Save breeding</button>${h.breeding_updated_at ? `<span class="meta">Last updated ${esc(niceDate(h.breeding_updated_at))}</span>` : ''}</div>
      <div class="form-done" role="status"></div>
    </form>`;
  }
  let breedQuery = { q: '', sire: '', gaps: true };
  async function loadBreeding(query) {
    if (query) breedQuery = { ...breedQuery, ...query };
    const f = $('breed-search').elements;
    f.q.value = breedQuery.q; f.sire.value = breedQuery.sire; f.gaps.checked = breedQuery.gaps;
    $('breed-list').innerHTML = '<div class="empty-state">Loading…</div>';
    const p = new URLSearchParams({ q: breedQuery.q, sire: breedQuery.sire, gaps: breedQuery.gaps ? '1' : '' });
    const d = await api(`/api/admin/breeding?${p}`);
    $('breed-sires').innerHTML = d.sires.map(n => `<option value="${esc(n)}">`).join('');
    $('breed-gaps').textContent = `(${d.gaps} horses in the results)`;
    $('breed-count').textContent = d.total > d.horses.length ? `Showing ${d.horses.length} of ${d.total} horses, most recent first. Narrow the search to see the rest.` : `${d.total} horse${d.total === 1 ? '' : 's'}.`;
    $('breed-list').innerHTML = d.horses.map(breedCard).join('') || '<div class="empty-state">No horses match.</div>';
  }
  $('breed-search').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target.elements;
    loadBreeding({ q: f.q.value.trim(), sire: f.sire.value.trim(), gaps: f.gaps.checked });
  });
  $('breed-list').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, done = f.querySelector('.form-done'), btn = f.querySelector('button[type=submit]');
    const body = { id: Number(f.dataset.id), ...Object.fromEntries(new FormData(f)), tih: f.elements.tih.checked };
    btn.disabled = true; done.className = 'form-done'; done.textContent = 'Saving…';
    try {
      const r = await api('/api/admin/breeding', { method: 'POST', body });
      done.className = 'form-done ok';
      done.textContent = `✓ Saved. ${r.results} result${r.results === 1 ? '' : 's'} on the site now show these details.${r.merged ? ' This turned out to be the same horse as another record, so the two were joined.' : ''}`;
    } catch (err) { done.className = 'form-done err'; done.textContent = `Not saved: ${err.message}`; }
    finally { btn.disabled = false; }
  });
  // Stallions & sires: rename, codes, and joining two spellings of the same stallion.
  document.querySelectorAll('[data-breed-mode]').forEach(b => b.addEventListener('click', () => {
    const sires = b.dataset.breedMode === 'sires';
    document.querySelectorAll('[data-breed-mode]').forEach(x => x.classList.toggle('active', x === b));
    $('sire-pane').hidden = !sires; $('horse-pane').hidden = sires; $('horse-intro').hidden = sires;
    if (sires && !$('sire-list').innerHTML) loadSires();
  }));
  function sireCard(x) {
    return `<form class="form breed-card sire-card" data-id="${x.id}">
      <div class="breed-head"><b>${esc(x.name)}</b> <span class="meta">${x.progeny} horse${x.progeny === 1 ? '' : 's'} by him · ${x.results} result${x.results === 1 ? '' : 's'} · dam sire of ${x.as_dam_sire}</span>
        ${x.similar.length ? `<span class="gap-tag">Also spelt: ${esc(x.similar.join(', '))}?</span>` : ''}
        <a class="breed-look" href="/search?${new URLSearchParams({ q: x.name, field: 'sire' })}" target="_blank" rel="noopener">View progeny on site ↗</a></div>
      <div class="breed-grid">
        <label>Name<input name="name" value="${esc(x.name)}" maxlength="120" required></label>
        <label>Breed code<input name="breed" value="${esc(x.breed_code || '')}" maxlength="8" placeholder="e.g. ISH"></label>
        <label class="chk"><input type="checkbox" name="tih" value="1"${x.tih_flag ? ' checked' : ''}> Traditional Irish Horse [TIH]</label>
        <label>Join into another stallion (same horse, other spelling)<input name="merge_into" list="breed-sires" placeholder="${x.similar[0] ? esc(x.similar[0]) : 'Leave empty'}"></label>
      </div>
      <div class="adm-actions"><button class="btn sm" type="submit">Save stallion</button>
        <a href="#" data-sire-progeny="${esc(x.name)}">Edit his progeny's breeding records →</a></div>
      <div class="form-done" role="status"></div>
    </form>`;
  }
  async function loadSires(q = '') {
    $('sire-list').innerHTML = '<div class="empty-state">Loading…</div>';
    const d = await api(`/api/admin/breeding?${new URLSearchParams({ kind: 'sires', q })}`);
    $('sire-list').innerHTML = d.sires.map(sireCard).join('') || '<div class="empty-state">No stallions match.</div>';
  }
  $('sire-search').addEventListener('submit', e => { e.preventDefault(); loadSires(e.target.elements.q.value.trim()); });
  $('sire-list').addEventListener('click', e => {
    const a = e.target.closest('[data-sire-progeny]');
    if (!a) return;
    e.preventDefault();
    document.querySelector('[data-breed-mode="horses"]').click();
    loadBreeding({ q: '', sire: a.dataset.sireProgeny, gaps: false });
  });
  $('sire-list').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, done = f.querySelector('.form-done'), btn = f.querySelector('button[type=submit]');
    const into = f.elements.merge_into.value.trim();
    if (into && !confirm(`Join "${f.elements.name.value}" into "${into}"? All its progeny, mares and results move across and this spelling disappears.`)) return;
    btn.disabled = true; done.className = 'form-done'; done.textContent = 'Saving…';
    try {
      const r = await api('/api/admin/breeding', { method: 'POST', body: { kind: 'sire', id: Number(f.dataset.id), name: f.elements.name.value, breed: f.elements.breed.value, tih: f.elements.tih.checked, merge_into: into } });
      done.className = 'form-done ok';
      done.textContent = r.merged ? '✓ Joined. Everything for this spelling now sits under the other stallion; the site is updated.' : '✓ Saved. Every result shows the new details.';
    } catch (err) { done.className = 'form-done err'; done.textContent = `Not saved: ${err.message}`; }
    finally { btn.disabled = false; }
  });

  // From a stallion listing: straight to that stallion's progeny.
  function openBreedingFor(sire) {
    breedQuery = { q: '', sire, gaps: false };
    document.querySelector('[data-breed-mode="horses"]').click();
    document.querySelector('#adm-tabs button[data-a="breeding"]').click();
  }

  /* ---------- Comments ---------- */
  async function loadComments() {
    const d = await api('/api/admin/comments');
    const pending = d.comments.filter(c => c.status === 'pending'), approved = d.comments.filter(c => c.status === 'approved');
    const item = c => `<div class="adm-card"><b>${esc(c.name)}</b> <span class="meta">${esc(niceDate(c.created_at))} · on ${c.scope === 'news' ? 'News' : 'Results'}</span>
      ${c.spam_check === 'failed' ? '<div class="meta"><b class="iss">Spam check did not pass: read it carefully before approving</b></div>' : ''}
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
