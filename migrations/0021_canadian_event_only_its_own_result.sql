-- The HSI article of 28 September 2026 lists ONE result under "Eventing in the Park Canadian Championships":
-- 2nd Kilbunny Kanyou, CCI 2*. Every other result filed under that event was a copy of a South of England
-- result that landed there by mistake. Remove those copies; South of England keeps its own.
DELETE FROM placings WHERE class_id IN (
  SELECT c.id FROM classes c JOIN events e ON e.id = c.event_id
  WHERE e.name = 'Eventing in the Park Canadian Championships' AND e.start_date = '2026-09-25')
  AND NOT (horse_name = 'Kilbunny Kanyou' AND class_id IN (SELECT c.id FROM classes c WHERE c.name = 'CCI 2*'));
DELETE FROM results WHERE event_id IN (
  SELECT id FROM events WHERE name = 'Eventing in the Park Canadian Championships' AND start_date = '2026-09-25')
  AND id NOT IN (SELECT result_id FROM placings WHERE result_id IS NOT NULL);
DELETE FROM classes WHERE event_id IN (
  SELECT id FROM events WHERE name = 'Eventing in the Park Canadian Championships' AND start_date = '2026-09-25')
  AND id NOT IN (SELECT DISTINCT class_id FROM placings);
