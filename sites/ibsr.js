/*
 * IrishBredShowjumpingResults (IBSR): the showjumping sister site.
 * Same code as IBER, built into dist/ibsr by scripts/build-site.mjs and deployed as its own Worker
 * (wrangler.jsonc, env "ibsr") with its own database and image bucket.
 *
 * To confirm with Emer: contact details (IBER's for now), the About text, and an About photo.
 */
export default {
  id: 'ibsr',
  discipline: 'showjumping',
  name: 'IrishBredShowjumpingResults',
  short: 'IBSR',
  publicUrl: 'https://irishbredshowjumpers.emerblakeey.workers.dev',

  // Navy values from the original demo (reference/irishbredeventers-mockup-v2.html), plus a brighter blue
  // for stripes, underlines and focus rings (4.5:1 on the navy header, 3.5:1 on white).
  theme: {
    '--navy': '#16233F',
    '--navy-deep': '#0D1526',
    '--navy-soft': '#2A3957',
    '--gold': '#2A3957',
    '--gold-bright': '#3A8DDE',
    '--gold-bright-rgb': '58, 141, 222',
    '--gold-pale': '#FFFFFF',
    '--cream': '#FFFFFF',
    '--cream-2': '#F2F4F8',
    '--paper': '#FFFFFF',
    '--ink': '#1C1B17',
    '--ink-soft': '#46443C',
    '--ink-faint': '#6E6A5C',
    '--rule': '#E1E5EC',
    '--rule-strong': '#C9CEDA',
    '--alert': '#9E1B2F',
    '--chip-empty-active': '#E3EEFB'
  },

  text: {
    title: 'IrishBredShowjumpingResults (IBSR)',
    themeColor: '#16233F',
    description: 'IrishBredShowjumpingResults (IBSR): every Irish-bred showjumping result worldwide, searchable by horse, sire, dam, dam sire and breeder.',
    ogDescription: 'Every Irish-bred showjumping result worldwide, with breeding and breeder.',
    homeLabel: 'IrishBredShowjumpingResults home',
    nameHtml: 'IrishBred<wbr><span>Showjumping</span><wbr>Results',
    footNameHtml: 'IrishBred<span>Showjumping</span>Results',
    adminNameHtml: 'IrishBred<span>Showjumping</span>Results',
    heroHeadline: 'Irish-bred showjumping results, every week',
    heroCopy: 'Every Irish-bred horse placed in international showjumping, with its breeding and breeder.',
    legendScore: 'Faults, then time. Fewest faults wins; time separates horses on the same faults.',
    correctionExample: 'e.g. Dublin Horse Show, CSIO5* Grand Prix',
    aboutPhotoHtml: '',
    aboutTitle: 'About IrishBred<wbr>Showjumping<wbr>Results',
    aboutHtml: `
      <p>IrishBredShowjumpingResults (IBSR) is the showjumping sister site to IrishBredEventingResults. It lists Irish-bred horses placed in international showjumping, with their breeding and breeder.</p>
      <p>Results are free for breeders and owners to use, and every result traces back to the horse's sire, dam and breeder.</p>
    `,
    emailLinkHtml: '<a href="mailto:info@iber.ie">info@iber.ie</a>',
    phoneLinkHtml: '<a href="tel:+353872165442">+353 87 216 5442</a>',
    advertiseReach: 'Reach breeders, owners and riders who follow Irish-bred showjumping every week.',
    footTagline: 'Every Irish-bred showjumping result, worldwide.',
    copyright: 'IrishBredShowjumpingResults (IBSR)',
    adminTitle: 'Owner area · IrishBredShowjumpingResults',
    adminFoot: 'IrishBredShowjumpingResults (IBSR) · Owner area'
  },

  favicon: { background: '#16233F', stripe: '#3A8DDE' },

  mail: {
    pageBackground: '#F2F4F8',
    topBorder: '#3A8DDE',
    heading: '#16233F',
    button: '#16233F',
    confirmSubject: 'Confirm your IrishBredShowjumpingResults emails',
    resultsSubject: 'New Irish-bred showjumping results are up'
  }
};
