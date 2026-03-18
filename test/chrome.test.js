import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, chmodSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Create a fake chrome-headless-shell binary
function createFakeBin(dir, version, { corrupt = false } = {}) {
  const versionDir = join(dir, `chrome-headless-shell-${version}`);
  mkdirSync(versionDir, { recursive: true });
  const binPath = join(versionDir, 'chrome-headless-shell');
  if (corrupt) {
    writeFileSync(binPath, 'CORRUPT_BINARY_DATA');
    chmodSync(binPath, 0o755);
  } else {
    writeFileSync(binPath, `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "HeadlessChrome/${version}"
  exit 0
fi
exit 0
`);
    chmodSync(binPath, 0o755);
  }
  return binPath;
}

test('corrupt binary fails --version check', () => {
  const dir = join(tmpdir(), `casty-test-${Date.now()}-corrupt`);
  mkdirSync(dir, { recursive: true });
  try {
    createFakeBin(dir, '146.0.7680.80', { corrupt: true });
    const binPath = join(dir, 'chrome-headless-shell-146.0.7680.80', 'chrome-headless-shell');

    let threw = false;
    try {
      execFileSync(binPath, ['--version'], { stdio: 'pipe', timeout: 5000 });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'corrupt binary should fail --version');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('valid binary passes --version check', () => {
  const dir = join(tmpdir(), `casty-test-${Date.now()}-valid`);
  mkdirSync(dir, { recursive: true });
  try {
    const binPath = createFakeBin(dir, '146.0.7680.80');
    const output = execFileSync(binPath, ['--version'], { encoding: 'utf8', timeout: 5000 });
    assert.ok(output.includes('146.0.7680.80'), 'should output version string');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unzip failure is detectable by exit code', () => {
  let threw = false;
  try {
    execFileSync('unzip', ['-q', '/nonexistent.zip', '-d', '/tmp'], { stdio: 'pipe' });
  } catch {
    threw = true;
  }
  assert.ok(threw, 'unzip with nonexistent file should fail');
});
