/**
 * opsledger — chain verification and tamper detection.
 * @module opsledger/verify
 */
import { timingSafeEqual } from 'node:crypto';

import { computeEventHash, hmacHex } from './hash.js';
import { eventPreviousHash, ledgerHeadHash, ledgerSignaturePayload } from './ledger.js';

/**
 * Compare two strings without leaking their contents through timing.
 * @param {string} left The first value.
 * @param {string} right The second value.
 * @returns {boolean} True when the two values are identical.
 */
function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

/**
 * Check the ledger signature.
 *
 * Three outcomes are reported separately, because they mean different things:
 * the ledger is unsigned, the ledger is signed but no key was supplied, and
 * the ledger is signed and the supplied key does not match.
 * @param {object} ledger The ledger.
 * @param {string|null} key The signing key, or null.
 * @param {object} manifest The artifact manifest.
 * @returns {object} The signature result.
 */
export function verifySignature(ledger, key, manifest) {
  const present = typeof ledger.signature === 'string' && ledger.signature.length > 0;
  if (!present) {
    return { present: false, supplied: Boolean(key), valid: null };
  }
  if (!key) {
    return { present: true, supplied: false, valid: null };
  }
  const expected = hmacHex(key, ledgerSignaturePayload(ledger, manifest));
  return { present: true, supplied: true, valid: safeEqual(expected, ledger.signature) };
}

/**
 * Verify the ledger chain.
 *
 * The check walks the events from the genesis hash, recomputing each event's
 * hash from its own content and its predecessor's hash. The first event whose
 * recomputed hash differs from its recorded hash is the precise break in the
 * chain. The recorded event count and head hash are checked as well, because a
 * chain alone cannot detect a truncated tail.
 * @param {object} ledger The ledger.
 * @param {object} options The verification options.
 * @param {string} [options.key] The signing key.
 * @param {object} [options.manifest] The artifact manifest.
 * @returns {object} The verification result.
 */
export function verifyChain(ledger, options = {}) {
  const { key = null, manifest = { version: 1, artifacts: [] } } = options;
  const events = ledger.events || [];
  const state = ledger.state || {};

  const result = {
    ok: false,
    checked: 0,
    brokenIndex: null,
    expectedHash: null,
    actualHash: null,
    reason: '',
    signature: { present: false, supplied: Boolean(key), valid: null },
  };

  const finish = () => {
    result.signature = verifySignature(ledger, key, manifest);
    return result;
  };

  // Walk the chain first. A modified, inserted or removed event breaks the
  // hash link at a precise index, and that index is more useful than the
  // event count, so the walk takes precedence over the count check.
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.index !== index) {
      result.brokenIndex = index;
      result.reason = `the event at position ${index} claims index ${event.index}`;
      return finish();
    }
    const previousHash = eventPreviousHash(ledger, index);
    const expected = computeEventHash(event, previousHash);
    if (expected !== event.eventHash) {
      result.brokenIndex = index;
      result.expectedHash = expected;
      result.actualHash = event.eventHash;
      result.reason = `event ${index} does not match its recorded hash`;
      return finish();
    }
    result.checked = index + 1;
  }

  // The chain is internally consistent, but it does not hold the number of
  // events the ledger records. This is what catches a truncated tail, and a
  // tail that was removed and whose links were recomputed. The recorded count
  // and head hash must be present: without them the truncation check could be
  // switched off simply by deleting the state block.
  if (!Number.isInteger(state.eventCount)) {
    result.reason = 'the ledger does not record an event count';
    return finish();
  }
  if (state.eventCount !== events.length) {
    result.brokenIndex = Math.min(state.eventCount, events.length);
    result.reason = `the ledger records ${state.eventCount} event(s) but holds ${events.length}`;
    return finish();
  }

  const head = ledgerHeadHash(ledger);
  if (typeof state.headHash !== 'string' || state.headHash.length === 0) {
    result.reason = 'the ledger does not record a head hash';
    return finish();
  }
  if (state.headHash !== head) {
    result.brokenIndex = events.length === 0 ? 0 : events.length - 1;
    result.expectedHash = head;
    result.actualHash = state.headHash;
    result.reason = 'the recorded head hash does not match the last event';
    return finish();
  }

  const signature = finish();
  if (signature.signature.present && signature.signature.valid === false) {
    result.reason = 'the ledger signature does not match the supplied key';
    return result;
  }

  result.ok = true;
  if (signature.signature.present && !signature.signature.supplied) {
    result.reason = 'the chain is intact, but the ledger is signed and no key was supplied';
  } else if (!signature.signature.present && signature.signature.supplied) {
    result.reason = 'the chain is intact, but the ledger is unsigned';
  }
  return result;
}
