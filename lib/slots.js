// Advert slots: every page has a pinned top banner and six side boxes, sold separately.
export const PAGES = [['home', 'Home'], ['results', 'Results'], ['news', 'News'], ['stallions', 'Stallions'], ['forsale', 'For sale'], ['about', 'About']];
export const POSITIONS = [['top', 'Top'], ['left1', 'Left 1'], ['left2', 'Left 2'], ['left3', 'Left 3'], ['right1', 'Right 1'], ['right2', 'Right 2'], ['right3', 'Right 3']];
// "all:left1" is an advert kept in that space on every page (a page's own advert for the space comes first).
export const ALL_PAGES = ['all', 'Every page'];
export const PLACEMENTS = [...PAGES, ALL_PAGES].flatMap(([p]) => POSITIONS.map(([pos]) => `${p}:${pos}`));
export const isPlacement = v => PLACEMENTS.includes(v);
export const placementTier = v => (String(v).endsWith(':top') ? 'large' : 'small');
export function placementName(v) {
  const [page, pos] = String(v).split(':');
  const p = [...PAGES, ALL_PAGES].find(x => x[0] === page), q = POSITIONS.find(x => x[0] === pos);
  return p && q ? `${p[1]} – ${q[1]}` : 'No slot';
}
