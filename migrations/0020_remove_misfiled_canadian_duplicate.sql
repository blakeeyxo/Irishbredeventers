-- Ballybolger Lionman's 7th (Open Intermediate Sec O) was listed twice on the live site:
-- once under South of England (correct, Great Britain) and once under the Canadian Championships.
-- Remove the stray copy only where the same horse + class + score also exists under the UK event.
DELETE FROM placings WHERE id IN (
  SELECT p.id FROM placings p
  JOIN classes c ON c.id = p.class_id
  JOIN events e ON e.id = c.event_id
  WHERE e.name = 'Eventing in the Park Canadian Championships' AND e.start_date = '2026-09-25'
    AND c.name = 'Open Intermediate Sec O' AND p.horse_name = 'Ballybolger Lionman'
    AND EXISTS (SELECT 1 FROM placings p2 JOIN classes c2 ON c2.id = p2.class_id JOIN events e2 ON e2.id = c2.event_id
                WHERE e2.name = 'South of England International and One Day Event' AND e2.start_date = '2026-09-25'
                  AND c2.name = c.name AND p2.horse_name = p.horse_name AND p2.score = p.score)
);
DELETE FROM results WHERE id IN (
  SELECT r.id FROM results r JOIN events e ON e.id = r.event_id JOIN horses h ON h.id = r.horse_id
  WHERE e.name = 'Eventing in the Park Canadian Championships' AND e.start_date = '2026-09-25'
    AND r.class_name = 'Open Intermediate Sec O' AND h.name = 'Ballybolger Lionman'
    AND EXISTS (SELECT 1 FROM results r2 JOIN events e2 ON e2.id = r2.event_id
                WHERE e2.name = 'South of England International and One Day Event' AND e2.start_date = '2026-09-25'
                  AND r2.class_name = r.class_name AND r2.horse_id = r.horse_id)
);
DELETE FROM classes WHERE name = 'Open Intermediate Sec O'
  AND event_id IN (SELECT id FROM events WHERE name = 'Eventing in the Park Canadian Championships' AND start_date = '2026-09-25')
  AND NOT EXISTS (SELECT 1 FROM placings p WHERE p.class_id = classes.id);
