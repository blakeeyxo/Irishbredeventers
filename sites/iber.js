/*
 * IrishBredEventingResults (IBER): the eventing site.
 * These values are exactly what public/ already holds. `npm test` builds IBER from this file and checks the
 * result matches public/ byte for byte, so the eventing site cannot drift from its config (or the other way round).
 */
export default {
  id: 'iber',
  discipline: 'eventing',
  name: 'IrishBredEventingResults',
  short: 'IBER',

  // CSS tokens in public/css/site.css (:root). Only values change between sites, never the names.
  theme: {
    '--navy': '#0F6741',
    '--navy-deep': '#0F6741',
    '--navy-soft': '#0F6741',
    '--gold': '#0F6741',
    '--gold-bright': '#FF883E',
    '--gold-bright-rgb': '255, 136, 62',
    '--gold-pale': '#FFFFFF',
    '--cream': '#FFFFFF',
    '--cream-2': '#F3F4F2',
    '--paper': '#FFFFFF',
    '--ink': '#1C1B17',
    '--ink-soft': '#46443C',
    '--ink-faint': '#6E6A5C',
    '--rule': '#E3E5E2',
    '--rule-strong': '#C9CDC8',
    '--alert': '#9E1B2F',
    '--chip-empty-active': '#FFE6D5'
  },

  // Words and markup placed into elements marked data-site="key" (inner HTML) or data-site-attr="attr=key".
  text: {
    title: 'IrishBredEventingResults (IBER)',
    themeColor: '#0F6741',
    description: 'IrishBredEventingResults (IBER): every Irish-bred eventing result worldwide, searchable by horse, sire, dam, dam sire and breeder.',
    ogDescription: 'Every Irish-bred eventing result worldwide, with breeding and breeder.',
    homeLabel: 'IrishBredEventingResults home',
    nameHtml: 'IrishBred<wbr><span>Eventing</span><wbr>Results',
    footNameHtml: 'IrishBred<span>Eventing</span>Results',
    adminNameHtml: 'IrishBred<span>Eventing</span>Results',
    heroHeadline: 'Irish-bred eventing results, every week',
    heroCopy: 'Every Irish-bred horse placed in eventing worldwide, with its breeding and breeder.',
    legendScore: 'Dressage, show jumping and cross country penalties, then the final score. Lowest wins.',
    correctionExample: 'e.g. Thoresby, CCI4*-S Section G',
    aboutPhotoHtml: '<img src="/img/xc-jump.jpg" alt="An Irish-bred horse jumping a cross-country fence">',
    aboutTitle: 'About IrishBredEventingResults',
    aboutHtml: `
      <p>IrishBredEventingResults (IBER) has tracked the performance of Irish-bred horses across the world's eventing circuits for close to twenty years — first as a set of spreadsheets, then as weekly posts on Horse Sport Ireland and The Irish Field, read by thousands of breeders, owners and riders every week.</p>
      <p>This site is that same weekly results service, given a permanent, searchable home. It stays independent, stays free for breeders and owners to use, and stays in the same voice it's always had.</p>
      <p>Every result traces back to the horse's breeding, so a mare sold as a foal in 2009 is just as easy to find as this week's winner.</p>
    `,
    emailLinkHtml: '<a href="mailto:info@iber.ie">info@iber.ie</a>',
    phoneLinkHtml: '<a href="tel:+353872165442">+353 87 216 5442</a>',
    advertiseReach: 'Reach breeders, owners and riders who follow Irish-bred eventing every week.',
    footTagline: 'Every Irish-bred eventing result, worldwide.',
    copyright: 'IrishBredEventingResults (IBER)',
    adminTitle: 'Owner area · IrishBredEventingResults',
    adminFoot: 'IrishBredEventingResults (IBER) · Owner area'
  },

  // Favicon: a rounded square in the header colour with the highlight stripe along the bottom.
  favicon: { background: '#0F6741', stripe: '#FF883E' },

  // Results emails (lib/mail.js).
  mail: {
    pageBackground: '#F6F3E9',
    topBorder: '#B01029',
    heading: '#0F6741',
    button: '#0F6741',
    confirmSubject: 'Confirm your IrishBredEventingResults emails',
    resultsSubject: 'New Irish-bred eventing results are up'
  }
};
