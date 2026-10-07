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

  window.IBE = { esc, api, ordinal, niceDate, scoreText, breedingText, turnstileReady, mountTurnstile, turnstileToken, resetTurnstile };
})();
