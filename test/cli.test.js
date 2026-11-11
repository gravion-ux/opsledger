import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE, main, parseFlags } from '../src/cli.js';

function capture() {
  const chunks = [];
  return {
    write(text) {
      chunks.push(text);
      return true;
    },
    text() {
      return chunks.join('');
    },
  };
}

function workspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'opsledger-cli-'));
  return { root, dir: path.join(root, 'CONTOSO-2026-11') };
}

function sourceFile(root, name, content) {
  const target = path.join(root, name);
  writeFileSync(target, content, 'utf8');
  return target;
}

function run(args) {
  const out = capture();
  const code = main(args, out);
  return { code, out: out.text() };
}

test('parseFlags reads flags and positional values', () => {
  const { flags, positional } = parseFlags(['--dir', 'ENGAGEMENT', 'extra', '--note=hello world']);
  assert.equal(flags.dir, 'ENGAGEMENT');
  assert.equal(flags.note, 'hello world');
  assert.deepEqual(positional, ['extra']);
});

test('parseFlags treats a flag without a value as true', () => {
  const { flags } = parseFlags(['--sign-key-env']);
  assert.equal(flags['sign-key-env'], true);
});

test('no command prints the usage and is a usage error', () => {
  const { code, out } = run([]);
  assert.equal(code, EXIT_USAGE);
  assert.ok(out.includes('opsledger init'));
});

test('help prints the usage and succeeds', () => {
  const { code, out } = run(['help']);
  assert.equal(code, EXIT_OK);
  assert.ok(out.includes('opsledger verify'));
});

test('an unknown command is a usage error', () => {
  const { code } = run(['frobnicate']);
  assert.equal(code, EXIT_USAGE);
});

test('init creates the engagement directory', () => {
  const { dir } = workspace();
  const { code, out } = run(['init', '--dir', dir]);
  assert.equal(code, EXIT_OK);
  assert.ok(existsSync(path.join(dir, 'ledger.json')));
  assert.ok(existsSync(path.join(dir, 'manifest.json')));
  assert.ok(existsSync(path.join(dir, 'artifacts')));
  assert.ok(out.includes('CONTOSO-2026-11'));
});

test('init without a directory is a usage error', () => {
  const { code } = run(['init']);
  assert.equal(code, EXIT_USAGE);
});

test('init over an existing ledger fails', () => {
  const { dir } = workspace();
  run(['init', '--dir', dir]);
  const { code } = run(['init', '--dir', dir]);
  assert.equal(code, EXIT_FAILURE);
});

test('init with a key environment variable that is not set fails', () => {
  const { dir } = workspace();
  const { code, out } = run(['init', '--dir', dir, '--sign-key-env', 'OPSLEDGER_MISSING_KEY']);
  assert.equal(code, EXIT_FAILURE);
  assert.ok(out.includes('not set'));
});

test('init with a key environment variable signs the ledger', () => {
  const { dir } = workspace();
  process.env.OPSLEDGER_TEST_KEY = 'secret-key';
  const { code, out } = run(['init', '--dir', dir, '--sign-key-env', 'OPSLEDGER_TEST_KEY']);
  delete process.env.OPSLEDGER_TEST_KEY;
  assert.equal(code, EXIT_OK);
  assert.ok(out.includes('signed'));
  const ledger = JSON.parse(readFileSync(path.join(dir, 'ledger.json'), 'utf8'));
  assert.match(ledger.signature, /^[0-9a-f]{64}$/);
});

test('artifact add registers a file', () => {
  const { root, dir } = workspace();
  run(['init', '--dir', dir]);
  const source = sourceFile(root, 'transcript.txt', 'hello evidence');
  const { code, out } = run([
    'artifact',
    'add',
    '--dir',
    dir,
    '--path',
    source,
    '--classification',
    'confidential',
    '--note',
    'recon transcript',
  ]);
  assert.equal(code, EXIT_OK);
  assert.ok(out.includes('art-001'));
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.artifacts.length, 1);
  assert.equal(manifest.artifacts[0].classification, 'confidential');
});

test('artifact add without a path is a usage error', () => {
  const { dir } = workspace();
  run(['init', '--dir', dir]);
  const { code } = run(['artifact', 'add', '--dir', dir]);
  assert.equal(code, EXIT_USAGE);
});

