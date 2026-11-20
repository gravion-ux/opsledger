// opsledger benchmark.
//
// Run it with: node bench/benchmark.mjs
//
// Each workload is timed seven times and the fastest run is reported, because
// the slowest run is usually the one that caught a stray background process
// rather than the one that measured the code. Compare two revisions on the
// same machine and the same Node build; the absolute numbers are not
// comparable between machines.
//
// The corpus is built in, so the benchmark needs no files of its own and no
// network access. The sizes can be changed with environment variables:
//   OPS_EVENT_COUNT      number of events in the ledger   (default 2000)
//   OPS_ARTIFACT_COUNT   number of artifact files         (default 200)
//   OPS_ARTIFACT_BYTES   size of each artifact file       (default 65536)
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Import one of the project's own modules.
 * @param {string} relative The module path, relative to the project root.
 * @returns {Promise<object>} The module.
 */
function load(relative) {
  return import(pathToFileURL(path.join(root, relative)).href);
}

const artifacts = await load('src/artifacts.js');
const ledgerModule = await load('src/ledger.js');
const reportModule = await load('src/report.js');
const verifyModule = await load('src/verify.js');

const TRIALS = 7;
const EVENT_COUNT = Number(process.env.OPS_EVENT_COUNT || 2000);
const ARTIFACT_COUNT = Number(process.env.OPS_ARTIFACT_COUNT || 200);
const ARTIFACT_BYTES = Number(process.env.OPS_ARTIFACT_BYTES || 65536);

/**
 * Time one workload, keeping the fastest run.
 * @param {Function} fn The workload.
 * @returns {Promise<number>} The fastest duration in milliseconds.
 */
async function timeBest(fn) {
  let best = Infinity;
  for (let trial = 0; trial < TRIALS; trial += 1) {
    const started = process.hrtime.bigint();
    await fn();
    const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
    if (elapsed < best) best = elapsed;
  }
  return best;
}

/**
 * Build one event.
 * @param {number} index The event index.
 * @returns {object} The event.
 */
function makeEvent(index) {
  return {
    type: ['action', 'finding', 'note', 'artifact', 'phase'][index % 5],
    summary: `benchmark event ${index} recorded during the engagement`,
    actor: 'operator',
    ref: `art-${String(index % 50).padStart(3, '0')}`,
    timestamp: '2026-01-01T00:00:00.000Z',
  };
}

/**
 * Build a ledger with the requested number of events.
 *
 * The bulk API is used when the revision has one, because that is the way a
 * caller should build a large ledger.
 * @param {number} count The event count.
 * @returns {object} The ledger.
 */
function buildLedger(count) {
  const empty = ledgerModule.createLedger({
    engagement: 'BENCH-ENGAGEMENT',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  const events = Array.from({ length: count }, (_, index) => makeEvent(index));
  if (typeof ledgerModule.appendEvents === 'function') {
    return ledgerModule.appendEvents(empty, events);
  }
  let ledger = empty;
  for (const event of events) {
    ledger = ledgerModule.appendEvent(ledger, event);
  }
  return ledger;
}

const ledger = buildLedger(EVENT_COUNT);
const manifest = { version: 1, artifacts: [] };
const signed = ledgerModule.signLedger(ledger, 'bench-key', manifest);

// A directory of artifacts to hash.
const artifactRoot = mkdtempSync(path.join(tmpdir(), 'opsledger-bench-'));
const artifactManifest = { version: 1, artifacts: [] };
for (let index = 0; index < ARTIFACT_COUNT; index += 1) {
  const name = `artifact-${index}.bin`;
  const bytes = Buffer.alloc(ARTIFACT_BYTES, index % 251);
  writeFileSync(path.join(artifactRoot, name), bytes);
  artifactManifest.artifacts.push({
    id: `art-${String(index).padStart(3, '0')}`,
    path: name,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: ARTIFACT_BYTES,
    collectedAt: '2026-01-01T00:00:00.000Z',
    classification: 'internal',
    note: '',
  });
}

/**
 * Report one workload.
 * @param {string} label The label.
 * @param {number} ms The duration.
 * @returns {void}
 */
function report(label, ms) {
  process.stdout.write(`${label.padEnd(32)} ${ms.toFixed(2)} ms (min of ${TRIALS})\n`);
}

report('build the ledger', await timeBest(() => buildLedger(EVENT_COUNT)));
report('verify the chain', await timeBest(() => verifyModule.verifyChain(ledger, { key: 'bench-key', manifest })));
report('verify the chain, no key', await timeBest(() => verifyModule.verifyChain(ledger, { manifest })));
report('compute the signature', await timeBest(() => ledgerModule.signLedger(ledger, 'bench-key', manifest)));
report('render the markdown report', await timeBest(() => reportModule.toMarkdown(ledger, manifest, null)));
report('render the html report', await timeBest(() => reportModule.toHtml(ledger, manifest, null)));
report('render the json report', await timeBest(() => reportModule.toJson(ledger, manifest, null)));
report('verify every artifact', await timeBest(() => artifacts.verifyArtifacts(artifactRoot, artifactManifest)));
if (typeof artifacts.verifyArtifactsAsync === 'function') {
  report('verify every artifact, parallel', await timeBest(() => artifacts.verifyArtifactsAsync(artifactRoot, artifactManifest)));
}

process.stdout.write(`\nevents: ${EVENT_COUNT}, artifacts: ${ARTIFACT_COUNT} x ${ARTIFACT_BYTES} bytes\n`);
