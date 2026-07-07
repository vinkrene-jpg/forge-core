import test from 'node:test';
import assert from 'node:assert';
import { summarize } from '../index.js';
test('summarize counts per actor', () => {
  assert.deepStrictEqual(summarize([{actor:'a'},{actor:'a'},{actor:'b'}]), {a:2,b:1});
});