test('artifact add with an unknown classification fails', () => {
  const { root, dir } = workspace();
  run(['init', '--dir', dir]);
  const source = sourceFile(root, 'transcript.txt', 'hello');
  const { code, out } = run([
    'artifact',
    'add',
    '--dir',
    dir,
    '--path',
    source,
    '--classification',
    'top-secret',
  ]);
  assert.equal(code, EXIT_FAILURE);
  assert.ok(out.includes('unknown classification'));
});

test('artifact add without a subcommand is a usage error', () => {
  const { code } = run(['artifact', '--dir', 'x']);
  assert.equal(code, EXIT_USAGE);
});

test('event add records an event', () => {
  const { dir } = workspace();
  run(['init', '--dir', dir]);
  const { code, out } = run([
    'event',
    'add',
    '--dir',
    dir,
    '--type',
    'action',
    '--summary',
    'port scan of the edge host',
    '--actor',
    'operator',
  ]);
  assert.equal(code, EXIT_OK);
  assert.ok(out.includes('recorded event 0'));
  const ledger = JSON.parse(readFileSync(path.join(dir, 'ledger.json'), 'utf8'));
  assert.equal(ledger.events.length, 1);
  assert.equal(ledger.events[0].summary, 'port scan of the edge host');
});

test('event add with an unknown type is a usage error', () => {
  const { dir } = workspace();
  run(['init', '--dir', dir]);
  const { code, out } = run(['event', 'add', '--dir', dir, '--type', 'wat', '--summary', 'x']);
  assert.equal(code, EXIT_USAGE);
  assert.ok(out.includes('unknown event type'));
});

test('event add without a summary is a usage error', () => {
  const { dir } = workspace();
  run(['init', '--dir', dir]);
  const { code } = run(['event', 'add', '--dir', dir, '--type', 'action']);
  assert.equal(code, EXIT_USAGE);
});

test('verify succeeds on an intact ledger', () => {
  const { dir } = workspace();
  run(['init', '--dir', dir]);
  run(['event', 'add', '--dir', dir, '--type', 'action', '--summary', 'x']);
  const { code, out } = run(['verify', '--dir', dir]);
  assert.equal(code, EXIT_OK);
  assert.ok(out.includes('chain INTACT'));
});

test('verify fails on a tampered ledger', () => {
  const { dir } = workspace();
  run(['init', '--dir', dir]);
  run(['event', 'add', '--dir', dir, '--type', 'action', '--summary', 'x']);
  const target = path.join(dir, 'ledger.json');
  const ledger = JSON.parse(readFileSync(target, 'utf8'));
  ledger.events[0].summary = 'tampered';
  writeFileSync(target, JSON.stringify(ledger, null, 2), 'utf8');
  const { code, out } = run(['verify', '--dir', dir]);
  assert.equal(code, EXIT_FAILURE);
  assert.ok(out.includes('chain BROKEN'));
});

test('verify without a directory is a usage error', () => {
  const { code } = run(['verify']);
  assert.equal(code, EXIT_USAGE);
});

test('verify on a missing engagement fails', () => {
  const { root } = workspace();
  const { code, out } = run(['verify', '--dir', path.join(root, 'nope')]);
  assert.equal(code, EXIT_FAILURE);
  assert.ok(out.includes('no engagement ledger'));
});

test('verify reports a missing key environment variable', () => {
  const { dir } = workspace();
  run(['init', '--dir', dir]);
  const { code, out } = run(['verify', '--dir', dir, '--key-env', 'OPSLEDGER_MISSING_KEY']);
  assert.equal(code, EXIT_FAILURE);
  assert.ok(out.includes('not set'));
});

test('a signed ledger cannot be changed without the key', () => {
  const { dir } = workspace();
  process.env.OPSLEDGER_TEST_KEY = 'secret-key';
  run(['init', '--dir', dir, '--sign-key-env', 'OPSLEDGER_TEST_KEY']);
  const { code, out } = run(['event', 'add', '--dir', dir, '--type', 'action', '--summary', 'x']);
  delete process.env.OPSLEDGER_TEST_KEY;
  assert.equal(code, EXIT_FAILURE);
  assert.ok(out.includes('signed'));
});

