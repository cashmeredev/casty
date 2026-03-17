import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const moduleUrl = new URL('../lib/kitty.js', import.meta.url);
const CURSOR_HOME = '\x1b[2;1H';

function tmuxWrap(seq) {
  return `\x1bPtmux;${seq.replaceAll('\x1b', '\x1b\x1b')}\x1b\\`;
}

async function withKitty(env, fn) {
  const saved = {
    TMUX: process.env.TMUX,
    TERM_PROGRAM: process.env.TERM_PROGRAM,
  };

  if (env.TMUX === undefined) delete process.env.TMUX;
  else process.env.TMUX = env.TMUX;

  if (env.TERM_PROGRAM === undefined) delete process.env.TERM_PROGRAM;
  else process.env.TERM_PROGRAM = env.TERM_PROGRAM;

  const mod = await import(`${moduleUrl.href}?test=${Date.now()}-${Math.random()}`);

  try {
    return await fn(mod);
  } finally {
    if (saved.TMUX === undefined) delete process.env.TMUX;
    else process.env.TMUX = saved.TMUX;

    if (saved.TERM_PROGRAM === undefined) delete process.env.TERM_PROGRAM;
    else process.env.TERM_PROGRAM = saved.TERM_PROGRAM;
  }
}

function captureStdout(fn) {
  const chunks = [];
  const originalWrite = process.stdout.write;

  process.stdout.write = (chunk, encoding, callback) => {
    const text = typeof chunk === 'string'
      ? chunk
      : chunk.toString(typeof encoding === 'string' ? encoding : undefined);
    chunks.push(text);

    if (typeof encoding === 'function') encoding();
    if (typeof callback === 'function') callback();
    return true;
  };

  try {
    fn();
    return chunks.join('');
  } finally {
    process.stdout.write = originalWrite;
  }
}

test('clearScreen keeps raw kitty output outside tmux', async () => {
  await withKitty({}, (kitty) => {
    const output = captureStdout(() => kitty.clearScreen());
    assert.equal(output, '\x1b_Ga=d,d=A,q=2;\x1b\\\x1b[2J\x1b[H');
  });
});

test('clearScreen wraps kitty delete sequence for tmux passthrough', async () => {
  await withKitty({ TMUX: '/tmp/tmux-1/default,1,0' }, (kitty) => {
    const output = captureStdout(() => kitty.clearScreen());
    assert.equal(output, `${tmuxWrap('\x1b_Ga=d,d=A,q=2;\x1b\\')}\x1b[2J\x1b[H`);
  });
});

test('sendFrame emits raw inline kitty graphics outside tmux', async () => {
  await withKitty({}, (kitty) => {
    kitty.setDisplaySize(10, 5);
    const output = captureStdout(() => kitty.sendFrame('abc'));
    assert.equal(output, `${CURSOR_HOME}\x1b_Ga=T,f=100,q=2,C=1,i=1,c=10,r=5;abc\x1b\\`);
  });
});

test('sendFrame wraps chunked inline kitty graphics for tmux', async () => {
  await withKitty({ TMUX: '/tmp/tmux-1/default,1,0' }, (kitty) => {
    kitty.setDisplaySize(10, 5);
    const payload = 'a'.repeat(5000);
    const sequence = [
      `\x1b_Ga=T,f=100,q=2,C=1,i=1,c=10,r=5,m=1;${payload.slice(0, 4096)}\x1b\\`,
      `\x1b_Gm=0;${payload.slice(4096)}\x1b\\`,
    ].join('');

    const output = captureStdout(() => kitty.sendFrame(payload));
    assert.equal(output, `${CURSOR_HOME}${tmuxWrap(sequence)}`);
  });
});

test('sendFrame wraps file transfer mode for tmux', async () => {
  await withKitty({ TMUX: '/tmp/tmux-1/default,1,0', TERM_PROGRAM: 'kitty' }, (kitty) => {
    kitty.setDisplaySize(10, 5);
    const tmpPathB64 = Buffer.from(join(tmpdir(), `casty-frame-${process.pid}.png`)).toString('base64');
    const output = captureStdout(() => kitty.sendFrame('YWJj'));

    assert.equal(
      output,
      `${CURSOR_HOME}${tmuxWrap(`\x1b_Ga=T,f=100,t=f,q=2,C=1,i=1,c=10,r=5;${tmpPathB64}\x1b\\`)}`,
    );

    kitty.cleanup();
  });
});
