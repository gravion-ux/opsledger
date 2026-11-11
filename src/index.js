/**
 * opsledger — tamper-evident evidence ledger for red-team engagements.
 * @module opsledger
 */
export { GENESIS_HASH, canonicalJson, computeEventHash, hmacHex, sha256Hex } from './hash.js';
export {
  EVENT_TYPES,
  LEDGER_VERSION,
  appendEvent,
  createLedger,
  eventPreviousHash,
  ledgerHeadHash,
  ledgerSignaturePayload,
  signLedger,
} from './ledger.js';
export {
  CLASSIFICATIONS,
  MANIFEST_VERSION,
  artifactById,
  emptyManifest,
  loadManifest,
  nextArtifactId,
  registerArtifact,
  saveManifest,
  verifyArtifacts,
} from './artifacts.js';
export { verifyChain, verifySignature } from './verify.js';
export { escapeCell, escapeHtml, toHtml, toJson, toMarkdown } from './report.js';
