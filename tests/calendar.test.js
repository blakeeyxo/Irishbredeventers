import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectedEvents } from '../functions/api/calendar.js';

test('upcoming events are expected on the same weekday one year on, newest past run first', () => {
  const past = [
    { name: 'Tweseldown One Day Event', country: 'Great Britain', start_date: '2026-03-14', end_date: '2026-03-15', date_text: '14th – 15th March 2026' },
    { name: 'Tweseldown One Day Event', country: 'Great Britain', start_date: '2025-03-15', end_date: '2025-03-16', date_text: '15th – 16th March 2025' },
    { name: 'Burghley International', country: 'Great Britain', start_date: '2026-09-02', end_date: '2026-09-06', date_text: '2nd – 6th September 2026' },
    { name: 'Event heading missing (HSI article 1 June 2026)', country: 'Other', start_date: '2026-06-01', end_date: '', date_text: '' }
  ];
  const out = expectedEvents(past, '2026-10-01');
  assert.deepEqual(out.map(e => [e.name, e.expected_start, e.expected_end, e.based_on]), [
    ['Tweseldown One Day Event', '2027-03-13', '2027-03-14', '14th – 15th March 2026'],
    ['Burghley International', '2027-09-01', '2027-09-05', '2nd – 6th September 2026']
  ]);
  assert.equal(new Date('2027-03-13T00:00:00Z').getUTCDay(), new Date('2026-03-14T00:00:00Z').getUTCDay());
});
