import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatLesson } from './index.js';

test('formats a lesson', () => {
  const l = formatLesson(7, 'passed');
  assert.equal(l.title, 'Run #7: passed');
  assert.ok(l.recordedAt);
});

test('rejects bad runId', () => {
  assert.throws(() => formatLesson('x', 'y'), TypeError);
});
