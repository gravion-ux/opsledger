import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFlags } from '../src/cli.js';

test('parseFlags treats a bare -- as positional', () => {
  const { flags, positional } = parseFlags(['--', 'verify']);
  assert.deepEqual(flags, {});
  assert.deepEqual(positional, ['--', 'verify']);
});
