import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAgeDays, formatAge } from '../../src/cli/format.js';

const now = Date.parse('2026-08-02T00:00:00.000Z');

test('formats ages in words', () => {
  assert.equal(formatAge('2026-08-01T23:59:45.000Z', now), 'just now');
  assert.equal(formatAge('2026-08-01T23:00:00.000Z', now), '1 hour ago');
  assert.equal(formatAge('2026-07-12T00:00:00.000Z', now), '21 days ago');
  assert.equal(formatAge('2025-08-02T00:00:00.000Z', now), '1 year ago');
  assert.equal(formatAge(undefined, now), 'unknown');
  assert.equal(calculateAgeDays('2026-07-05T00:00:00.000Z', now), 28);
});
