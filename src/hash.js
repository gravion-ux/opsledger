/**
 * opsledger — hash helpers for the engagement evidence chain.
 * @module opsledger/hash
 */
import { createHash, createHmac } from 'node:crypto';

/**
 * The hash the first event of a ledger chains from.
 * @type {string}
 */
export const GENESIS_HASH = '0'.repeat(64);

/**
 * Compute the SHA-256 of a value as lowercase hexadecimal.
 * @param {string|Buffer} data The data to hash.
 * @returns {string} The hexadecimal digest.
 */
export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Recursively sort object keys so a value serializes the same way every time.
 *
 * The accumulator is a null-prototype object on purpose. On a normal object a
 * property named `__proto__` would be assigned through the inherited setter,
 * which silently removes it from the canonical form; two events that differ
 * only in such a property would then share a hash and a tampered ledger would
 * still verify.
 * @param {*} value The value to normalize.
 * @returns {*} The normalized value.
 */
function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const sorted = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) {
        continue;
      }
      sorted[key] = canonicalize(value[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Serialize a value as canonical JSON.
 *
 * Object keys are sorted recursively and no whitespace is emitted, so the same
 * logical value always produces the same bytes and therefore the same hash.
 * @param {*} value The value to serialize.
 * @returns {string} The canonical JSON text.
 */
export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

/**
 * Compute the hash of one ledger event.
 *
 * The event's own `eventHash` field is excluded from the payload, and the
 * predecessor's hash is appended, which is what chains the ledger together.
 * @param {object} event The event, with or without its `eventHash` field.
 * @param {string} previousHash The hash of the preceding event.
 * @returns {string} The hexadecimal event hash.
 */
export function computeEventHash(event, previousHash) {
  const payload = { ...event };
  delete payload.eventHash;
  return sha256Hex(canonicalJson(payload) + previousHash);
}

/**
 * Compute an HMAC-SHA256 as lowercase hexadecimal.
 * @param {string} key The signing key.
 * @param {string|Buffer} data The data to sign.
 * @returns {string} The hexadecimal HMAC.
 */
export function hmacHex(key, data) {
  return createHmac('sha256', key).update(data).digest('hex');
}