test('a signed ledger can be changed with the key', () => {
  const { dir } = workspace();
  process.env.OPSLEDGER_TEST_KEY = 'secret-key';
  run(['init', '--dir', dir, '--sign-key-env', 'OPSLEDGER_TEST_KEY']);
  const { code } = run([
    'event',
    'add',
    '--dir',
    dir,
    '--type',
    'action',
    '--summary',
    'x',
    '--sign-key-env',
    'OPSLEDGER_TEST_KEY',
  ]);
  delete process.env.OPSLEDGER_TEST_KEY;
  assert.equal(code, EXIT_OK);
});

test('the signing key is never echoed into the output', () => {
  const { dir } = workspace();
  process.env.OPSLEDGER_TEST_KEY = 'super-secret-key-value';
  const init = run(['init', '--dir', dir, '--sign-key-env', 'OPSLEDGER_TEST_KEY']);
  const event = run([
    'event',
    'add',
    '--dir',
    dir,
    '--type',
    'action',
    '--summary',
    'x',
    '--sign-key-env',
    'OPSLEDGER_TEST_KEY',
  ]);
  const verify = run(['verify', '--dir', dir, '--key-env', 'OPSLEDGER_TEST_KEY']);
  delete process.env.OPSLEDGER_TEST_KEY;
  assert.ok(!init.out.includes('super-secret-key-value'));
  assert.ok(!event.out.includes('super-secret-key-value'));
  assert.ok(!verify.out.includes('super-secret-key-value'));
});

test('a wrong key fails the signature check', () => {
  const { dir } = workspace();
  process.env.OPSLEDGER_TEST_KEY = 'right-key';
  process.env.OPSLEDGER_WRONG_KEY = 'wrong-key';
  run(['init', '--dir', dir, '--sign-key-env', 'OPSLEDGER_TEST_KEY']);
  const { code, out } = run(['verify', '--dir', dir, '--key-env', 'OPSLEDGER_WRONG_KEY']);
  delete process.env.OPSLEDGER_TEST_KEY;
  delete process.env.OPSLEDGER_WRONG_KEY;
  assert.equal(code, EXIT_FAILURE);
  assert.ok(out.includes('signature INVALID'));
});

test('report renders markdown', () => {
  const { dir } = workspace();
  run(['init', '--dir', dir]);
  run(['event', 'add', '--dir', dir, '--type', 'action', '--summary', 'x']);
  const { code, out } = run(['report', '--dir', dir]);
  assert.equal(code, EXIT_OK);
  assert.ok(out.includes('# Engagement Evidence Ledger'));
});

test('report renders html', () => {
  const { dir } = workspace();
  run(['init', '--dir', dir]);
  const { code, out } = run(['report', '--dir', dir, '--format', 'html']);
  assert.equal(code, EXIT_OK);
  assert.ok(out.includes('<!doctype html>'));
});

test('report renders json', () => {
  const { dir } = workspace();
  run(['init', '--dir', dir]);
  const { code, out } = run(['report', '--dir', dir, '--format', 'json']);
  assert.equal(code, EXIT_OK);
  const document = JSON.parse(out);
  assert.equal(document.tool, 'opsledger');
});

test('report with an unknown format is a usage error', () => {
  const { dir } = workspace();
  run(['init', '--dir', dir]);
  const { code } = run(['report', '--dir', dir, '--format', 'pdf']);
  assert.equal(code, EXIT_USAGE);
});

test('report writes to a file', () => {
  const { root, dir } = workspace();
  run(['init', '--dir', dir]);
  const destination = path.join(root, 'report.md');
  const { code } = run(['report', '--dir', dir, '--out', destination]);
  assert.equal(code, EXIT_OK);
  assert.ok(readFileSync(destination, 'utf8').includes('# Engagement Evidence Ledger'));
});

test('the demo runs and reports an intact chain', () => {
  const { code, out } = run(['demo']);
  assert.equal(code, EXIT_OK);
  assert.ok(out.includes('chain INTACT'));
  assert.ok(out.includes('# Engagement Evidence Ledger'));
});

test('the entry point runs when the command line file is executed directly', () => {
  const script = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'src',
    'cli.js',
  );
  const result = spawnSync(process.execPath, [script, 'help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes('opsledger verify'));
});

test('the entry point runs a real engagement and prints the verification result', () => {
  const { dir } = workspace();
  run(['init', '--dir', dir]);
  run(['event', 'add', '--dir', dir, '--type', 'action', '--summary', 'x']);
  const script = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'src',
    'cli.js',
  );
  const result = spawnSync(process.execPath, [script, 'verify', '--dir', dir], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes('chain INTACT'));
});
