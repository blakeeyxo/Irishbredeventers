/* Owner area. Every action works on a phone. */
(function () {
  const { esc, api, ordinal, niceDate, scoreText } = window.IBE;
  const $ = id => document.getElementById(id);

  /* ---------- Tabs ---------- */
  const loaders = { results: loadBatches, unverified: loadUnverified, news: () => loadNews(), links: () => loadLinks(), ads: loadAds, comments: loadComments, corrections: loadCorrections, enquiries: loadEnquiries };
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
    $('adm-batches').innerHTML = d.batches.length ? d.batches.map(b => `<div class="adm-card" data-batch="${b.id}"><b>${esc(b.label || 'Upload')}</b>
      <div class="meta">${esc(niceDate(b.created_at))} · ${b.row_count} results · ${b.unverified_count} unverified</div>
      <div class="adm-actions"><button class="btn sm" data-edit-batch="${b.id}">Edit</button>
        <button class="btn sm alt" data-del-batch="${b.id}" data-name="${esc(b.label)}">Remove</button></div>
      <div class="batch-edit" hidden></div></div>`).join('')
      : '<div class="empty-state">Nothing uploaded yet.</div>';
  }
  async function openBatch(card) {
    const box = card.querySelector('.batch-edit');
    if (!box.hidden) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '<div class="empty-state">Loading…</div>';
    const id = Number(card.dataset.batch), label = card.querySelector('b').textContent;
    const d = await api(`/api/admin/batches?id=${id}`);
    box.innerHTML = `<form class="form batch-label" data-id="${id}"><label>Upload name<input name="label" value="${esc(label)}" maxlength="120"></label>
        <div class="adm-actions"><button class="btn sm" type="submit">Save name</button></div></form>
      <p class="meta">${d.rows.length} results. Correct any field and press Save; Delete takes one result off the site.</p>
      <div class="unv-list">${d.rows.map(rowEditCard).join('')}</div>`;
  }
  $('adm-batches').addEventListener('click', async e => {
    const del = e.target.closest('[data-del-batch]'), edit = e.target.closest('[data-edit-batch]');
    if (edit) return openBatch(edit.closest('[data-batch]'));
    if (!del || !confirm(`Remove "${del.dataset.name}" and all its results from the site?`)) return;
    await api(`/api/admin/batches?id=${del.dataset.delBatch}`, { method: 'DELETE' });
    loadBatches(); refreshSummary();
  });
  $('adm-batches').addEventListener('submit', async e => {
    const f = e.target.closest('form.batch-label');
    if (!f) return;
    e.preventDefault();
    try { await api('/api/admin/batches', { method: 'POST', body: { id: Number(f.dataset.id), label: f.elements.label.value } }); f.closest('[data-batch]').querySelector('b').textContent = f.elements.label.value; }
    catch (err) { alert(err.message); }
  });

  /* ---------- Unverified ---------- */
  const FIELDS = [['position', 'Pos'], ['horse_name', 'Horse'], ['former_name', 'Former name(s)'], ['breed', 'Breed'], ['foaled', 'Foaled'], ['sex', 'Sex'],
    ['sire', 'Sire'], ['dam', 'Dam'], ['dam_sire', 'Dam sire'], ['breeder', 'Breeder'], ['dressage', 'Dressage'], ['show_jumping', 'Show jumping'], ['cross_country', 'Cross country'], ['score', 'Final score']];

  // One result as an editable card: in the Unverified tab, and under an upload opened with Edit.
  function rowEditCard(r) {
    return `<form class="adm-card" data-id="${r.id}" data-verified="${r.verified ? 1 : 0}">
      <b>${esc(r.horse_name || '?')}</b>${r.verified ? '' : ' <span class="iss">Unverified</span>'} <span class="meta">${esc(r.country)} · ${esc(r.event_name)} · ${esc(r.class_name)}</span>
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
    $('unv-list').innerHTML = d.rows.length ? d.rows.map(rowEditCard).join('') : '<div class="empty-state">No unverified results.</div>';
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
  const FALLBACK = { laptop: { banner: [1256, 110], box: [232, 232], home: [232, 232] }, phone: { banner: [358, 80], box: [171, 171], home: [171, 171] } };
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
          const slots = d.querySelectorAll('#rail .slot');
          if (!slots.length && tries < 40) return setTimeout(() => measure(tries + 1), 250);
          const probe = d.createElement('div');
          probe.innerHTML = '<div class="container banner-row"><div class="banner"></div></div>'
            + '<div class="container page"><main></main><aside class="rail"><div class="slot ad-box"></div></aside></div>';
          d.body.appendChild(probe);
          done({ banner: size(probe.querySelector('.banner')), box: size(probe.querySelector('.ad-box')), home: slots.length ? size(slots[0]) : null });
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
    const pick = (m, fb) => ({ banner: ok(m && m.banner) ? m.banner : fb.banner, box: ok(m && m.box) ? m.box : fb.box, home: ok(m && m.home) ? m.home : fb.home });
    layout = { laptop: pick(laptop, FALLBACK.laptop), phone: pick(phone, FALLBACK.phone), measured: !!(laptop && phone) };
    renderSizes();
    return layout;
  });
  const recommended = ([w, h]) => [w * PIXEL_DENSITY, h * PIXEL_DENSITY];
  const ratioText = ([w, h]) => { const r = w / h; return r >= 1 ? `${r.toFixed(r >= 10 ? 1 : 2).replace(/\.?0+$/, '')} : 1` : `1 : ${(1 / r).toFixed(2).replace(/\.?0+$/, '')}`; };
  const px = ([w, h]) => `${w} × ${h}`;
  // The shapes the crop tool offers, from the measured boxes.
  function shapes(tier) {
    const L = layout.laptop;
    return tier === 'large'
      ? [['banner', `Banner shape (${ratioText(L.banner)}, top and bottom banner)`, L.banner], ['free', 'Free shape', null]]
      : [['box', `Side box (${ratioText(L.box)}, every page)`, L.box], ['home', `Home page box (${ratioText(L.home)})`, L.home], ['free', 'Free shape', null]];
  }
  function renderSizes() {
    const L = layout.laptop, P = layout.phone;
    const row = (name, where, lap, ph) => `<tr><th>${name}<small>${where}</small></th><td>${px(lap)} px<small>phone ${px(ph)}</small></td><td><b>${px(recommended(lap))} px</b><small>ratio ${ratioText(lap)}</small></td></tr>`;
    $('ad-sizes').innerHTML = `<table class="ad-size-table"><thead><tr><th>Where it shows</th><th>Box on screen (laptop)</th><th>Recommended image</th></tr></thead><tbody>
      ${row('Top banner', 'every page, under the header', L.banner, P.banner)}
      ${row('Bottom banner', 'every page, above the footer (same advert and size as the top)', L.banner, P.banner)}
      ${row('Side boxes', 'right-hand column on every page', L.box, P.box)}
      ${row('Home page boxes', 'the same column on the home page, where the boxes stretch to the page height', L.home, P.home)}
      </tbody></table>
      <p class="meta">${layout.measured ? 'Measured from the site as it is now.' : 'Could not measure the site just now, so these are the sizes from the stylesheet.'}
      The recommended size is twice the box so it stays sharp on high-resolution screens. A smaller image still works,
      but you'll see a warning: it will be stretched to fit and may look soft or blurry. Side boxes also stretch beside long pages, so
      "Crop to fill" may trim a little more from the edges there.</p>`;
  }

  // 2. Crop tool: the picture moves and zooms under a fixed crop box (or a free-shape box with corner handles).
  const crop = { img: null, file: null, origUrl: '', shape: 'box', box: null, scale: 1, base: 1, tx: 0, ty: 0, changed: false };
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
  // The crop as fractions of the original image.
  function cropRect() {
    const W = crop.img.naturalWidth, H = crop.img.naturalHeight, b = crop.box;
    const x = Math.max(0, (b.x - crop.tx) / crop.scale), y = Math.max(0, (b.y - crop.ty) / crop.scale);
    return { x: x / W, y: y / H, w: Math.min(W - x, b.w / crop.scale) / W, h: Math.min(H - y, b.h / crop.scale) / H, shape: crop.shape };
  }
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
  window.addEventListener('resize', () => { if (crop.img && !$('ad-cropper').hidden) resetCrop(crop.img && cropRect()); });

  // The picture as it will be saved: the cropped part ("Crop to fill") or the whole image ("Show the whole image"),
  // never enlarged, at most maxW wide.
  function render(maxW) {
    const W = crop.img.naturalWidth, H = crop.img.naturalHeight;
    const r = adForm.elements.fit.value === 'contain' ? { x: 0, y: 0, w: 1, h: 1 } : cropRect();
    const sw = r.w * W, sh = r.h * H, k = Math.min(1, maxW / sw);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
    c.getContext('2d').drawImage(crop.img, r.x * W, r.y * H, sw, sh, 0, 0, c.width, c.height);
    return { canvas: c, w: Math.round(sw), h: Math.round(sh) };
  }
  const outputType = () => (crop.file && /png|gif|webp/.test(crop.file.type)) || /\.png$/i.test(crop.origUrl) ? 'image/png' : 'image/jpeg';
  const toBlob = (canvas, type) => new Promise(res => canvas.toBlob(b => res(b), type, 0.9));

  // 3. Warning when the picture (or the cropped part) is smaller than recommended for where it shows.
  function sizeWarning(w, h) {
    const tier = adForm.elements.tier.value, L = layout.laptop;
    const target = tier === 'large' ? ['banner', L.banner] : crop.shape === 'home' ? ['home page box', L.home] : ['side box', L.box];
    const [rw, rh] = recommended(target[1]);
    const contain = adForm.elements.fit.value === 'contain';
    // With the whole image shown, it only has to be big enough in the direction that touches the box edges.
    const short = contain ? (w / h > rw / rh ? w < rw : h < rh) : (w < rw || h < rh);
    const el = $('ad-warning');
    el.hidden = !short;
    if (short) el.textContent = `Smaller than recommended: ${contain ? 'this image' : 'the cropped part'} is ${w} × ${h} pixels and the recommended size for a ${target[0]} is ${rw} × ${rh}. `
      + `It can still be saved, but it will be stretched to fit the box and may look soft or blurry, especially on high-resolution screens. `
      + (contain ? 'Use a larger image if you have one.' : 'Zoom out, use a bigger crop box, or upload a larger image.');
  }

  // 4. Live preview in the site's own boxes, at their real (measured) proportions.
  let previewQueued = false;
  function queuePreview() { if (!previewQueued) { previewQueued = true; requestAnimationFrame(() => { previewQueued = false; adPreview(); }); } }
  function adPreview() {
    const f = adForm.elements, name = f.name.value.trim(), contain = f.fit.value === 'contain';
    $('ad-cropper').hidden = !crop.img || contain;
    adForm.querySelector('.bg-only').hidden = !contain;
    if (!crop.img && !name) { $('ad-preview').hidden = true; $('ad-warning').hidden = true; return; }
    let src = '';
    if (crop.img) {
      const out = render(900);
      src = out.canvas.toDataURL('image/jpeg', 0.85);
      sizeWarning(out.w, out.h);
    }
    const style = `width:100%;height:100%;display:block;object-fit:${contain ? `contain;background:${f.bg.value}` : 'cover'}`;
    const inner = cls => src ? `<img src="${src}" alt="" style="${style}">` : `<span class="${cls}">${esc(name)}</span>`;
    const L = layout.laptop, P = layout.phone;
    const box = (size, label, scale = 1) => `<figure><div class="ad-box" style="aspect-ratio:auto;width:${Math.round(size[0] * scale)}px;height:${Math.round(size[1] * scale)}px;"><span class="ad-body" style="padding:0">${inner('ad-name')}</span></div><figcaption>${label}</figcaption></figure>`;
    $('ad-preview-boxes').innerHTML = f.tier.value === 'large'
      ? `<div class="banner" style="height:auto;aspect-ratio:${L.banner[0]}/${L.banner[1]};">${inner('banner-name')}</div><p class="meta">Top and bottom banner on a laptop (${px(L.banner)})</p>
         <div class="banner" style="height:${P.banner[1]}px;width:${P.banner[0]}px;max-width:100%;">${inner('banner-name')}</div><p class="meta">On a phone (${px(P.banner)})</p>`
      : `<div class="ad-preview-row">${box(L.box, `Side box (${px(L.box)})`)}${box(L.home, `Home page box (${px(L.home)})`)}${box(P.box, `On a phone (${px(P.box)})`)}</div>`;
    $('ad-preview').hidden = false;
  }

  // Loading a picture into the crop tool: a new file, or the saved original when editing.
  function loadPicture(url, saved) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        crop.img = img;
        imgEl.src = url;
        $('ad-cropper').hidden = adForm.elements.fit.value === 'contain';
        requestAnimationFrame(() => { resetCrop(saved); adPreview(); resolve(true); });
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
  adForm.elements.tier.addEventListener('change', () => { fillShapes(); if (crop.img) { crop.changed = true; resetCrop(); } adPreview(); });
  ['input', 'change'].forEach(ev => adForm.addEventListener(ev, e => { if (e.target.name !== 'image' && e.target.name !== 'tier' && e.target.id !== 'crop-zoom') queuePreview(); }));
  adForm.elements.fit.addEventListener('change', () => { crop.changed = true; if (crop.img) requestAnimationFrame(() => resetCrop(cropRect())); });

  // 5. Add and edit.
  let ads = [], editingAd = null;
  function setEditingAd(ad) {
    editingAd = ad;
    adForm.reset();
    if (ad) adForm.querySelector('.form-done').textContent = '';
    Object.assign(crop, { img: null, file: null, origUrl: '', changed: false });
    adForm.elements.id.value = ad ? ad.id : '';
    adForm.querySelectorAll('.edit-only').forEach(el => { el.hidden = !ad; });
    $('ad-form-title').textContent = ad ? `Edit advert: ${ad.name}` : 'Add an advert';
    adForm.querySelector('button[type=submit]').textContent = ad ? 'Save changes' : 'Add advert';
    $('ad-cropper').hidden = true;
    let saved = null;
    if (ad) {
      for (const k of ['tier', 'name', 'link', 'slot', 'starts_on', 'ends_on', 'fit', 'bg']) adForm.elements[k].value = ad[k] ?? '';
      if (!/^#[0-9a-f]{6}$/i.test(adForm.elements.bg.value)) adForm.elements.bg.value = '#ffffff';
      try { saved = ad.crop ? JSON.parse(ad.crop) : null; } catch { saved = null; }
      adForm.scrollIntoView({ behavior: 'smooth' });
    }
    fillShapes(saved && saved.shape);
    const key = ad && (ad.orig_key || ad.image_key);
    if (key) {
      crop.origUrl = `/media/${key}`;
      // If the original can't be loaded, start again from the picture as it shows now.
      loadPicture(crop.origUrl, saved).then(ok => {
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
    form.delete('image');
    if (crop.img) {
      if (crop.file || crop.changed || !editingAd) {
        const out = render(adForm.elements.tier.value === 'large' ? 2600 : 1400);
        form.append('image', new File([await toBlob(out.canvas, outputType())], 'advert', { type: outputType() }));
        form.append('crop', adForm.elements.fit.value === 'contain' ? '' : JSON.stringify(cropRect()));
      } else {
        form.append('crop', editingAd.crop || '');
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
  async function loadAds() {
    layoutReady.then(() => { fillShapes(crop.shape); if (crop.img) resetCrop(cropRect()); });
    ads = (await api('/api/admin/ads')).ads;
    const today = new Date().toISOString().slice(0, 10);
    $('ad-list').innerHTML = ads.length ? ads.map((a, i) => `<div class="adm-card">
      ${a.image_key ? `<img class="adm-thumb" src="/media/${esc(a.image_key)}" alt="" style="object-fit:${a.fit === 'contain' ? `contain;background:${esc(a.bg || '#ffffff')}` : 'cover'};object-position:${AD_FOCUS[a.focus] || 'center'}">` : ''}<b>${esc(a.name)}</b>
      <div class="meta">${a.tier === 'large' ? 'Banner (top and bottom)' : `Side box · ${a.slot ? `slot ${a.slot}` : 'first free slot'}`}${a.starts_on ? ` · from ${esc(niceDate(a.starts_on))}` : ''}${a.ends_on ? ` · until ${esc(niceDate(a.ends_on))}` : ''}${a.ends_on && a.ends_on < today ? ' · <b class="iss">ended, no longer showing</b>' : ''} · ${a.fit === 'contain' ? 'whole image' : 'cropped to fill'}${a.link ? ` · ${esc(a.link)}` : ''}</div>
      <div class="adm-actions"><button class="btn sm" data-edit-ad="${i}">Edit</button><button class="btn sm alt" data-del-ad="${i}">Remove</button></div></div>`).join('')
      : '<div class="empty-state">No ads yet. The right-hand column shows news and link cards until one is booked.</div>';
  }
  $('ad-list').addEventListener('click', async e => {
    const edit = e.target.closest('[data-edit-ad]'), del = e.target.closest('[data-del-ad]');
    if (edit) setEditingAd(ads[Number(edit.dataset.editAd)]);
    if (del) {
      const ad = ads[Number(del.dataset.delAd)];
      if (!confirm(`Remove the advert for "${ad.name}"? It comes off the site straight away.`)) return;
      await api(`/api/admin/ads?id=${ad.id}`, { method: 'DELETE' });
      if (editingAd && editingAd.id === ad.id) setEditingAd(null);
      loadAds();
    }
  });
  fillShapes();

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
