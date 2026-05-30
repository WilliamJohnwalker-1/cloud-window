const { spawnSync } = require('node:child_process');

const run = (command, args) => {
  const shell = process.platform === 'win32';
  const result = spawnSync(command, args, {
    shell,
    stdio: 'inherit',
    env: process.env,
  });
  return result.status || 0;
};

const branch = process.argv[2] || 'master';

console.log(`🚀 pushing ${branch} -> origin (gitee)`);
const originStatus = run('git', ['push', 'origin', branch]);
if (originStatus !== 0) {
  process.exit(originStatus);
}

console.log(`🚀 pushing ${branch} -> github`);
const githubStatus = run('git', ['push', 'github', branch]);
if (githubStatus !== 0) {
  console.log('⚠️ github push failed (single attempt, no retry). Please report and hand off for manual push.');
  process.exit(githubStatus);
}

console.log('✅ dual remote push completed');
