-- Private, privacy-light analytics for the owner area: one counter per day for visits, page views (by page) and
-- clicks on adverts and link cards. No cookies, IP addresses or personal details are stored.
CREATE TABLE analytics (
  day TEXT NOT NULL,              -- YYYY-MM-DD (UTC)
  kind TEXT NOT NULL,             -- visit | view | ad | link
  key TEXT NOT NULL DEFAULT '',   -- view: the page; ad: advert id|space; link: link card id
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, key)
);
