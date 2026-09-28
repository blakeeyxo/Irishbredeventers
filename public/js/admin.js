/* Owner area. Every action works on a phone. */
(function () {
  const { esc, api, ordinal, niceDate, scoreText } = window.IBE;
  const $ = id => document.getElementById(id);
  let checkRows = [];

  /* ---------- Tabs ---------- */
  const loaders = { results: loadBatches, unverified: loadUnverified, news: loadNews, ads: loadAds, comments: loadComments, corrections: loadCorrections };
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
    for (const k of ['unverified', 'comments', 'corrections']) {
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

  /* ---------- Results upload ---------- */
  $('adm-year').value = new Date().getFullYear();
  $('adm-clear').addEventListener('click', () => {
    $('parse-form').reset(); $('adm-year').value = new Date().getFullYear();
    checkRows = []; renderPreview(); btnMsg($('adm-msg'), '');
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
      checkRows = d.rows;
      renderPreview(d);
      btnMsg($('adm-msg'), d.rows.length ? '' : 'No placings found. Each placing needs to start with its position, for example "1st Horse Name ISH 2015 gelding by Sire out of Dam by Dam Sire. Breeder: Name."');
      if (d.rows.length) $('adm-preview').scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      btnMsg($('adm-msg'), err.message);
    }
  });

  function renderPreview(d) {
    const box = $('adm-preview');
    if (!checkRows.length) { box.innerHTML = ''; return; }
    const bad = checkRows.filter(r => r.issues.length).length;
    const subs = summary ? summary.subscribers : 0;
    box.innerHTML = `<div class="extra-block" style="margin-top:26px;">
      <h3 class="extra-title">Check before publishing</h3>
      <p class="extra-copy"><b>${checkRows.length}</b> placings found in <b>${d.events}</b> event${d.events === 1 ? '' : 's'} and <b>${d.classes}</b> class${d.classes === 1 ? '' : 'es'}. <b>${bad}</b> need checking and are ticked "Unverified". Tick or untick any row. Unverified rows go to the end of the results.</p>
      <table class="adm-table stack"><tr><th>Pos</th><th>Horse</th><th>Sire · dam (dam sire)</th><th>Breeder</th><th>Score</th><th>Event · class</th><th>Unverified</th></tr>
      ${checkRows.map((r, i) => `<tr class="${r.issues.length ? 'bad' : ''}">
        <td data-label="Pos">${esc(ordinal(r.position))}</td>
        <td data-label="Horse"><b>${esc(r.horse_name || '?')}</b>${r.former_name ? `<br><small>was ${esc(r.former_name)}</small>` : ''}<br><small>${esc([r.breed, r.foaled, r.sex].filter(Boolean).join(' '))}</small></td>
        <td data-label="Breeding">${esc(r.sire || '?')} · ${esc(r.dam || '?')} (${esc(r.dam_sire || '–')})</td>
        <td data-label="Breeder">${esc(r.breeder || '?')}</td>
        <td data-label="Score">${esc(scoreText(r) || '?')}</td>
        <td data-label="Event">${esc(r.country || '?')} · ${esc(r.event_name || '?')}<br><small>${esc(r.class_name || '?')}</small>
          ${r.issues.length ? `<br><small class="iss">${esc(r.issues.join('; '))}</small>` : ''}
          ${r.warnings.length ? `<br><small class="adm-warn">${esc(r.warnings.join('; '))}</small>` : ''}</td>
        <td data-label="Unverified"><input type="checkbox" data-i="${i}" ${r.verified ? '' : 'checked'} aria-label="Unverified"></td></tr>`).join('')}
      </table>
      ${d.notes.length ? `<details class="adm-notes"><summary>${d.notes.length} line${d.notes.length === 1 ? '' : 's'} not used (commentary or unrecognised)</summary>${d.notes.map(n => `<p>${esc(n)}</p>`).join('')}</details>` : ''}
      <div class="site-form" style="margin-top:16px;">
        <label>Label for this upload<input type="text" id="adm-label" maxlength="120" value="Results ${esc(new Date().toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' }))}"></label>
        <label style="display:flex;gap:8px;align-items:center;font-weight:600;"><input type="checkbox" id="adm-email" ${subs ? 'checked' : ''} style="width:auto;"> Email subscribers a link to the new results (${subs} subscriber${subs === 1 ? '' : 's'}${summary && !summary.mailReady ? ', email not set up yet' : ''})</label>
        <button class="site-btn" type="button" id="adm-publish">Publish ${checkRows.length} results</button>
        <div class="form-done" id="pub-msg" role="status"></div>
      </div></div>`;
    box.querySelectorAll('input[data-i]').forEach(cb => cb.addEventListener('change', () => { checkRows[cb.dataset.i].verified = !cb.checked; }));
    $('adm-publish').addEventListener('click', publish);
  }

  async function publish() {
    const btn = $('adm-publish');
    btn.disabled = true;
    btnMsg($('pub-msg'), 'Publishing…');
    try {
      const d = await api('/api/admin/publish', { method: 'POST', body: { rows: checkRows, label: $('adm-label').value, notify: $('adm-email').checked } });
      checkRows = [];
      $('parse-form').reset(); $('adm-year').value = new Date().getFullYear();
      renderPreview();
      btnMsg($('adm-msg'), `Published ${d.rowCount} results (${d.unverifiedCount} unverified).${d.emailed ? ` Emailing ${d.emailed} subscribers now.` : ''}`);
      loadBatches(); refreshSummary();
    } catch (e) {
      btn.disabled = false;
      btnMsg($('pub-msg'), e.message);
    }
  }

  async function loadBatches() {
    const d = await api('/api/admin/batches');
    $('adm-batches').innerHTML = d.batches.length ? d.batches.map(b => `<div class="adm-card"><b>${esc(b.label || 'Upload')}</b>
      <div class="meta">${esc(niceDate(b.created_at))} · ${b.row_count} results · ${b.unverified_count} unverified</div>
      <div class="adm-actions"><button class="site-btn sm alt" data-del-batch="${b.id}" data-name="${esc(b.label)}">Remove this upload</button></div></div>`).join('')
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
        <button class="site-btn sm" data-act="verify">Save and mark as verified</button>
        <button class="site-btn sm alt" data-act="save">Save, keep unverified</button>
        <button class="site-btn sm alt" data-act="remove">Delete</button>
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
      <div class="adm-actions"><button class="site-btn sm alt" data-del-news="${n.id}">Delete</button></div></div>`).join('') : '<div class="empty-state">No news yet.</div>';
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
      <div class="meta">${a.tier === 'large' ? 'Large business (top banner)' : 'Small breeder or business'}${a.ends_on ? ` · until ${esc(niceDate(a.ends_on))}` : ''}${a.ends_on && a.ends_on < today ? ' · <b class="iss">ended, no longer showing</b>' : ''}${a.link ? ` · ${esc(a.link)}` : ''}</div>
      <div class="adm-actions"><button class="site-btn sm alt" data-del-ad="${a.id}">Remove</button></div></div>`).join('')
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
      ${c.status === 'pending' ? `<button class="site-btn sm" data-cm="approve" data-id="${c.id}">Approve</button>` : ''}
      <button class="site-btn sm alt" data-cm="delete" data-id="${c.id}">Delete</button></div></div>`;
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
      <div class="adm-actions">${c.status === 'open' ? `<button class="site-btn sm" data-corr="done" data-id="${c.id}">Done</button>` : ''}
      <button class="site-btn sm alt" data-corr="delete" data-id="${c.id}">Delete</button></div></div>`).join('')
      : '<div class="empty-state">No corrections sent in.</div>';
  }
  $('corr-list').addEventListener('click', async e => {
    const b = e.target.closest('[data-corr]');
    if (!b) return;
    if (b.dataset.corr === 'delete' && !confirm('Delete this correction?')) return;
    await api('/api/admin/corrections', { method: 'POST', body: { id: Number(b.dataset.id), action: b.dataset.corr } });
    loadCorrections(); refreshSummary();
  });

  refreshSummary().then(loadBatches);
})();
