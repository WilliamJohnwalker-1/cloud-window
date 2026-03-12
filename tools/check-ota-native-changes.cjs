const { execSync } = require('node:child_process');

const nativeSensitiveMatchers = [
  /^app\.(json|config\.(js|ts))$/,
  /^eas\.json$/,
  /^package(-lock)?\.json$/,
  /^android\//,
  /^ios\//,
  /^assets\/ui\/login-avatar\.png$/,
  /^assets\/ui\/login-avatar\.[a-f0-9]+\.png$/,
];

const run = (command) => execSync(command, { encoding: 'utf8' });

const changedFiles = run('git status --porcelain')
  .split('\n')
  .filter(Boolean)
  .map((line) => line.slice(3).trim().replace(/\\/g, '/'));

const nativeChanged = changedFiles.filter((file) => {
  return nativeSensitiveMatchers.some((matcher) => matcher.test(file));
});

if (nativeChanged.length > 0) {
  console.error('❌ 检测到原生敏感改动，不能仅发布 OTA，请先重新打包 APK/IPA。');
  console.error('涉及文件:');
  nativeChanged.forEach((file) => {
    console.error(`- ${file}`);
  });
  process.exit(1);
}

console.log('✅ 未发现原生敏感改动，可继续发布 OTA。');
