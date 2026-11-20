/**
 * opsledger — artifact registration and the engagement manifest.
 * @module opsledger/artifacts
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { sha256Hex } from './hash.js';

/**
 * The classification levels an artifact can carry.
 * @type {string[]}
 */
export const CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'];

/**
 * The version of the manifest document format.
 * @type {number}
 */
export const MANIFEST_VERSION = 1;

/**
 * Build an empty manifest.
 * @returns {object} The new manifest.
 */
export function emptyManifest() {
  return { version: MANIFEST_VERSION, artifacts: [] };
}

/**
 * Load the manifest of an engagement directory.
 * @param {string} dir The engagement directory.
 * @returns {object} The manifest.
 */
export function loadManifest(dir) {
  const target = path.join(dir, 'manifest.json');
  if (!existsSync(target)) {
    return emptyManifest();
  }
  const document = JSON.parse(readFileSync(target, 'utf8'));
  if (!document || !Array.isArray(document.artifacts)) {
    return emptyManifest();
  }
  return { version: document.version || MANIFEST_VERSION, artifacts: document.artifacts };
}

/**
 * Write the manifest of an engagement directory.
 * @param {string} dir The engagement directory.
 * @param {object} manifest The manifest.
 * @returns {void}
 */
export function saveManifest(dir, manifest) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

/**
 * Find an artifact in the manifest.
 * @param {object} manifest The manifest.
 * @param {string} id The artifact id.
 * @returns {object|null} The artifact, or null.
 */
export function artifactById(manifest, id) {
  const artifacts = (manifest && manifest.artifacts) || [];
  return artifacts.find((artifact) => artifact.id === id) || null;
}

/**
 * Pick the next free artifact id.
 * @param {object} manifest The manifest.
 * @returns {string} The new artifact id.
 */
export function nextArtifactId(manifest) {
  const artifacts = (manifest && manifest.artifacts) || [];
  const used = new Set(artifacts.map((artifact) => artifact.id));
  let index = artifacts.length + 1;
  let id = `art-${String(index).padStart(3, '0')}`;
  while (used.has(id)) {
    index += 1;
    id = `art-${String(index).padStart(3, '0')}`;
  }
  return id;
}

/**
 * Register a file as an engagement artifact.
 *
 * The file is copied into the engagement directory, hashed, and described in
 * the manifest. The source file is never modified.
 * @param {object} manifest The current manifest.
 * @param {string} sourcePath The file to register.
 * @param {object} options The registration options.
 * @param {string} options.dir The engagement directory.
 * @param {string} [options.classification] The classification level.
 * @param {string} [options.note] A short description.
 * @param {string} [options.id] An explicit artifact id.
 * @param {string} [options.collectedAt] The collection timestamp.
 * @returns {object} The new manifest.
 * @throws {Error} When the classification is unknown or the file is missing.
 */
export function registerArtifact(manifest, sourcePath, options = {}) {
  const { dir, classification = 'internal', note = '', id, collectedAt } = options;
  if (!CLASSIFICATIONS.includes(classification)) {
    throw new Error(
      `unknown classification ${JSON.stringify(classification)}; expected one of ${CLASSIFICATIONS.join(', ')}`,
    );
  }
  const absolute = path.resolve(sourcePath);
  if (!existsSync(absolute)) {
    throw new Error(`artifact file not found: ${sourcePath}`);
  }
  const stats = statSync(absolute);
  if (!stats.isFile()) {
    throw new Error(`artifact is not a file: ${sourcePath}`);
  }

  const bytes = readFileSync(absolute);
  const artifactId = id || nextArtifactId(manifest);
  const base = path.basename(absolute).replace(/[^A-Za-z0-9._-]/g, '_');
  const relative = path.join('artifacts', `${artifactId}-${base}`);
  const target = path.join(dir, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(absolute, target);

  const entry = {
    id: artifactId,
    path: relative.split(path.sep).join('/'),
    sha256: sha256Hex(bytes),
    size: stats.size,
    collectedAt: collectedAt || new Date().toISOString(),
    classification,
    note,
  };
  const artifacts = ((manifest && manifest.artifacts) || []).filter(
    (artifact) => artifact.id !== artifactId,
  );
  return { version: (manifest && manifest.version) || MANIFEST_VERSION, artifacts: [...artifacts, entry] };
}

/**
 * Check that every registered artifact is still present and unchanged.
 *
 * The files are read one after another. Use {@link verifyArtifactsAsync} when
 * many artifacts have to be checked: opening a file costs far more than
 * hashing its contents, and reading the files in parallel overlaps that cost.
 * @param {string} dir The engagement directory.
 * @param {object} manifest The manifest.
 * @returns {object} The verification result.
 */
export function verifyArtifacts(dir, manifest) {
  const artifacts = (manifest && manifest.artifacts) || [];
  const mismatches = [];
  for (const artifact of artifacts) {
    const target = path.join(dir, artifact.path);
    if (!existsSync(target)) {
      mismatches.push({
        id: artifact.id,
        reason: 'the artifact file is missing',
        expected: artifact.sha256,
        actual: null,
      });
      continue;
    }
    const actual = sha256Hex(readFileSync(target));
    if (actual !== artifact.sha256) {
      mismatches.push({
        id: artifact.id,
        reason: 'the artifact content no longer matches its recorded hash',
        expected: artifact.sha256,
        actual,
      });
    }
  }
  return { ok: mismatches.length === 0, checked: artifacts.length, mismatches };
}

/**
 * Check that every registered artifact is still present and unchanged, reading
 * the files in parallel.
 *
 * The result is the same as {@link verifyArtifacts}, including the order of
 * the reported mismatches. The files are opened concurrently, which matters
 * because opening a file costs much more than reading and hashing it, and
 * those opens no longer wait for one another.
 * @param {string} dir The engagement directory.
 * @param {object} manifest The manifest.
 * @returns {Promise<object>} The verification result.
 */
export async function verifyArtifactsAsync(dir, manifest) {
  const artifacts = (manifest && manifest.artifacts) || [];
  const results = await Promise.all(
    artifacts.map(async (artifact) => {
      const target = path.join(dir, artifact.path);
      let bytes;
      try {
        bytes = await readFile(target);
      } catch (error) {
        if (error && error.code === 'ENOENT') {
          return {
            id: artifact.id,
            reason: 'the artifact file is missing',
            expected: artifact.sha256,
            actual: null,
          };
        }
        return {
          id: artifact.id,
          reason: `the artifact file could not be read: ${error.message}`,
          expected: artifact.sha256,
          actual: null,
        };
      }
      const actual = sha256Hex(bytes);
      if (actual === artifact.sha256) {
        return null;
      }
      return {
        id: artifact.id,
        reason: 'the artifact content no longer matches its recorded hash',
        expected: artifact.sha256,
        actual,
      };
    }),
  );
  const mismatches = results.filter((entry) => entry !== null);
  return { ok: mismatches.length === 0, checked: artifacts.length, mismatches };
}
