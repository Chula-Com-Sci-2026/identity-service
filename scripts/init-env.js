const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const file = path.join(__dirname, '../config/config.env');
if (fs.existsSync(file)) {
  console.log('Existing config/config.env preserved; compare it with config.env.example before starting.');
} else {
  let content = fs.readFileSync(path.join(__dirname, '../config/config.env.example'), 'utf8');
  const values = { DB_PASSWORD: crypto.randomBytes(32).toString('hex'), BROKER_PASSWORD: crypto.randomBytes(32).toString('hex'), ACCESS_TOKEN_SECRET: crypto.randomBytes(32).toString('hex'), REFRESH_TOKEN_SECRET: crypto.randomBytes(32).toString('hex') };
  for (const [key,value] of Object.entries(values)) content = content.replace(new RegExp('^'+key+'=.*$', 'm'), key+'='+value);
  content = content.replace(/^RABBITMQ_URL=.*$/m, `RABBITMQ_URL=amqp://identity:${values.BROKER_PASSWORD}@rabbitmq:5672`);
  fs.writeFileSync(file, content, { mode: 0o600 });
  console.log('Created ignored local configuration with random secrets.');
}
