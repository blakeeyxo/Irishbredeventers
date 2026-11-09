/*
 * Sends email through a mailing service's API. Pick one with MAIL_PROVIDER:
 *   resend (default) or brevo
 * and set MAIL_API_KEY (secret) and MAIL_FROM, e.g. "IrishBredEventingResults <info@iber.ie>".
 * If no key is set, nothing is sent and the call reports that.
 * Names, subjects and colours come from the site config (sites/<id>.js, picked with siteFor(env)).
 */

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function sendResend(env, messages) {
  let sent = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100).map(m => ({
      from: env.MAIL_FROM, to: [m.to], subject: m.subject, html: m.html, text: m.text, reply_to: m.replyTo || undefined,
      headers: m.unsubscribeUrl ? { 'List-Unsubscribe': `<${m.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined
    }));
    const res = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.MAIL_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(chunk)
    });
    if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`);
    sent += chunk.length;
  }
  return sent;
}

async function sendBrevo(env, messages) {
  const m = String(env.MAIL_FROM).match(/^(.*?)\s*<(.+)>$/);
  const sender = m ? { name: m[1], email: m[2] } : { email: env.MAIL_FROM };
  let sent = 0;
  for (let i = 0; i < messages.length; i += 500) {
    const chunk = messages.slice(i, i + 500);
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env.MAIL_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender,
        subject: chunk[0].subject,
        htmlContent: chunk[0].html,
        messageVersions: chunk.map(x => ({
          to: [{ email: x.to }], subject: x.subject, htmlContent: x.html, replyTo: x.replyTo ? { email: x.replyTo } : undefined,
          headers: x.unsubscribeUrl ? { 'List-Unsubscribe': `<${x.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined
        }))
      })
    });
    if (!res.ok) throw new Error(`Brevo error ${res.status}: ${await res.text()}`);
    sent += chunk.length;
  }
  return sent;
}

export async function sendEmails(env, messages) {
  if (!messages.length) return { sent: 0 };
  if (!env.MAIL_API_KEY || !env.MAIL_FROM) {
    console.log(`Email not configured. Would have sent ${messages.length}: ${messages[0].subject}`);
    return { sent: 0, skipped: true };
  }
  const provider = (env.MAIL_PROVIDER || 'resend').toLowerCase();
  const sent = provider === 'brevo' ? await sendBrevo(env, messages) : await sendResend(env, messages);
  return { sent };
}

const domainOf = site => String(site.publicUrl || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
// "You're getting this because you signed up for IBER updates at iber.ie."
const footerLine = site => `You're getting this because you signed up for ${site.short} updates at ${domainOf(site)}.`;

function layout(site, title, inner, unsubscribeUrl) {
  const m = site.mail;
  return `<!doctype html><html><body style="margin:0;background:${m.pageBackground};font-family:Arial,Helvetica,sans-serif;color:#1C1B17;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-top:4px solid ${m.topBorder};padding:28px 28px 24px;">
  <div style="font-family:Georgia,serif;font-size:24px;font-weight:bold;color:${m.heading};margin-bottom:18px;">${esc(site.name)}</div>
  <h1 style="font-family:Georgia,serif;font-size:20px;color:${m.heading};margin:0 0 12px;">${esc(title)}</h1>
  ${inner}
  ${unsubscribeUrl ? `<p style="font-size:12px;color:#6B6858;margin-top:28px;border-top:1px solid #D9D2B8;padding-top:12px;">${esc(footerLine(site))} <a href="${esc(unsubscribeUrl)}" style="color:#6B6858;">Unsubscribe</a></p>` : ''}
</div></body></html>`;
}
const button = (site, href, label) => `<p style="margin:22px 0;"><a href="${esc(href)}" style="background:${site.mail.button};color:#fff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:3px;display:inline-block;">${esc(label)}</a></p>`;

export function confirmEmail(site, to, confirmUrl) {
  return {
    to,
    subject: site.mail.confirmSubject,
    html: layout(site, 'Please confirm your email', `<p style="font-size:15px;line-height:1.6;">Tap the button to start getting a short email with a link each time new results are published. If you did not sign up, ignore this email and nothing happens.</p>${button(site, confirmUrl, 'Confirm my email')}`),
    text: `${site.mail.confirmSubject}: ${confirmUrl}\n\nIf you did not sign up, ignore this email.`
  };
}

export function resultsEmail(site, to, resultsUrl, unsubscribeUrl, summary) {
  return {
    to,
    unsubscribeUrl,
    subject: site.mail.resultsSubject,
    html: layout(site, 'New results are published', `<p style="font-size:15px;line-height:1.6;">${esc(summary)}</p>${button(site, resultsUrl, 'See the results')}`, unsubscribeUrl),
    text: `${summary}\n\nSee the results: ${resultsUrl}\n\n${footerLine(site)}\nUnsubscribe: ${unsubscribeUrl}`
  };
}

/* ---------- Emails the owner writes to subscribers (owner area → Email) ---------- */

// A web link the owner typed: http(s) only, so nothing else (javascript:, data:) can become a link.
const safeUrl = u => (/^https?:\/\/[^\s<>"]+$/i.test(String(u || '').trim()) ? String(u).trim() : '');
const LINK_RE = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

/**
 * Plain text as the owner typed it → email HTML: everything escaped, blank lines start a new paragraph, a single
 * line break stays a line break, and links are allowed as a bare https://… address or [words](https://…).
 */
export function messageHtml(text) {
  return String(text || '').replace(/\r/g, '').trim().split(/\n\s*\n/).filter(p => p.trim()).map(p => {
    let html = '', last = 0;
    for (const m of p.matchAll(LINK_RE)) {
      html += esc(p.slice(last, m.index));
      const url = m[2] || m[3], label = m[1] || m[3];
      html += `<a href="${esc(url)}" style="color:#0F6741;">${esc(label)}</a>`;
      last = m.index + m[0].length;
    }
    html += esc(p.slice(last));
    return `<p style="font-size:15px;line-height:1.6;margin:0 0 14px;">${html.replace(/\n/g, '<br>')}</p>`;
  }).join('');
}
/** The same text for the plain-text part of the email: [words](link) becomes "words (link)". */
export const messageText = text => String(text || '').replace(/\r/g, '').trim().replace(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)');

/**
 * One subscriber email. m: { kind: 'results' | 'other', subject, text, news: { headline, summary, link } }.
 * A results update ends with a "See the results" button; a news block shows as a box with "Read more".
 */
export function ownerEmail(site, to, m, { siteUrl: base, unsubscribeUrl }) {
  const resultsUrl = `${base}/results`;
  const news = m.news && (m.news.headline || m.news.summary) ? { headline: String(m.news.headline || ''), summary: String(m.news.summary || ''), link: safeUrl(m.news.link) || `${base}/news` } : null;
  const title = m.kind === 'results' ? 'New results are up' : '';
  let inner = messageHtml(m.text);
  let text = messageText(m.text);
  if (news) {
    inner += `<div style="border:1px solid #D9D2B8;border-left:4px solid ${site.mail.heading};padding:14px 16px;margin:18px 0;">
      <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#6B6858;margin-bottom:6px;">News</div>
      ${news.headline ? `<div style="font-family:Georgia,serif;font-size:18px;font-weight:bold;color:${site.mail.heading};margin-bottom:6px;">${esc(news.headline)}</div>` : ''}
      ${news.summary ? messageHtml(news.summary) : ''}
      <a href="${esc(news.link)}" style="color:${site.mail.heading};font-weight:bold;">Read more</a></div>`;
    text += `\n\nNEWS\n${[news.headline, messageText(news.summary), `Read more: ${news.link}`].filter(Boolean).join('\n')}`;
  }
  if (m.kind === 'results') {
    inner += button(site, resultsUrl, 'See the results');
    text += `\n\nSee the results: ${resultsUrl}`;
  }
  if (m.closing) { inner += messageHtml(m.closing); text += `\n\n${messageText(m.closing)}`; }
  return {
    to, unsubscribeUrl,
    subject: String(m.subject || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200),
    html: layout(site, title, inner, unsubscribeUrl).replace(/<h1[^>]*><\/h1>\s*/, ''),
    text: `${text.trim()}\n\n--\n${footerLine(site)}\nUnsubscribe: ${unsubscribeUrl}`
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
/**
 * Sends one email per person in small batches with a short pause between them (inside the mail service's rate
 * limit). A batch the service refuses is recorded as failed for each person in it; the rest still go.
 * Returns { sent, failed: [{ to, error }], skipped } (skipped: email is not set up, nothing was sent).
 */
export async function sendInBatches(env, messages, { size = 50, pauseMs = 700 } = {}) {
  if (!env.MAIL_API_KEY || !env.MAIL_FROM) return { sent: 0, failed: [], skipped: true };
  let sent = 0;
  const failed = [];
  for (let i = 0; i < messages.length; i += size) {
    const chunk = messages.slice(i, i + size);
    try {
      sent += (await sendEmails(env, chunk)).sent;
    } catch (e) {
      const error = String(e && e.message || e).slice(0, 200);
      chunk.forEach(m => failed.push({ to: m.to, error }));
    }
    if (i + size < messages.length) await sleep(pauseMs);
  }
  return { sent, failed, skipped: false };
}

const INTEREST_LABEL = { banner: 'Banner (top and bottom)', box: 'Side box', unsure: 'Not sure yet' };
export function enquiryEmail(site, to, e) {
  const rows = [['Name', e.name], ['Business', e.business], ['Email', e.email], ['Phone', e.phone], ['Interested in', INTEREST_LABEL[e.interest]], ['Message', e.message]]
    .filter(([, v]) => v);
  return {
    to,
    subject: `Advertising enquiry from ${e.business || e.name}`,
    html: layout(site, 'New advertising enquiry', `<table style="font-size:15px;line-height:1.5;border-collapse:collapse;">${rows.map(([k, v]) =>
      `<tr><td style="padding:4px 14px 4px 0;color:#6B6858;vertical-align:top;">${esc(k)}</td><td style="padding:4px 0;white-space:pre-wrap;">${esc(v)}</td></tr>`).join('')}</table>
      <p style="font-size:13px;color:#6B6858;">Also in the owner area under Enquiries.</p>`),
    text: rows.map(([k, v]) => `${k}: ${v}`).join('\n')
  };
}

/* ---------- For Sale ---------- */
const para = t => `<p style="font-size:15px;line-height:1.6;white-space:pre-wrap;">${esc(t)}</p>`;

export function listingReceivedEmail(site, to, l) {
  const body = `Thanks for sending in your ad "${l.title}". We check every ad before it goes on the site. Once it's approved we'll let you know the listing fee and how to pay (by phone to Charlie), and it goes live as soon as it's paid.`;
  return { to, subject: `We've received your ad: ${l.title}`, html: layout(site, 'Your ad is waiting for review', para(body)), text: body };
}

export function listingApprovedEmail(site, to, l, fee, instructions) {
  const body = `Good news: your ad "${l.title}" has been approved.\n\nThe listing fee is ${fee}. ${instructions || 'We will be in touch with how to pay.'}\n\nYour ad goes live on the site as soon as the payment comes through. Please quote ad number ${l.id} with your payment.`;
  return { to, subject: `Your ad is approved: ${l.title} (payment ${fee})`, html: layout(site, 'Your ad is approved', para(body)), text: body };
}

export function listingLiveEmail(site, to, l, url) {
  const body = `Your ad "${l.title}" is now live. Buyers' enquiries will be emailed to you at this address.`;
  return { to, subject: `Your ad is live: ${l.title}`, html: layout(site, 'Your ad is live', para(body) + button(site, url, 'See your ad')), text: `${body}\n\n${url}` };
}

export function listingRejectedEmail(site, to, l, reason) {
  const body = `Thanks for sending in your ad "${l.title}". We aren't able to put it on the site${reason ? `:\n\n${reason}` : '.'}\n\nReply to this email if you have any questions.`;
  return { to, subject: `About your ad: ${l.title}`, html: layout(site, 'About your ad', para(body)), text: body };
}

export function listingEnquiryEmail(site, to, l, e, url) {
  const rows = [['From', e.name], ['Email', e.email], ['Phone', e.phone]].filter(([, v]) => v);
  const html = `<p style="font-size:15px;line-height:1.6;">Someone has asked about your ad <b>${esc(l.title)}</b>. Reply to this email to answer them directly.</p>
    <table style="font-size:15px;line-height:1.5;border-collapse:collapse;">${rows.map(([k, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#6B6858;">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
    ${para(e.message)}${button(site, url, 'See your ad')}`;
  return { to, replyTo: e.email, subject: `Enquiry about your ad: ${l.title}`, html: layout(site, 'A buyer has asked about your horse', html),
    text: `${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${e.message}\n\n${url}` };
}

/* ---------- For Sale → Looking for ---------- */

export function wantedReceivedEmail(site, to, w) {
  const body = `Thanks for telling us what you're looking for: "${w.title}". We check every post before it goes on the site, and let you know when it's up. Sellers' answers will be emailed to you at this address; your contact details are never shown on the site.`;
  return { to, subject: `We've received your post: ${w.title}`, html: layout(site, 'Your post is waiting for review', para(body)), text: body };
}

export function wantedLiveEmail(site, to, w, url) {
  const body = `Your post "${w.title}" is now on the site. When a seller answers, their message is emailed to you here and you can reply to them directly. Let us know when you've found a horse and we'll take it down.`;
  return { to, subject: `Your post is live: ${w.title}`, html: layout(site, 'Your post is live', para(body) + button(site, url, 'See it on the site')), text: `${body}\n\n${url}` };
}

export function wantedRejectedEmail(site, to, w, reason) {
  const body = `Thanks for sending in your post "${w.title}". We aren't able to put it on the site${reason ? `:\n\n${reason}` : '.'}\n\nReply to this email if you have any questions.`;
  return { to, subject: `About your post: ${w.title}`, html: layout(site, 'About your post', para(body)), text: body };
}

export function wantedReplyEmail(site, to, w, r, url) {
  const rows = [['From', r.name], ['Email', r.email], ['Phone', r.phone]].filter(([, v]) => v);
  const html = `<p style="font-size:15px;line-height:1.6;">A seller has answered your post <b>${esc(w.title)}</b>. Reply to this email to answer them directly.</p>
    <table style="font-size:15px;line-height:1.5;border-collapse:collapse;">${rows.map(([k, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#6B6858;">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
    ${para(r.message)}${button(site, url, 'See your post')}`;
  return { to, replyTo: r.email, subject: `A seller has answered: ${w.title}`, html: layout(site, 'A seller may have your horse', html),
    text: `${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${r.message}\n\n${url}` };
}
