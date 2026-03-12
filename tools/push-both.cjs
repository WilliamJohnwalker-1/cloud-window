const { spawnSync } = require('node:child_process');

const run = (command, args) => {
  const shell = process.platform === 'win32';
  const result = spawnSync(command, args, {
    shell,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
};

const branch = process.argv[2] || 'master';

console.log(`🚀 pushing ${branch} -> origin (gitee)`);
run('git', ['push', 'origin', branch]);

console.log(`🚀 pushing ${branch} -> github`);
run('git', ['push', 'github', branch]);

console.log('✅ dual remote push completed');
