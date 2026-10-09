/*
 * IrishBredShowjumpingResults (IBSR): the showjumping sister site.
 * Same code as IBER, built into dist/ibsr by scripts/build-site.mjs and deployed as its own Worker
 * (wrangler.jsonc, env "ibsr") with its own database and image bucket.
 *
 * To confirm with Emer: contact details (IBER's for now).
 */
import iber from './iber.js';

export default {
  id: 'ibsr',
  discipline: 'showjumping',
  name: 'IrishBredShowjumpingResults',
  short: 'IBSR',
  publicUrl: 'https://irishbredshowjumpers.emerblakeey.workers.dev',

  // Same colours as IBER (green, white and orange), taken from sites/iber.js so the two always match.
  // (The earlier navy and blue theme was #16233F / #0D1526 / #2A3957 with #3A8DDE, if it's ever wanted again.)
  theme: { ...iber.theme },

  text: {
    title: 'IrishBredShowjumpingResults (IBSR)',
    themeColor: iber.text.themeColor,
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
    aboutPhotoHtml: '<img src="/img/carling-hill.jpg" alt="Carling Hill, an Irish-bred showjumper, clearing a fence" style="object-position: center 18%;">',
    aboutTitle: 'About IrishBred<wbr>Showjumping<wbr>Results',
    aboutHtml: `
      <p>IrishBredShowjumpingResults (IBSR) is the showjumping sister site to IrishBredEventingResults, which has tracked the performance of Irish-bred horses across the world's eventing circuits for close to twenty years.</p>
      <p>IBSR brings that same weekly results service to showjumping: every Irish-bred horse placed in international showjumping, in one permanent, searchable home. It stays independent, stays free for breeders and owners to use, and stays in the same voice as its sister site.</p>
      <p>Every result traces back to the horse's breeding, so a mare sold as a foal is just as easy to find as this week's Grand Prix winner.</p>
      <p>IrishBredShowjumpingResults is run by Charlie, because he truly loves Irish horses and wants to show the world just how special they are.</p>
    `,
    emailLinkHtml: '<a href="mailto:info@iber.ie">info@iber.ie</a>',
    phoneLinkHtml: '<a href="tel:+353872165442">+353 87 216 5442</a>',
    advertiseReach: 'Reach breeders, owners and riders who follow Irish-bred showjumping every week.',
    footTagline: 'Every Irish-bred showjumping result, worldwide.',
    copyright: 'IrishBredShowjumpingResults (IBSR)',
    adminTitle: 'Owner area · IrishBredShowjumpingResults',
    adminFoot: 'IrishBredShowjumpingResults (IBSR) · Owner area',
    otherSiteName: 'IrishBredEventingResults (eventing)'
  },

  favicon: { ...iber.favicon },

  mail: {
    pageBackground: iber.mail.pageBackground,
    topBorder: iber.mail.topBorder,
    heading: iber.mail.heading,
    button: iber.mail.button,
    confirmSubject: 'Confirm your IrishBredShowjumpingResults emails',
    resultsSubject: 'New Irish-bred showjumping results are up'
  }
};
