import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNoise, redactSecrets, filterLogs, routeCommand } from './index.js';

test('healthz polling lines are treated as noise', () => {
  assert.ok(isNoise('GET /api/healthz 200 1ms'));
  assert.ok(!isNoise('POST /api/evolution/run 201'));
});

test('secret-like values are redacted', () => {
  const out = redactSecrets('using api_key=sk-abc123 for request');
  assert.ok(!out.includes('sk-abc123'));
  assert.ok(out.includes('[REDACTED]'));
});

test('filterLogs drops noise and can isolate errors', () => {
  const lines = ['GET /api/healthz 200', 'ERROR db connection failed', 'info startup complete'];
  assert.deepEqual(filterLogs(lines, { errorsOnly: true }), ['ERROR db connection failed']);
  assert.equal(filterLogs(lines).length, 2);
});

test('production and VPS actions are refused', () => {
  assert.throws(() => routeCommand('deploy'), /local operations only/);
  assert.throws(() => routeCommand('vps'), /local operations only/);
});

test('known commands route, unknown rejected', () => {
  assert.equal(routeCommand('start'), 'compose-up');
  assert.equal(routeCommand('logs'), 'logs');
  assert.throws(() => routeCommand('nonsense'), /Unknown command/);
});
