/*
 * Builds one site's static files from public/ and its config in sites/<id>.js.
 *
 * public/ is the IBER site exactly as served. Site-specific spots in its HTML are marked:
 *   data-site="key"            the element's inner HTML becomes site.text[key]
 *   data-site-attr="a=key;b=k" attribute a becomes site.text[key] (escaped), and so on
 * The CSS :root tokens take site.theme's values, js/site.js and img/favicon.svg are written from the config,
 * and every other file is copied unchanged.
 */

const escAttr = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function textValue(site, key, where) {
  if (site.text && key in site.text) return site.text[key];
  if (typeof site[key] === 'string') return site[key]; // name, short
  throw new Error(`${where}: sites/${site.id}.js has no text.${key}`);
}

export function applyHtml(html, site, file = 'page') {
  const startTag = /<([a-zA-Z][\w-]*)(\s[^<>]*)?>/g;
  let out = '';
  let pos = 0;
  let m;
  while ((m = startTag.exec(html))) {
    const [tagText, tag, attrs = ''] = m;
    if (!/\sdata-site(-attr)?="/.test(attrs)) continue;
    out += html.slice(pos, m.index);
    let newTag = tagText;
    const attrSpec = attrs.match(/\sdata-site-attr="([^"]*)"/);
    if (attrSpec) {
      for (const pair of attrSpec[1].split(';').map(s => s.trim()).filter(Boolean)) {
        const [attr, key] = pair.split('=').map(s => s.trim());
        const re = new RegExp(`(\\s${attr}=")[^"]*(")`);
        if (!re.test(newTag)) throw new Error(`${file}: <${tag}> has no ${attr}="…" for data-site-attr`);
        newTag = newTag.replace(re, (_, a, b) => a + escAttr(textValue(site, key, file)) + b);
      }
    }
    out += newTag;
    pos = m.index + tagText.length;
    const inner = attrs.match(/\sdata-site="([^"]*)"/);
    if (inner) {
      const close = `</${tag}>`;
      // Find the matching close tag, stepping over any nested elements of the same name.
      const sameTag = new RegExp(`<(/?)${tag}(?=[\\s>])[^>]*>`, 'gi');
      sameTag.lastIndex = pos;
      let depth = 1, end = -1, t;
      while ((t = sameTag.exec(html))) {
        depth += t[1] ? -1 : 1;
        if (!depth) { end = t.index; break; }
      }
      if (end < 0) throw new Error(`${file}: <${tag} data-site="${inner[1]}"> is never closed`);
      out += textValue(site, inner[1], file) + close;
      pos = end + close.length;
      startTag.lastIndex = pos;
    }
  }
  return out + html.slice(pos);
}

// Replaces the values of the custom properties in the first :root block. Every token in the config must exist in
// the CSS and every token in the CSS must be in the config, so a new colour can't be forgotten on one site.
export function applyCss(css, theme, file = 'site.css') {
  const root = css.match(/:root\s*\{[^}]*\}/);
  if (!root) throw new Error(`${file}: no :root block`);
  const seen = new Set();
  const block = root[0].replace(/(--[\w-]+)(\s*:\s*)([^;]*)(;)/g, (all, name, colon, value, semi) => {
    if (!value.trim().startsWith('#') && !name.endsWith('-rgb')) return all; // fonts and sizes are shared, not themed
    if (!(name in theme)) throw new Error(`${file}: ${name} is not in the site theme`);
    seen.add(name);
    return name + colon + theme[name] + semi;
  });
  const missing = Object.keys(theme).filter(k => !seen.has(k));
  if (missing.length) throw new Error(`${file}: theme tokens not in :root: ${missing.join(', ')}`);
  return css.slice(0, root.index) + block + css.slice(root.index + root[0].length);
}

export function faviconSvg(f) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="${f.background}"/><path d="M14 50 A20 20 0 1 1 50 50" fill="none" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round"/><rect x="0" y="58" width="64" height="6" fill="${f.stripe}"/></svg>\n`;
}

export function siteJs(client) {
  return `/* Generated from sites/${client.id}.js by scripts/build-site.mjs. Edit the config, not this file. */\nwindow.SITE = ${JSON.stringify(client, null, 2)};\n`;
}

// file path (relative to public/, forward slashes) + contents → contents for this site.
export function transformFile(path, contents, site, client) {
  if (path === 'js/site.js') return siteJs(client);
  if (path === 'img/favicon.svg') return faviconSvg(site.favicon);
  if (path.endsWith('.html')) return applyHtml(contents.toString('utf8'), site, path);
  if (path === 'css/site.css') return applyCss(contents.toString('utf8'), site.theme, path);
  return contents;
}
