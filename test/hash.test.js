import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  GENESIS_HASH,
  canonicalJson,
  computeEventHash,
  hmacHex,
  sha256Hex,
} from '../src/hash.js';

test('sha256Hex matches the known digest of "abc"', () => {
  assert.equal(
    sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

test('sha256Hex accepts a buffer', () => {
  assert.equal(sha256Hex(Buffer.from('abc', 'utf8')), sha256Hex('abc'));
});

test('the genesis hash is sixty-four zeros', () => {
  assert.equal(GENESIS_HASH.length, 64);
  assert.equal(GENESIS_HASH, '0'.repeat(64));
});

test('canonicalJson sorts object keys', () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test('canonicalJson is stable regardless of key order', () => {
  const first = canonicalJson({ index: 0, type: 'action', summary: 'x' });
  const second = canonicalJson({ summary: 'x', type: 'action', index: 0 });
  assert.equal(first, second);
});

test('canonicalJson sorts nested keys too', () => {
  assert.equal(canonicalJson({ a: { z: 1, y: 2 } }), '{"a":{"y":2,"z":1}}');
});

test('canonicalJson drops undefined members', () => {
  assert.equal(canonicalJson({ a: 1, b: undefined }), '{"a":1}');
});

test('canonicalJson keeps array order', () => {
  assert.equal(canonicalJson({ list: [3, 1, 2] }), '{"list":[3,1,2]}');
});

test('canonicalJson emits no whitespace', () => {
  assert.equal(canonicalJson({ a: 1, b: [1, 2] }), '{"a":1,"b":[1,2]}');
});

test('computeEventHash ignores the recorded event hash', () => {
  const event = { index: 0, type: 'action', summary: 'x' };
  const first = computeEventHash(event, GENESIS_HASH);
  const second = computeEventHash({ ...event, eventHash: 'ignored' }, GENESIS_HASH);
  assert.equal(first, second);
});

test('computeEventHash depends on the previous hash', () => {
  const event = { index: 1, type: 'action', summary: 'x' };
  assert.notEqual(computeEventHash(event, GENESIS_HASH), computeEventHash(event, 'a'.repeat(64)));
});

test('computeEventHash is a lowercase hexadecimal digest', () => {
  const hash = computeEventHash({ index: 0, type: 'action', summary: 'x' }, GENESIS_HASH);
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test('hmacHex matches the known RFC test vector', () => {
  assert.equal(
    hmacHex('key', 'The quick brown fox jumps over the lazy dog'),
    'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
  );
});

test('hmacHex depends on the key', () => {
  assert.notEqual(hmacHex('key', 'data'), hmacHex('other', 'data'));
});
