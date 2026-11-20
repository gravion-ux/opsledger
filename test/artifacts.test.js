import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  CLASSIFICATIONS,
  artifactById,
  emptyManifest,
  loadManifest,
  nextArtifactId,
  registerArtifact,
  saveManifest,
  verifyArtifacts,
  verifyArtifactsAsync,
} from '../src/artifacts.js';
import { sha256Hex } from '../src/hash.js';

function workspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'opsledger-artifacts-'));
  return { root, dir: path.join(root, 'ENGAGEMENT') };
}

function sourceFile(root, name, content) {
  const target = path.join(root, name);
  writeFileSync(target, content, 'utf8');
  return target;
}

test('registering an artifact records its hash and size', () => {
  const { root, dir } = workspace();
  const source = sourceFile(root, 'transcript.txt', 'hello evidence');
  const manifest = registerArtifact(emptyManifest(), source, { dir });
  const artifact = manifest.artifacts[0];
  assert.equal(artifact.sha256, sha256Hex(readFileSync(source)));
  assert.equal(artifact.size, 'hello evidence'.length);
});

test('registering an artifact copies it into the engagement', () => {
  const { root, dir } = workspace();
  const source = sourceFile(root, 'transcript.txt', 'hello evidence');
  const manifest = registerArtifact(emptyManifest(), source, { dir });
  const stored = path.join(dir, manifest.artifacts[0].path);
  assert.ok(existsSync(stored));
  assert.equal(readFileSync(stored, 'utf8'), 'hello evidence');
});

test('the manifest entry has the documented shape', () => {
  const { root, dir } = workspace();
  const source = sourceFile(root, 'transcript.txt', 'hello');
  const manifest = registerArtifact(emptyManifest(), source, {
    dir,
    classification: 'confidential',
    note: 'recon transcript',
    collectedAt: '2026-11-05T09:14:22Z',
  });
  const artifact = manifest.artifacts[0];
  assert.deepEqual(Object.keys(artifact).sort(), [
    'classification',
    'collectedAt',
    'id',
    'note',
    'path',
    'sha256',
    'size',
  ]);
  assert.equal(artifact.classification, 'confidential');
  assert.equal(artifact.note, 'recon transcript');
  assert.equal(artifact.collectedAt, '2026-11-05T09:14:22Z');
});

