import assert from 'node:assert/strict';
import { test } from 'node:test';

import { appendEvent, createLedger } from '../src/ledger.js';
import { escapeCell, escapeHtml, toHtml, toJson, toMarkdown } from '../src/report.js';

const MANIFEST = {
  version: 1,
  artifacts: [
    {
      id: 'art-001',
      path: 'artifacts/art-001-transcript.txt',
      sha256: 'a'.repeat(64),
      size: 42,
      collectedAt: '2026-11-05T09:14:22Z',
      classification: 'confidential',
      note: 'initial recon transcript',
    },
  ],
};

function sampleLedger() {
  let ledger = createLedger({ engagement: 'CONTOSO-2026-11', createdAt: '2026-11-05T09:00:00Z' });
  ledger = appendEvent(ledger, {
    type: 'phase',
    summary: 'reconnaissance',
    actor: 'operator',
    timestamp: '2026-11-05T09:10:00Z',
  });
  ledger = appendEvent(ledger, {
    type: 'action',
    summary: 'port scan of the edge host',
    actor: 'operator',
    ref: 'art-001',
    timestamp: '2026-11-05T09:20:00Z',
  });
  return ledger;
}

const INTACT = {
  ok: true,
  checked: 2,
  brokenIndex: null,
  expectedHash: null,
  actualHash: null,
  reason: '',
  signature: { present: false, supplied: false, valid: null },
};

test('escapeHtml escapes the markup characters', () => {
  const escaped = escapeHtml('<script>alert("x" & \'y\')</script>');
  assert.ok(!escaped.includes('<'));
  assert.ok(!escaped.includes('>'));
  assert.ok(!escaped.includes('"'));
  assert.ok(!escaped.includes('\''));
  assert.ok(escaped.includes('&'));
});

test('escapeHtml renders null and undefined as an empty string', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('escapeCell escapes pipes and newlines', () => {
  assert.equal(escapeCell('a | b'), 'a \\| b');
  assert.equal(escapeCell('a\nb'), 'a b');
});

test('the markdown report names the engagement', () => {
  const report = toMarkdown(sampleLedger(), MANIFEST, INTACT, { generatedAt: '2026-11-05T10:00:00Z' });
  assert.ok(report.includes('# Engagement Evidence Ledger — CONTOSO-2026-11'));
});

test('the markdown report holds the timeline', () => {
  const report = toMarkdown(sampleLedger(), MANIFEST, INTACT, { generatedAt: '2026-11-05T10:00:00Z' });
  assert.ok(report.includes('## Timeline'));
  assert.ok(report.includes('reconnaissance'));
  assert.ok(report.includes('port scan of the edge host'));
  assert.ok(report.includes('art-001'));
});

test('the markdown report holds the artifact manifest with hashes', () => {
  const report = toMarkdown(sampleLedger(), MANIFEST, INTACT, { generatedAt: '2026-11-05T10:00:00Z' });
  assert.ok(report.includes('## Artifact manifest'));
  assert.ok(report.includes('a'.repeat(64)));
  assert.ok(report.includes('confidential'));
});

test('the markdown report states that the chain is intact', () => {
  const report = toMarkdown(sampleLedger(), MANIFEST, INTACT, { generatedAt: '2026-11-05T10:00:00Z' });
  assert.ok(report.includes('**INTACT**'));
});

test('the markdown report explains a broken chain', () => {
  const broken = { ...INTACT, ok: false, brokenIndex: 1, reason: 'event 1 does not match' };
  const report = toMarkdown(sampleLedger(), MANIFEST, broken, { generatedAt: '2026-11-05T10:00:00Z' });
  assert.ok(report.includes('**BROKEN**'));
  assert.ok(report.includes('Broken event index: 1'));
});

test('the markdown report says when nothing was recorded', () => {
  const empty = createLedger({ engagement: 'EMPTY', createdAt: '2026-11-05T09:00:00Z' });
  const report = toMarkdown(empty, { version: 1, artifacts: [] }, INTACT, { generatedAt: 'now' });
  assert.ok(report.includes('No events have been recorded'));
  assert.ok(report.includes('No artifacts have been registered'));
});

test('the html report is a complete document', () => {
  const report = toHtml(sampleLedger(), MANIFEST, INTACT, { generatedAt: '2026-11-05T10:00:00Z' });
  assert.ok(report.startsWith('<!doctype html>'));
  assert.ok(report.includes('</html>'));
  assert.ok(report.includes('CONTOSO-2026-11'));
});

test('the html report escapes a note that contains markup', () => {
  const manifest = {
    version: 1,
    artifacts: [{ ...MANIFEST.artifacts[0], note: '<img src=x onerror=alert(1)>' }],
  };
  const report = toHtml(sampleLedger(), manifest, INTACT, { generatedAt: 'now' });
  const amp = String.fromCharCode(38);
  assert.ok(!report.includes('<img'));
  assert.ok(report.includes(`${amp}lt;img`));
  assert.ok(report.includes('onerror=alert(1)'));
});

test('the html report marks a broken chain', () => {
  const broken = { ...INTACT, ok: false, brokenIndex: 1, reason: 'event 1 does not match' };
  const report = toHtml(sampleLedger(), MANIFEST, broken, { generatedAt: 'now' });
  assert.ok(report.includes('badge broken'));
  assert.ok(report.includes('Verification failure'));
});

test('the json report has the documented shape', () => {
  const document = JSON.parse(toJson(sampleLedger(), MANIFEST, INTACT, { generatedAt: '2026-11-05T10:00:00Z' }));
  assert.equal(document.tool, 'opsledger');
  assert.equal(document.engagement.name, 'CONTOSO-2026-11');
  assert.equal(document.engagement.generatedAt, '2026-11-05T10:00:00Z');
  assert.equal(document.events.length, 2);
  assert.equal(document.artifacts.length, 1);
  assert.equal(document.verification.ok, true);
});

test('the json report keeps the event hashes', () => {
  const document = JSON.parse(toJson(sampleLedger(), MANIFEST, INTACT, { generatedAt: 'now' }));
  assert.match(document.events[0].eventHash, /^[0-9a-f]{64}$/);
});
