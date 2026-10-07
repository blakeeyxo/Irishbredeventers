-- The site never presents itself as a Facebook round-up: Charlie's articles are credited to Charlie Ripman only.
UPDATE news SET source_name = 'Charlie Ripman' WHERE source_name = 'Charlie Ripman on Facebook';
UPDATE link_cards SET source_name = 'Charlie Ripman' WHERE source_name = 'Charlie Ripman on Facebook';
