/* Shared helpers used by every page. */
(function () {
  // Objects and arrays must never be printed as text: they show up as "[object Object]".
  function guardText(x) {
    if (x !== null && typeof x === 'object') {
      const msg = 'esc() was given ' + (Array.isArray(x) ? 'an array' : 'an object') + ', not text';
      if (typeof window !== 'undefined' && window.IBER_STRICT) throw new Error(msg);
      if (typeof console !== 'undefined') console.error(msg, x);
      return '';
    }
    return x ?? '';
  }
  const esc = x => String(guardText(x)).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(path, opts = {}) {
    const init = { method: opts.method || 'GET', headers: {} };
    if (opts.form) init.body = opts.form;
    else if (opts.body !== undefined) { init.body = JSON.stringify(opts.body); init.headers['content-type'] = 'application/json'; }
    const res = await fetch(path, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status})`);
    return data;
  }

  const ordinal = n => {
    if (n === null || n === undefined || n === '') return '–';
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  const niceDate = iso => {
    if (!iso) return '';
    const d = new Date(iso.length <= 10 ? iso + 'T00:00:00Z' : iso.replace(' ', 'T') + 'Z');
    return isNaN(d) ? iso : d.toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  };

  const scoreText = h => {
    if (h.score === null || h.score === undefined) return '';
    const parts = h.dressage !== '' && h.dressage !== null ? `${h.dressage}, ${h.show_jumping}, ${h.cross_country} = ` : '';
    return parts + h.score;
  };

  const breedingText = h => {
    const head = [h.breed, h.foaled, h.sex].filter(Boolean).join(' ');
    const sire = h.sire ? `by ${h.sire}` : '';
    const dam = h.dam ? ` out of ${h.dam}` : '';
    const ds = h.dam_sire ? ` by ${h.dam_sire}` : '';
    const breeder = h.breeder ? ` Breeder: ${h.breeder}.` : '';
    return `${head}${head && sire ? ' — ' : ''}${sire}${dam}${ds}.${breeder}`.replace(/^\.\s*/, '');
  };

  /* Cloudflare Turnstile, loaded only when a site key is configured. */
  let tsKey = null, tsReady = null;
  function turnstileReady(siteKey) {
    tsKey = siteKey;
    if (!siteKey) return Promise.resolve(false);
    if (!tsReady) {
      tsReady = new Promise(resolve => {
        window.onTurnstileLoad = () => resolve(true);
        const s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad';
        s.async = true; s.defer = true;
        document.head.appendChild(s);
      });
    }
    return tsReady;
  }
  function mountTurnstile(form) {
    const slot = form.querySelector('.ts-slot');
    if (!tsKey || !slot || slot.dataset.mounted) return;
    slot.dataset.mounted = '1';
    tsReady.then(() => { slot.dataset.widget = window.turnstile.render(slot, { sitekey: tsKey, appearance: 'interaction-only' }); });
  }
  function turnstileToken(form) {
    const slot = form.querySelector('.ts-slot');
    if (!slot || !slot.dataset.widget || !window.turnstile) return '';
    return window.turnstile.getResponse(slot.dataset.widget) || '';
  }
  function resetTurnstile(form) {
    const slot = form.querySelector('.ts-slot');
    if (slot && slot.dataset.widget && window.turnstile) window.turnstile.reset(slot.dataset.widget);
  }


  /*
   * Photo framing, used everywhere a photo is added (owner area and "I want to sell"): the photo moves and zooms under
   * a box the shape the site shows it in, once for laptops and tablets and once for phones (where some boxes are a
   * different shape). Gives back { laptop, phone } as framed JPEG files, or null if cancelled.
   *   framePhoto(fileOrUrl, { laptop: '3/2', phone: '2/1', title })
   */
  function framePhoto(src, opts = {}) {
    const views = { laptop: { ratio: opts.laptop || '4/3', label: 'Laptop & tablet' }, phone: { ratio: opts.phone || opts.laptop || '4/3', label: 'Phone' } };
    return new Promise(resolve => {
      const url = typeof src === 'string' ? src : URL.createObjectURL(src);
      const ov = document.createElement('div');
      ov.className = 'frame-overlay';
      ov.innerHTML = `<div class="frame-box" role="dialog" aria-modal="true" aria-label="${esc(opts.title || 'Fit the photo')}">
        <h4>${esc(opts.title || 'Fit the photo to its box')}</h4>
        <div class="frame-tabs" role="tablist">${Object.entries(views).map(([k, v], i) => `<button type="button" role="tab" data-fv="${k}" class="${i ? '' : 'on'}">${v.label}</button>`).join('')}</div>
        <p class="frame-note">Drag the photo to move it and use the slider to zoom. What is inside the box is exactly what the site shows. Set the phone crop too: phones can show a different shape.</p>
        <div class="frame-stage"><img alt="" draggable="false"></div>
        <label class="frame-zoom">Zoom <input type="range" min="1" max="4" step="0.01" value="1"></label>
        <div class="frame-whole"><label><input type="checkbox"> Show the whole photo (no cropping)</label>
          <label class="frame-bg" hidden>Background <input type="color" value="#ffffff"></label></div>
        <div class="frame-actions"><button class="btn" type="button" data-fr="ok">Use this framing</button>
          <button class="btn alt" type="button" data-fr="cancel">Cancel</button></div></div>`;
      document.body.appendChild(ov);
      const stage = ov.querySelector('.frame-stage'), img = stage.querySelector('img');
      const zoom = ov.querySelector('input[type=range]'), whole = ov.querySelector('.frame-whole input'), bgBox = ov.querySelector('.frame-bg'), bg = bgBox.querySelector('input');
      let nw = 0, nh = 0, view = 'laptop';
      const st = { laptop: { z: 1, tx: null, ty: 0, whole: false, bg: '#ffffff', sw: 0, sh: 0 }, phone: { z: 1, tx: null, ty: 0, whole: false, bg: '#ffffff', sw: 0, sh: 0 } };
      const cur = () => st[view];
      const cover = s => Math.max(s.sw / nw, s.sh / nh), contain = s => Math.min(s.sw / nw, s.sh / nh);
      const scale = s => (s.whole ? contain(s) : cover(s) * s.z);
      function clamp(s) {
        const k = scale(s), W = nw * k, H = nh * k;
        if (s.whole) { s.tx = (s.sw - W) / 2; s.ty = (s.sh - H) / 2; return; }
        s.tx = Math.min(0, Math.max(s.sw - W, s.tx)); s.ty = Math.min(0, Math.max(s.sh - H, s.ty));
      }
      function show() {
        stage.style.aspectRatio = views[view].ratio;
        const s = cur();
        s.sw = stage.clientWidth; s.sh = stage.clientHeight;
        if (s.tx === null) { s.tx = (s.sw - nw * cover(s)) / 2; s.ty = (s.sh - nh * cover(s)) / 2; }
        zoom.value = s.z; whole.checked = s.whole; bg.value = s.bg;
        ov.querySelectorAll('[data-fv]').forEach(b => b.classList.toggle('on', b.dataset.fv === view));
        draw();
      }
      function draw() {
        const s = cur();
        clamp(s);
        const k = scale(s);
        Object.assign(img.style, { width: `${nw * k}px`, height: `${nh * k}px`, transform: `translate(${s.tx}px, ${s.ty}px)` });
        stage.style.background = s.whole ? s.bg : '#ddd';
        zoom.disabled = s.whole; bgBox.hidden = !s.whole;
      }
      const close = r => { document.removeEventListener('keydown', onKey); ov.remove(); if (typeof src !== 'string') URL.revokeObjectURL(url); resolve(r); };
      const onKey = e => { if (e.key === 'Escape') close(null); };
      document.addEventListener('keydown', onKey);
      img.onload = () => { nw = img.naturalWidth; nh = img.naturalHeight; show(); };
      img.onerror = () => close(null);
      img.crossOrigin = 'anonymous';
      img.src = url;
      let drag = null;
      stage.addEventListener('pointerdown', e => { if (cur().whole) return; drag = { x: e.clientX, y: e.clientY, tx: cur().tx, ty: cur().ty }; stage.setPointerCapture(e.pointerId); });
      stage.addEventListener('pointermove', e => { if (!drag) return; cur().tx = drag.tx + e.clientX - drag.x; cur().ty = drag.ty + e.clientY - drag.y; draw(); });
      ['pointerup', 'pointercancel'].forEach(t => stage.addEventListener(t, () => { drag = null; }));
      zoom.addEventListener('input', () => {
        const s = cur(), old = scale(s); s.z = Number(zoom.value); const k = scale(s) / old;
        s.tx = s.sw / 2 - (s.sw / 2 - s.tx) * k; s.ty = s.sh / 2 - (s.sh / 2 - s.ty) * k; draw();
      });
      whole.addEventListener('change', () => { const s = cur(); s.whole = whole.checked; if (!s.whole) { s.tx = (s.sw - nw * scale(s)) / 2; s.ty = (s.sh - nh * scale(s)) / 2; } draw(); });
      bg.addEventListener('input', () => { cur().bg = bg.value; draw(); });
      // One view's framing as a JPEG (its own state, measured when it was last shown; unseen views start centred).
      const render = (name, outW) => new Promise(done => {
        const s = st[name];
        if (!s.sw) { s.sw = 600; s.sh = 600 / ratioOf(views[name].ratio); }
        if (s.tx === null) { s.tx = (s.sw - nw * cover(s)) / 2; s.ty = (s.sh - nh * cover(s)) / 2; }
        clamp(s);
        const outH = Math.round(outW * s.sh / s.sw), k = outW / s.sw, c = document.createElement('canvas');
        c.width = outW; c.height = outH;
        const g = c.getContext('2d');
        g.fillStyle = s.bg; g.fillRect(0, 0, outW, outH);
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, s.tx * k, s.ty * k, nw * scale(s) * k, nh * scale(s) * k);
        c.toBlob(b => done(b ? new File([b], `${name}.jpg`, { type: 'image/jpeg' }) : null), 'image/jpeg', 0.88);
      });
      ov.addEventListener('click', async e => {
        if (e.target === ov) return close(null);
        const t = e.target.closest('[data-fv]');
        if (t) { view = t.dataset.fv; show(); return; }
        const b = e.target.closest('button[data-fr]');
        if (!b) return;
        if (b.dataset.fr === 'cancel') return close(null);
        b.disabled = true;
        try { close({ laptop: await render('laptop', 1200), phone: await render('phone', 900) }); }
        catch { close(null); } // a photo from another site can't be re-framed here
      });
    });
  }
  const ratioOf = t => { const [a, b] = String(t || '4/3').split('/').map(Number); return b ? a / b : a; };
  // Where a photo is shown: a phone gets its own crop (<key>-phone.<ext>, which falls back to the photo itself).
  const phoneKey = key => String(key || '').replace(/(\.[a-z]+)$/i, '-phone$1');
  function picture(src, attrs = '') {
    if (!src) return '';
    const phone = phoneKey(src);
    return `<picture><source media="(max-width: 720px)" srcset="${esc(phone)}"><img src="${esc(src)}" ${attrs}></picture>`;
  }

  window.IBE = { esc, api, ordinal, niceDate, scoreText, breedingText, turnstileReady, mountTurnstile, turnstileToken, resetTurnstile, framePhoto, phoneKey, picture };
})();
