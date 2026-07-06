const fs = require('fs');
const m = JSON.parse(fs.readFileSync('module-manifest.json', 'utf8'));
if (m.name !== 'ai-guardian-reviewer') { console.error('FAIL: manifest name'); process.exit(1); }
if (!m.version || !m.entry) { console.error('FAIL: manifest incomplete'); process.exit(1); }
if (process.env.DATABASE_URL || process.env.SESSION_SECRET) { console.error('SECURITY FAIL: secrets visible'); process.exit(1); }
console.log('self-check passed for ai-guardian-reviewer');
