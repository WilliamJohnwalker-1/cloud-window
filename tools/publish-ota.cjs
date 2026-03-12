const { spawnSync } = require('node:child_process');

const parseMessage = () => {
  const args = process.argv.slice(2);
  const msgByLong = args.find((arg) => arg.startsWith('--msg='));
  const msgByShort = args.find((arg) => arg.startsWith('-m='));
  const indexLong = args.indexOf('--msg');
  const indexShort = args.indexOf('-m');

  if (msgByLong) return msgByLong.slice('--msg='.length).trim();
  if (msgByShort) return msgByShort.slice('-m='.length).trim();
  if (indexLong >= 0 && args[indexLong + 1]) return String(args[indexLong + 1]).trim();
  if (indexShort >= 0 && args[indexShort + 1]) return String(args[indexShort + 1]).trim();

  const envMessage = process.env.OTA_MESSAGE || process.env.OTA_MSG;
  if (envMessage) return String(envMessage).trim();

  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return `mobile ota: routine update ${now}`;
};

const run = (command, args) => {
  const shell = process.platform === 'win32';
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell,
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
};

const message = parseMessage();

console.log('🚦 Checking native-sensitive changes before OTA...');
run('npm', ['run', 'ota:check-native']);

console.log('🚀 Publishing OTA update...');
run('eas', [
  'update',
  '--environment',
  'production',
  '--channel',
  'production',
  '--message',
  message,
]);
