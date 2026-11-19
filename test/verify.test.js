import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GENESIS_HASH } from '../src/hash.js';
import { appendEvent, createLedger, signLedger } from '../src/ledger.js';
import { verifyChain, verifySignature } from '../src/verify.js';

const KEY = 'a-signing-key';
const OTHER_KEY = 'a-different-key';
const MANIFEST = { version: 1, artifacts: [] };

function ledgerWith(count = 3) {
  let ledger = createLedger({ engagement: 'TEST', createdAt: '2026-11-05T09:00:00Z' });
  for (let index = 0; index < count; index += 1) {
    ledger = appendEvent(ledger, {
      type: 'action',
      summary: `event ${index}`,
      timestamp: `2026-11-05T09:0${index}:00Z`,
    });
  }
  return ledger;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('an empty ledger verifies', () => {
  const result = verifyChain(createLedger({ engagement: 'T', createdAt: 'now' }), { manifest: MANIFEST });
  assert.equal(result.ok, true);
  assert.equal(result.checked, 0);
  assert.equal(result.brokenIndex, null);
});

test('an intact chain verifies', () => {
  const result = verifyChain(ledgerWith(), { manifest: MANIFEST });
  assert.equal(result.ok, true);
  assert.equal(result.checked, 3);
  assert.equal(result.reason, '');
});

test('a modified event breaks the chain at that event', () => {
  const ledger = clone(ledgerWith());
  ledger.events[1].summary = 'something else entirely';
  const result = verifyChain(ledger, { manifest: MANIFEST });
  assert.equal(result.ok, false);
  assert.equal(result.brokenIndex, 1);
  assert.match(result.reason, /does not match its recorded hash/);
});

test('a broken chain reports the expected and the recorded hash', () => {
  const ledger = clone(ledgerWith());
  ledger.events[1].summary = 'something else entirely';
  const result = verifyChain(ledger, { manifest: MANIFEST });
  assert.match(result.expectedHash, /^[0-9a-f]{64}$/);
  assert.equal(result.actualHash, ledger.events[1].eventHash);
});

test('a modified event also breaks every later event', () => {
  const ledger = clone(ledgerWith());
  ledger.events[0].summary = 'tampered';
  const result = verifyChain(ledger, { manifest: MANIFEST });
  assert.equal(result.brokenIndex, 0);
  assert.equal(result.checked, 0);
});

test('an inserted event breaks the chain', () => {
  const ledger = clone(ledgerWith());
  ledger.events.splice(1, 0, {
    index: 1,
    type: 'action',
    summary: 'inserted',
    actor: null,
    ref: null,
    timestamp: '2026-11-05T09:01:00Z',
    eventHash: 'f'.repeat(64),
  });
  const result = verifyChain(ledger, { manifest: MANIFEST });
  assert.equal(result.ok, false);
  assert.equal(result.brokenIndex, 1);
});

test('an inserted event with a shifted index is detected', () => {
  const ledger = clone(ledgerWith());
  ledger.events.splice(1, 0, {
    index: 9,
    type: 'action',
    summary: 'inserted',
    actor: null,
    ref: null,
    timestamp: '2026-11-05T09:01:00Z',
    eventHash: 'f'.repeat(64),
  });
  const result = verifyChain(ledger, { manifest: MANIFEST });
  assert.equal(result.ok, false);
  assert.equal(result.brokenIndex, 1);
  assert.match(result.reason, /claims index/);
});

test('a deleted middle event breaks the chain', () => {
  const ledger = clone(ledgerWith());
  ledger.events.splice(1, 1);
  const result = verifyChain(ledger, { manifest: MANIFEST });
  assert.equal(result.ok, false);
  assert.equal(result.brokenIndex, 1);
});

test('a deleted last event is detected by the recorded event count', () => {
  const ledger = clone(ledgerWith());
  ledger.events.pop();
  const result = verifyChain(ledger, { manifest: MANIFEST });
  assert.equal(result.ok, false);
  assert.match(result.reason, /records 3 event/);
});

test('a tampered head hash is detected', () => {
  const ledger = clone(ledgerWith());
  ledger.state.headHash = 'a'.repeat(64);
  const result = verifyChain(ledger, { manifest: MANIFEST });
  assert.equal(result.ok, false);
  assert.match(result.reason, /head hash/);
});

test('a tampered event count is detected', () => {
  const ledger = clone(ledgerWith());
  ledger.state.eventCount = 99;
  const result = verifyChain(ledger, { manifest: MANIFEST });
  assert.equal(result.ok, false);
  assert.match(result.reason, /records 99 event/);
});

test('an unsigned ledger reports that it is unsigned', () => {
  const result = verifyChain(ledgerWith(), { manifest: MANIFEST });
  assert.equal(result.signature.present, false);
  assert.equal(result.signature.valid, null);
});

test('a signed ledger verifies with the right key', () => {
  const ledger = signLedger(ledgerWith(), KEY, MANIFEST);
  const result = verifyChain(ledger, { key: KEY, manifest: MANIFEST });
  assert.equal(result.ok, true);
  assert.equal(result.signature.present, true);
  assert.equal(result.signature.supplied, true);
  assert.equal(result.signature.valid, true);
});

test('a signed ledger fails with the wrong key', () => {
  const ledger = signLedger(ledgerWith(), KEY, MANIFEST);
  const result = verifyChain(ledger, { key: OTHER_KEY, manifest: MANIFEST });
  assert.equal(result.ok, false);
  assert.equal(result.signature.valid, false);
  assert.match(result.reason, /signature does not match/);
});

test('a signed ledger without a key is reported as unchecked, not as broken', () => {
  const ledger = signLedger(ledgerWith(), KEY, MANIFEST);
  const result = verifyChain(ledger, { manifest: MANIFEST });
  assert.equal(result.ok, true);
  assert.equal(result.signature.present, true);
  assert.equal(result.signature.supplied, false);
  assert.equal(result.signature.valid, null);
  assert.match(result.reason, /no key was supplied/);
});

test('a signed ledger whose manifest changed fails the signature', () => {
  const ledger = signLedger(ledgerWith(), KEY, MANIFEST);
  const result = verifyChain(ledger, {
    key: KEY,
    manifest: { version: 1, artifacts: [{ id: 'art-001' }] },
  });
  assert.equal(result.ok, false);
  assert.equal(result.signature.valid, false);
});

test('verifySignature reports an unsigned ledger', () => {
  const result = verifySignature(ledgerWith(), null, MANIFEST);
  assert.deepEqual(result, { present: false, supplied: false, valid: null });
});

test('verifySignature reports a signed ledger without a key', () => {
  const ledger = signLedger(ledgerWith(), KEY, MANIFEST);
  const result = verifySignature(ledger, null, MANIFEST);
  assert.deepEqual(result, { present: true, supplied: false, valid: null });
});

test('the genesis hash is the predecessor of the first event', () => {
  const ledger = ledgerWith(1);
  assert.equal(ledger.events[0].eventHash.length, 64);
  assert.notEqual(ledger.events[0].eventHash, GENESIS_HASH);
});

test('a ledger whose state block was removed is rejected', () => {
  const ledger = clone(ledgerWith());
  delete ledger.state;
  const result = verifyChain(ledger, { manifest: MANIFEST });
  assert.equal(result.ok, false);
  assert.match(result.reason, /event count/);
});

test('a truncated ledger whose state block was removed is still detected', () => {
  const ledger = clone(ledgerWith());
  ledger.events.pop();
  delete ledger.state;
  const result = verifyChain(ledger, { manifest: MANIFEST });
  assert.equal(result.ok, false);
});

test('a ledger whose head hash was removed is rejected', () => {
  const ledger = clone(ledgerWith());
  delete ledger.state.headHash;
  const result = verifyChain(ledger, { manifest: MANIFEST });
  assert.equal(result.ok, false);
  assert.match(result.reason, /head hash/);
});

test('an event with an added __proto__ property breaks the chain', () => {
  const ledger = clone(ledgerWith());
  Object.defineProperty(ledger.events[0], '__proto__', {
    value: { tampered: true },
    enumerable: true,
    writable: true,
    configurable: true,
  });
  const result = verifyChain(ledger, { manifest: MANIFEST });
  assert.equal(result.ok, false);
  assert.equal(result.brokenIndex, 0);
});

test('a signed ledger rejects an added top-level field', () => {
  const ledger = signLedger(ledgerWith(), KEY, MANIFEST);
  const tampered = { ...ledger, operator: 'mallory' };
  const result = verifyChain(tampered, { key: KEY, manifest: MANIFEST });
  assert.equal(result.signature.valid, false);
  assert.equal(result.ok, false);
});

test('a signed ledger rejects a changed top-level field', () => {
  const ledger = signLedger(ledgerWith(), KEY, MANIFEST);
  const tampered = { ...ledger, engagement: 'OTHER' };
  const result = verifyChain(tampered, { key: KEY, manifest: MANIFEST });
  assert.equal(result.signature.valid, false);
});