test('the stored path is relative to the engagement and uses forward slashes', () => {
  const { root, dir } = workspace();
  const source = sourceFile(root, 'transcript.txt', 'hello');
  const manifest = registerArtifact(emptyManifest(), source, { dir });
  assert.match(manifest.artifacts[0].path, /^artifacts\//);
  assert.ok(!manifest.artifacts[0].path.includes('\\'));
});

test('the default classification is internal', () => {
  const { root, dir } = workspace();
  const source = sourceFile(root, 'transcript.txt', 'hello');
  const manifest = registerArtifact(emptyManifest(), source, { dir });
  assert.equal(manifest.artifacts[0].classification, 'internal');
});

test('an unknown classification is rejected', () => {
  const { root, dir } = workspace();
  const source = sourceFile(root, 'transcript.txt', 'hello');
  assert.throws(
    () => registerArtifact(emptyManifest(), source, { dir, classification: 'top-secret' }),
    /unknown classification/,
  );
});

test('every documented classification is accepted', () => {
  for (const classification of CLASSIFICATIONS) {
    const { root, dir } = workspace();
    const source = sourceFile(root, 'transcript.txt', 'hello');
    const manifest = registerArtifact(emptyManifest(), source, { dir, classification });
    assert.equal(manifest.artifacts[0].classification, classification);
  }
});

test('a missing artifact file is rejected', () => {
  const { root, dir } = workspace();
  assert.throws(
    () => registerArtifact(emptyManifest(), path.join(root, 'nope.txt'), { dir }),
    /artifact file not found/,
  );
});

test('registering an artifact does not change the source file', () => {
  const { root, dir } = workspace();
  const source = sourceFile(root, 'transcript.txt', 'hello evidence');
  registerArtifact(emptyManifest(), source, { dir });
  assert.equal(readFileSync(source, 'utf8'), 'hello evidence');
});

test('registering the same id replaces the earlier entry', () => {
  const { root, dir } = workspace();
  const first = sourceFile(root, 'one.txt', 'one');
  const second = sourceFile(root, 'two.txt', 'two');
  let manifest = registerArtifact(emptyManifest(), first, { dir, id: 'art-001' });
  manifest = registerArtifact(manifest, second, { dir, id: 'art-001' });
  assert.equal(manifest.artifacts.length, 1);
  assert.equal(manifest.artifacts[0].sha256, sha256Hex(readFileSync(second)));
});

test('the next artifact id follows the art-NNN pattern', () => {
  assert.equal(nextArtifactId(emptyManifest()), 'art-001');
  const manifest = { version: 1, artifacts: [{ id: 'art-001' }, { id: 'art-002' }] };
  assert.equal(nextArtifactId(manifest), 'art-003');
});

test('an artifact can be found by id', () => {
  const manifest = { version: 1, artifacts: [{ id: 'art-001' }, { id: 'art-002' }] };
  assert.equal(artifactById(manifest, 'art-002').id, 'art-002');
  assert.equal(artifactById(manifest, 'art-999'), null);
});

test('a missing manifest loads as an empty manifest', () => {
  const { dir } = workspace();
  assert.deepEqual(loadManifest(dir), emptyManifest());
});

test('a manifest survives a save and load round trip', () => {
  const { root, dir } = workspace();
  const source = sourceFile(root, 'transcript.txt', 'hello');
  const manifest = registerArtifact(emptyManifest(), source, { dir });
  saveManifest(dir, manifest);
  const loaded = loadManifest(dir);
  assert.deepEqual(loaded.artifacts, manifest.artifacts);
});

test('unchanged artifacts verify', () => {
  const { root, dir } = workspace();
  const source = sourceFile(root, 'transcript.txt', 'hello');
  const manifest = registerArtifact(emptyManifest(), source, { dir });
  const result = verifyArtifacts(dir, manifest);
  assert.equal(result.ok, true);
  assert.equal(result.checked, 1);
});

test('a changed artifact is detected', () => {
  const { root, dir } = workspace();
  const source = sourceFile(root, 'transcript.txt', 'hello');
  const manifest = registerArtifact(emptyManifest(), source, { dir });
  writeFileSync(path.join(dir, manifest.artifacts[0].path), 'tampered', 'utf8');
  const result = verifyArtifacts(dir, manifest);
  assert.equal(result.ok, false);
  assert.equal(result.mismatches.length, 1);
  assert.match(result.mismatches[0].reason, /content/);
});

test('a removed artifact is detected', () => {
  const { root, dir } = workspace();
  const source = sourceFile(root, 'transcript.txt', 'hello');
  const manifest = registerArtifact(emptyManifest(), source, { dir });
  writeFileSync(path.join(dir, manifest.artifacts[0].path), '', 'utf8');
  unlinkSync(path.join(dir, manifest.artifacts[0].path));
  const result = verifyArtifacts(dir, manifest);
  assert.equal(result.ok, false);
  assert.match(result.mismatches[0].reason, /missing/);
});

test('the parallel check agrees with the sequential check on unchanged artifacts', async () => {
  const { root, dir } = workspace();
  const source = sourceFile(root, 'transcript.txt', 'hello');
  const manifest = registerArtifact(emptyManifest(), source, { dir });
  const sequential = verifyArtifacts(dir, manifest);
  const parallel = await verifyArtifactsAsync(dir, manifest);
  assert.deepEqual(parallel, sequential);
  assert.equal(parallel.ok, true);
});

test('the parallel check agrees with the sequential check on a changed artifact', async () => {
  const { root, dir } = workspace();
  const source = sourceFile(root, 'transcript.txt', 'hello');
  const manifest = registerArtifact(emptyManifest(), source, { dir });
  writeFileSync(path.join(dir, manifest.artifacts[0].path), 'tampered', 'utf8');
  const sequential = verifyArtifacts(dir, manifest);
  const parallel = await verifyArtifactsAsync(dir, manifest);
  assert.deepEqual(parallel, sequential);
  assert.equal(parallel.ok, false);
  assert.equal(parallel.mismatches.length, 1);
  assert.match(parallel.mismatches[0].reason, /content/);
});

test('the parallel check agrees with the sequential check on a removed artifact', async () => {
  const { root, dir } = workspace();
  const source = sourceFile(root, 'transcript.txt', 'hello');
  const manifest = registerArtifact(emptyManifest(), source, { dir });
  unlinkSync(path.join(dir, manifest.artifacts[0].path));
  const sequential = verifyArtifacts(dir, manifest);
  const parallel = await verifyArtifactsAsync(dir, manifest);
  assert.deepEqual(parallel, sequential);
  assert.equal(parallel.ok, false);
  assert.match(parallel.mismatches[0].reason, /missing/);
});

test('the parallel check reports several mismatches in manifest order', async () => {
  const { root, dir } = workspace();
  const first = sourceFile(root, 'one.txt', 'one');
  const second = sourceFile(root, 'two.txt', 'two');
  const third = sourceFile(root, 'three.txt', 'three');
  let manifest = registerArtifact(emptyManifest(), first, { dir });
  manifest = registerArtifact(manifest, second, { dir });
  manifest = registerArtifact(manifest, third, { dir });
  writeFileSync(path.join(dir, manifest.artifacts[0].path), 'tampered', 'utf8');
  unlinkSync(path.join(dir, manifest.artifacts[2].path));
  const sequential = verifyArtifacts(dir, manifest);
  const parallel = await verifyArtifactsAsync(dir, manifest);
  assert.deepEqual(parallel, sequential);
  assert.equal(parallel.mismatches.length, 2);
  assert.deepEqual(parallel.mismatches.map((entry) => entry.id), ['art-001', 'art-003']);
});

test('the parallel check on an empty manifest succeeds', async () => {
  const { dir } = workspace();
  const result = await verifyArtifactsAsync(dir, emptyManifest());
  assert.deepEqual(result, { ok: true, checked: 0, mismatches: [] });
});
