/**
 * opsledger — ledger construction and the hash-chained event sequence.
 * @module opsledger/ledger
 */
import { GENESIS_HASH, canonicalJson, computeEventHash, hmacHex } from './hash.js';

/**
 * The version of the ledger document format.
 * @type {number}
 */
export const LEDGER_VERSION = 1;

/**
 * The event types the ledger accepts.
 * @type {string[]}
 */
export const EVENT_TYPES = ['action', 'finding', 'note', 'artifact', 'phase'];

/**
 * Build an empty ledger.
 * @param {object} options The ledger options.
 * @param {string} options.engagement The engagement name.
 * @param {string} options.createdAt The creation timestamp.
 * @returns {object} The new ledger.
 */
export function createLedger({ engagement, createdAt }) {
  return {
    version: LEDGER_VERSION,
    engagement,
    createdAt,
    events: [],
    state: { eventCount: 0, headHash: GENESIS_HASH },
    signature: null,
  };
}

/**
 * Return the hash an event at an index chains from.
 * @param {object} ledger The ledger.
 * @param {number} index The event index.
 * @returns {string} The predecessor hash.
 */
export function eventPreviousHash(ledger, index) {
  if (index <= 0) {
    return GENESIS_HASH;
  }
  const previous = ledger.events[index - 1];
  return previous ? previous.eventHash : GENESIS_HASH;
}

/**
 * Return the hash of the last event in the ledger.
 * @param {object} ledger The ledger.
 * @returns {string} The head hash, or the genesis hash for an empty ledger.
 */
export function ledgerHeadHash(ledger) {
  const events = ledger.events || [];
  if (events.length === 0) {
    return GENESIS_HASH;
  }
  return events[events.length - 1].eventHash;
}

/**
 * Append an event to the ledger.
 *
 * The ledger is not modified: a new ledger is returned, which keeps the
 * append operation easy to reason about and easy to test.
 * @param {object} ledger The ledger to append to.
 * @param {object} event The event to append.
 * @param {string} event.type The event type.
 * @param {string} event.summary A one-line summary of what happened.
 * @param {string} [event.actor] Who or what performed the action.
 * @param {string} [event.ref] A reference to an artifact or a finding.
 * @param {string} [event.timestamp] The event timestamp.
 * @returns {object} The new ledger.
 */
export function appendEvent(ledger, event) {
  const events = ledger.events || [];
  const index = events.length;
  const previousHash = eventPreviousHash(ledger, index);
  const record = {
    index,
    type: event.type,
    summary: event.summary,
    actor: event.actor === undefined ? null : event.actor,
    ref: event.ref === undefined ? null : event.ref,
    timestamp: event.timestamp || new Date().toISOString(),
  };
  const eventHash = computeEventHash(record, previousHash);
  return {
    ...ledger,
    events: [...events, { ...record, eventHash }],
    state: { eventCount: index + 1, headHash: eventHash },
  };
}

/**
 * Build the canonical payload the ledger signature covers.
 *
 * The payload includes the artifact manifest, so registering an artifact after
 * the ledger was signed invalidates the signature until the ledger is signed
 * again. That is the intended behaviour: evidence added behind the operator's
 * back should break the signature.
 * @param {object} ledger The ledger.
 * @param {object} manifest The artifact manifest.
 * @returns {string} The canonical JSON payload.
 */
export function ledgerSignaturePayload(ledger, manifest) {
  return canonicalJson({
    version: ledger.version,
    engagement: ledger.engagement,
    createdAt: ledger.createdAt,
    events: ledger.events,
    state: ledger.state,
    manifest: manifest || { version: 1, artifacts: [] },
  });
}

/**
 * Sign a ledger with an HMAC key.
 * @param {object} ledger The ledger.
 * @param {string} key The signing key.
 * @param {object} manifest The artifact manifest.
 * @returns {object} A new ledger carrying the signature.
 */
export function signLedger(ledger, key, manifest) {
  return { ...ledger, signature: hmacHex(key, ledgerSignaturePayload(ledger, manifest)) };
}
