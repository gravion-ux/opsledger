import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GENESIS_HASH } from '../src/hash.js';
import {
  appendEvent,
  appendEvents,
  createLedger,
  eventPreviousHash,
  ledgerHeadHash,
  ledgerSignaturePayload,
  signLedger,
} from '../src/ledger.js';

const KEY = 'a-signing-key';

function ledgerWith(...events) {
  let ledger = createLedger({ engagement: 'TEST', createdAt: '2026-11-05T09:00:00Z' });
  for (const event of events) {
    ledger = appendEvent(ledger, event);
  }
  return ledger;
}

test('a new ledger is empty and chained to the genesis hash', () => {
  const ledger = createLedger({ engagement: 'TEST', createdAt: '2026-11-05T09:00:00Z' });
  assert.equal(ledger.version, 1);
  assert.equal(ledger.engagement, 'TEST');
  assert.deepEqual(ledger.events, []);
  assert.equal(ledger.state.eventCount, 0);
  assert.equal(ledger.state.headHash, GENESIS_HASH);
  assert.equal(ledger.signature, null);
});

test('the first event chains from the genesis hash', () => {
  const ledger = ledgerWith({ type: 'action', summary: 'first' });
  assert.equal(eventPreviousHash(ledger, 0), GENESIS_HASH);
  assert.equal(ledger.events[0].index, 0);
});

test('appending an event does not change the event count twice', () => {
  const ledger = ledgerWith({ type: 'action', summary: 'first' });
  assert.equal(ledger.events.length, 1);
  assert.equal(ledger.state.eventCount, 1);
});

test('appending an event does not mutate the ledger it was given', () => {
  const first = ledgerWith({ type: 'action', summary: 'first' });
  const second = appendEvent(first, { type: 'action', summary: 'second' });
  assert.equal(first.events.length, 1);
  assert.equal(second.events.length, 2);
});

test('event indexes increase by one', () => {
  const ledger = ledgerWith(
    { type: 'action', summary: 'first' },
    { type: 'action', summary: 'second' },
    { type: 'action', summary: 'third' },
  );
  assert.deepEqual(ledger.events.map((event) => event.index), [0, 1, 2]);
});

test('the head hash is the hash of the last event', () => {
  const ledger = ledgerWith({ type: 'action', summary: 'first' }, { type: 'action', summary: 'second' });
  assert.equal(ledger.state.headHash, ledger.events[1].eventHash);
  assert.equal(ledgerHeadHash(ledger), ledger.events[1].eventHash);
});

test('the head hash of an empty ledger is the genesis hash', () => {
  assert.equal(ledgerHeadHash(createLedger({ engagement: 'T', createdAt: 'now' })), GENESIS_HASH);
});

test('a later event chains from its predecessor', () => {
  const ledger = ledgerWith({ type: 'action', summary: 'first' }, { type: 'action', summary: 'second' });
  assert.equal(eventPreviousHash(ledger, 1), ledger.events[0].eventHash);
});

test('the same event content always produces the same hash', () => {
  const first = ledgerWith({ type: 'action', summary: 'same', timestamp: '2026-11-05T09:00:00Z' });
  const second = ledgerWith({ type: 'action', summary: 'same', timestamp: '2026-11-05T09:00:00Z' });
  assert.equal(first.events[0].eventHash, second.events[0].eventHash);
});

test('an event with a different summary has a different hash', () => {
  const first = ledgerWith({ type: 'action', summary: 'one', timestamp: '2026-11-05T09:00:00Z' });
  const second = ledgerWith({ type: 'action', summary: 'two', timestamp: '2026-11-05T09:00:00Z' });
  assert.notEqual(first.events[0].eventHash, second.events[0].eventHash);
});

test('an event records the actor and the reference', () => {
  const ledger = ledgerWith({ type: 'action', summary: 'x', actor: 'operator', ref: 'art-001' });
  assert.equal(ledger.events[0].actor, 'operator');
  assert.equal(ledger.events[0].ref, 'art-001');
});

test('a missing actor and reference are stored as null', () => {
  const ledger = ledgerWith({ type: 'action', summary: 'x' });
  assert.equal(ledger.events[0].actor, null);
  assert.equal(ledger.events[0].ref, null);
});

