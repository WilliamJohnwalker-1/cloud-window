const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { argv, env } = require('node:process');

const sleep = (ms) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const parseArgs = () => {
  const args = argv.slice(2);
  const pick = (name, fallback = '') => {
    const byEq = args.find((item) => item.startsWith(`${name}=`));
    if (byEq) return byEq.slice(name.length + 1).trim();
    const idx = args.indexOf(name);
    if (idx >= 0 && args[idx + 1]) return String(args[idx + 1]).trim();
    return fallback;
  };

  return {
    buildId: pick('--build-id', env.EAS_BUILD_ID || ''),
    appVersion: pick('--version', env.MOBILE_VERSION || ''),
    bucket: pick('--bucket', env.R2_BUCKET_NAME || 'cloud-window-apk-prod'),
    workerEnv: pick('--worker-env', env.WORKER_ENV || ''),
    workerName: pick('--worker-name', env.WORKER_NAME || 'cloud-window'),
  };
};

const buildWranglerEnvArgs = (workerEnv) => {
  const normalized = String(workerEnv || '').trim();
  return normalized ? ['--env', normalized] : [];
};

const ensureR2BindingConfigured = (workerEnv) => {
  const wranglerConfigPath = join(process.cwd(), 'wrangler.toml');
  const content = readFileSync(wranglerConfigPath, 'utf8');

  const normalized = String(workerEnv || '').trim();
  const hasBindingInAnyScope =
    (content.includes('[[r2_buckets]]') || content.includes('[[env.production.r2_buckets]]') || (normalized ? content.includes(`[[env.${normalized}.r2_buckets]]`) : false))
    && content.includes('binding = "MOBILE_APK_BUCKET"');

  const hasBinding = hasBindingInAnyScope;
  if (!hasBinding) {
    throw new Error(`R2 binding MOBILE_APK_BUCKET not found in wrangler.toml (expected in default or env scopes, current env=${normalized || 'default'})`);
  }
};

const ensureWorkerExists = (workerName, envArgs) => {
  try {
    run('npx', ['wrangler', 'secret', 'list', '--name', workerName, ...envArgs], { capture: true });
  } catch (error) {
    throw new Error(`Target worker not found or inaccessible: ${workerName} ${envArgs.join(' ')}`);
  }
};

const run = (command, commandArgs, options = {}) => {
  const shell = process.platform === 'win32';
  const result = spawnSync(command, commandArgs, {
    shell,
    encoding: 'utf8',
    input: options.input,
    stdio: options.capture ? ['pipe', 'pipe', 'pipe'] : 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    if (options.capture) {
      process.stderr.write(result.stderr || '');
      process.stdout.write(result.stdout || '');
    }
    throw new Error(`${command} ${commandArgs.join(' ')} failed`);
  }

  return result.stdout || '';
};

const extractJson = (raw) => {
  const objectIndex = raw.indexOf('{');
  const arrayIndex = raw.indexOf('[');
  const start = [objectIndex, arrayIndex].filter((index) => index >= 0).sort((a, b) => a - b)[0];
  if (start === undefined) {
    throw new Error(`No JSON found in output: ${raw.slice(0, 200)}`);
  }
  return JSON.parse(raw.slice(start));
};

const getExpoVersionFromAppJson = () => {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const appJson = require('../app.json');
  const version = appJson?.expo?.version;
  if (!version) throw new Error('Cannot read expo.version from app.json');
  return String(version);
};

const getBuildById = (buildId) => {
  const output = run('eas', ['build:view', buildId, '--json'], { capture: true });
  return extractJson(output);
};

const getLatestBuildForVersion = (appVersion) => {
  const output = run('eas', ['build:list', '--platform', 'android', '--limit', '20', '--json'], { capture: true });
  const builds = extractJson(output);
  if (!Array.isArray(builds)) throw new Error('Unexpected build:list JSON format');

  const matched = builds.find((item) => item.platform === 'ANDROID' && item.appVersion === appVersion);
  if (!matched) {
    throw new Error(`No Android build found for appVersion=${appVersion}. Pass --build-id explicitly.`);
  }
  return matched;
};

const waitForFinished = (buildId) => {
  while (true) {
    const build = getBuildById(buildId);
    const status = String(build.status || 'UNKNOWN');
    console.log(`⏳ Build ${buildId} status: ${status}`);

    if (status === 'FINISHED') return build;
    if (status === 'ERRORED' || status === 'CANCELED') {
      throw new Error(`Build ${buildId} ended with status ${status}`);
    }

    sleep(30000);
  }
};

const main = () => {
  const opts = parseArgs();
  const appVersion = opts.appVersion || getExpoVersionFromAppJson();
  const envArgs = buildWranglerEnvArgs(opts.workerEnv);

  ensureR2BindingConfigured(opts.workerEnv);
  ensureWorkerExists(opts.workerName, envArgs);

  let build = null;
  if (opts.buildId) {
    build = getBuildById(opts.buildId);
  } else {
    build = getLatestBuildForVersion(appVersion);
  }

  const buildId = String(build.id);
  const finalBuild = String(build.status) === 'FINISHED' ? build : waitForFinished(buildId);
  const artifactUrl = finalBuild?.artifacts?.applicationArchiveUrl || finalBuild?.artifacts?.buildUrl;
  if (!artifactUrl) {
    throw new Error(`Build ${buildId} has no artifact URL`);
  }

  const apkKey = `inventory-app-${appVersion}.apk`;
  const artifactDir = join(process.cwd(), 'artifacts');
  const artifactFile = join(artifactDir, apkKey);
  mkdirSync(artifactDir, { recursive: true });

  console.log(`📦 Downloading APK from ${artifactUrl}`);
  run('curl', ['-L', artifactUrl, '-o', artifactFile]);

  console.log(`☁️ Uploading APK to R2: ${opts.bucket}/${apkKey}`);
  run('npx', ['wrangler', 'r2', 'object', 'put', `${opts.bucket}/${apkKey}`, '--file', artifactFile, '--remote']);

  console.log('🔐 Updating Worker secrets');
  run('npx', ['wrangler', 'secret', 'put', 'MOBILE_LATEST_VERSION', '--name', opts.workerName, ...envArgs], { input: `${appVersion}\n` });
  run('npx', ['wrangler', 'secret', 'put', 'MOBILE_ANDROID_APK_KEY', '--name', opts.workerName, ...envArgs], { input: `${apkKey}\n` });

  writeFileSync(
    join(artifactDir, `sync-result-${appVersion}.json`),
    JSON.stringify({
      buildId,
      appVersion,
      apkKey,
      bucket: opts.bucket,
      workerName: opts.workerName,
      workerEnv: opts.workerEnv || 'default',
      artifactUrl,
      syncedAt: new Date().toISOString(),
    }, null, 2),
  );

  console.log('✅ R2 上传与 Worker 变量回写完成（按你的流程不执行 wrangler deploy）');
};

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`❌ sync failed: ${message}`);
  process.exit(1);
}
