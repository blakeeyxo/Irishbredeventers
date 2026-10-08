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
      from: env.MAIL_FROM, to: [m.to], subject: m.subject, html: m.html, text: m.text,
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
          to: [{ email: x.to }], subject: x.subject, htmlContent: x.html,
          headers: x.unsubscribeUrl ? { 'List-Unsubscribe': `<${x.unsubscribeUrl}>` } : undefined
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

function layout(site, title, inner, unsubscribeUrl) {
  const m = site.mail;
  return `<!doctype html><html><body style="margin:0;background:${m.pageBackground};font-family:Arial,Helvetica,sans-serif;color:#1C1B17;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-top:4px solid ${m.topBorder};padding:28px 28px 24px;">
  <div style="font-family:Georgia,serif;font-size:24px;font-weight:bold;color:${m.heading};margin-bottom:18px;">${esc(site.name)}</div>
  <h1 style="font-family:Georgia,serif;font-size:20px;color:${m.heading};margin:0 0 12px;">${esc(title)}</h1>
  ${inner}
  ${unsubscribeUrl ? `<p style="font-size:12px;color:#6B6858;margin-top:28px;border-top:1px solid #D9D2B8;padding-top:12px;">You get this because you signed up for results emails. <a href="${esc(unsubscribeUrl)}" style="color:#6B6858;">Unsubscribe</a></p>` : ''}
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
    text: `${summary}\n\nSee the results: ${resultsUrl}\n\nUnsubscribe: ${unsubscribeUrl}`
  };
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