test('an event without a timestamp gets the current time', () => {
  const ledger = ledgerWith({ type: 'action', summary: 'x' });
  assert.match(ledger.events[0].timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('signing a ledger produces a signature', () => {
  const ledger = signLedger(ledgerWith({ type: 'action', summary: 'x' }), KEY, { version: 1, artifacts: [] });
  assert.match(ledger.signature, /^[0-9a-f]{64}$/);
});

test('signing does not change the events', () => {
  const plain = ledgerWith({ type: 'action', summary: 'x' });
  const signed = signLedger(plain, KEY, { version: 1, artifacts: [] });
  assert.deepEqual(signed.events, plain.events);
});

test('the signature payload covers the artifact manifest', () => {
  const ledger = ledgerWith({ type: 'action', summary: 'x' });
  const without = ledgerSignaturePayload(ledger, { version: 1, artifacts: [] });
  const with_ = ledgerSignaturePayload(ledger, { version: 1, artifacts: [{ id: 'art-001' }] });
  assert.notEqual(without, with_);
});

test('the signature payload covers the event state', () => {
  const ledger = ledgerWith({ type: 'action', summary: 'x' });
  const payload = ledgerSignaturePayload(ledger, { version: 1, artifacts: [] });
  assert.ok(payload.includes('eventCount'));
  assert.ok(payload.includes(ledger.events[0].eventHash));
});

test('appending several events at once gives the same ledger as appending them one by one', () => {
  const events = [
    { type: 'phase', summary: 'reconnaissance', timestamp: '2026-11-05T09:00:00Z' },
    { type: 'action', summary: 'port scan', actor: 'operator', timestamp: '2026-11-05T09:01:00Z' },
    { type: 'finding', summary: 'weak banner', actor: 'operator', ref: 'art-001', timestamp: '2026-11-05T09:02:00Z' },
  ];
  const oneByOne = ledgerWith(...events);
  const allAtOnce = appendEvents(
    createLedger({ engagement: 'TEST', createdAt: '2026-11-05T09:00:00Z' }),
    events,
  );
  assert.deepEqual(allAtOnce, oneByOne);
});

test('appending several events at once does not mutate the ledger it was given', () => {
  const first = ledgerWith({ type: 'action', summary: 'first' });
  const second = appendEvents(first, [
    { type: 'action', summary: 'second' },
    { type: 'action', summary: 'third' },
  ]);
  assert.equal(first.events.length, 1);
  assert.equal(first.state.eventCount, 1);
  assert.equal(second.events.length, 3);
  assert.equal(second.state.eventCount, 3);
});

test('appending several events at once does not mutate the event list it was given', () => {
  const events = [{ type: 'action', summary: 'first' }, { type: 'action', summary: 'second' }];
  const snapshot = JSON.stringify(events);
  appendEvents(createLedger({ engagement: 'TEST', createdAt: '2026-11-05T09:00:00Z' }), events);
  assert.equal(JSON.stringify(events), snapshot);
});

test('appending an empty list leaves the events alone', () => {
  const ledger = ledgerWith({ type: 'action', summary: 'first' });
  const result = appendEvents(ledger, []);
  assert.deepEqual(result.events, ledger.events);
  assert.equal(result.state.eventCount, ledger.events.length);
  assert.equal(result.state.headHash, ledger.state.headHash);
});

test('appending several events at once agrees with appending them one by one over random cases', () => {
  // A seeded generator, so a failure can be reproduced exactly.
  let seed = 20261119;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const types = ['action', 'finding', 'note', 'artifact', 'phase'];

  for (let round = 0; round < 200; round += 1) {
    const count = 1 + Math.floor(random() * 6);
    const events = [];
    for (let index = 0; index < count; index += 1) {
      const event = {
        type: types[Math.floor(random() * types.length)],
        summary: `event ${index} of round ${round}`,
        timestamp: '2026-11-05T09:00:00Z',
      };
      if (random() < 0.5) event.actor = 'operator';
      if (random() < 0.5) event.ref = `art-${String(index).padStart(3, '0')}`;
      events.push(event);
    }
    const oneByOne = ledgerWith(...events);
    const allAtOnce = appendEvents(
      createLedger({ engagement: 'TEST', createdAt: '2026-11-05T09:00:00Z' }),
      events,
    );
    assert.deepEqual(allAtOnce, oneByOne, `round ${round} disagreed`);
  }
});
