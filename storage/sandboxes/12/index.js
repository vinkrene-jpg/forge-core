#!/usr/bin/env node
// forge-console — local operator console for Forge.
// Local only: no production actions, no VPS actions, never prints secrets.
import { execFile } from 'node:child_process';

const BASE = process.env.FORGE_BASE_URL || 'http://localhost:5000';
const NOISE = [/GET \/api\/healthz/, /\"url\":\"\/api\/healthz\"/];
const SECRET = /((?:api[_-]?key|token|secret|password|authorization)[\"'=:\s]+)([^\s\"',;]+)/gi;
const FORBIDDEN = ['deploy', 'production', 'vps', 'ssh'];

export function isNoise(line) {
  return NOISE.some((re) => re.test(line));
}

export function redactSecrets(line) {
  return line.replace(SECRET, '$1[REDACTED]');
}

export function filterLogs(lines, { errorsOnly = false } = {}) {
  return lines
    .filter((l) => !isNoise(l))
    .filter((l) => (errorsOnly ? /(error|fatal|exception|failed)/i.test(l) : true))
    .map(redactSecrets);
}

export function routeCommand(cmd) {
  if (FORBIDDEN.includes(String(cmd).toLowerCase())) {
    throw new Error(`Command '${cmd}' is not allowed: forge-console performs local operations only.`);
  }
  const routes = { start: 'compose-up', stop: 'compose-down', status: 'status', health: 'health', db: 'db-status', logs: 'logs', open: 'open-dashboard' };
  const target = routes[cmd];
  if (!target) throw new Error(`Unknown command '${cmd}'. Available: ${Object.keys(routes).join(', ')}`);
  return target;
}

async function getJson(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

function sh(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => (err ? reject(new Error(redactSecrets(String(stderr || err.message)))) : resolve(redactSecrets(String(stdout)))));
  });
}

export async function run(cmd, log = console.log) {
  const target = routeCommand(cmd);
  switch (target) {
    case 'compose-up': log(await sh('docker', ['compose', 'up', '-d'])); log('Forge started.'); break;
    case 'compose-down': log(await sh('docker', ['compose', 'stop'])); log('Forge stopped.'); break;
    case 'health': { const h = await getJson('/api/healthz'); log(`health: ${h.status} | database: ${h.database} | storage: ${h.storage}`); break; }
    case 'db-status': { const h = await getJson('/api/healthz'); log(`database: ${h.database}`); break; }
    case 'status': { const h = await getJson('/api/healthz'); const s = await getJson('/api/evolution/status'); log(`service: ${h.status} | db: ${h.database} | capabilities: ${s.capabilities.working}/${s.capabilities.total} working | gaps: ${s.gaps} | pending approvals: ${s.pendingApprovals}`); break; }
    case 'logs': { const out = await sh('docker', ['compose', 'logs', '--tail', '200']); filterLogs(out.split('\n'), { errorsOnly: process.argv.includes('--errors') }).forEach((l) => log(l)); break; }
    case 'open-dashboard': log(`Dashboard: ${BASE}/`); break;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv[2] || 'status').catch((e) => { console.error(redactSecrets(e.message)); process.exit(1); });
}
