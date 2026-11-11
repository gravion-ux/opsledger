#!/usr/bin/env node
/**
 * opsledger — command line interface.
 * @module opsledger/cli
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { emptyManifest, loadManifest, registerArtifact, saveManifest, verifyArtifacts } from './artifacts.js';
import { EVENT_TYPES, appendEvent, createLedger, signLedger } from './ledger.js';
import { toHtml, toJson, toMarkdown } from './report.js';
import { verifyChain } from './verify.js';

/**
 * Everything went as expected.
 * @type {number}
 */
export const EXIT_OK = 0;

/**
 * Verification failed, or a required input was missing.
 * @type {number}
 */
export const EXIT_FAILURE = 1;

/**
 * The command line was wrong.
 * @type {number}
 */
export const EXIT_USAGE = 2;

const USAGE = `opsledger — tamper-evident evidence ledger for red-team engagements

Usage:
  opsledger init --dir ENGAGEMENT [--sign-key-env ENV]
  opsledger artifact add --dir ENGAGEMENT --path FILE [--classification LEVEL] [--note TEXT]
                          [--id ID] [--sign-key-env ENV]
  opsledger event add --dir ENGAGEMENT --type ACTION --summary TEXT [--actor TEXT] [--ref ID]
                       [--sign-key-env ENV]
  opsledger verify --dir ENGAGEMENT [--key-env ENV]
  opsledger report --dir ENGAGEMENT [--format md|html|json] [--out FILE]
  opsledger demo

Classifications: public, internal, confidential, restricted
Event types: ${EVENT_TYPES.join(', ')}

Exit codes: 0 success, 1 verification failed or input missing, 2 usage error.`;

/**
 * Parse a list of command line arguments into flags and positional values.
 * @param {string[]} args The arguments.
 * @returns {object} The parsed arguments.
 */
export function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const equals = body.indexOf('=');
    if (equals >= 0) {
      flags[body.slice(0, equals)] = body.slice(equals + 1);
      continue;
    }
    const next = args[index + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[body] = true;
      continue;
    }
    flags[body] = next;
    index += 1;
  }
  return { flags, positional };
}

/**
 * Return the path of the ledger document.
 * @param {string} dir The engagement directory.
 * @returns {string} The ledger path.
 */
export function ledgerPath(dir) {
  return path.join(dir, 'ledger.json');
}

/**
 * Load the ledger of an engagement directory.
 * @param {string} dir The engagement directory.
 * @returns {object|null} The ledger, or null when it does not exist.
 */
export function loadLedger(dir) {
  const target = ledgerPath(dir);
  if (!existsSync(target)) {
    return null;
  }
  return JSON.parse(readFileSync(target, 'utf8'));
}

/**
 * Write the ledger of an engagement directory.
 * @param {string} dir The engagement directory.
 * @param {object} ledger The ledger.
 * @returns {void}
 */
export function saveLedger(dir, ledger) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(ledgerPath(dir), `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
}

/**
 * Resolve the signing key from the environment.
 * @param {object} flags The parsed flags.
 * @returns {object} The key and any error.
 */
export function resolveKey(flags) {
  const name = flags['sign-key-env'] || flags['key-env'];
  if (!name || name === true) {
    return { key: null, name: null, error: null };
  }
  const value = process.env[name];
  if (!value) {
    return { key: null, name, error: `the environment variable ${name} is not set` };
  }
  return { key: value, name, error: null };
}

/**
 * Re-sign the ledger when it already carries a signature.
 * @param {object} ledger The ledger.
 * @param {object} manifest The artifact manifest.
 * @param {object} flags The parsed flags.
 * @returns {object} The ledger and any error.
 */
function resignIfNeeded(ledger, manifest, flags) {
  if (!ledger.signature) {
    return { ledger, error: null };
  }
  const { key, name, error } = resolveKey(flags);
  if (error) {
    return { ledger, error: `this ledger is signed; ${error}. Pass --sign-key-env ${name} to continue.` };
  }
  if (!key) {
    return {
      ledger,
      error: 'this ledger is signed; pass --sign-key-env to re-sign it after the change',
    };
  }
  return { ledger: signLedger(ledger, key, manifest), error: null };
}

/**
 * Create a new engagement directory.
 * @param {object} flags The parsed flags.
 * @param {*} out The output stream.
 * @returns {number} The exit code.
 */
export function cmdInit(flags, out) {
  const dir = flags.dir;
  if (!dir || dir === true) {
    out.write('opsledger: init needs --dir ENGAGEMENT\n');
    return EXIT_USAGE;
  }
  if (existsSync(ledgerPath(dir))) {
    out.write(`opsledger: an engagement ledger already exists at ${ledgerPath(dir)}\n`);
    return EXIT_FAILURE;
  }
  const { key, error } = resolveKey(flags);
  if (error) {
    out.write(`opsledger: ${error}\n`);
    return EXIT_FAILURE;
  }

  const engagement = path.basename(path.resolve(dir));
  const ledger = createLedger({ engagement, createdAt: new Date().toISOString() });
  const manifest = emptyManifest();
  mkdirSync(path.join(dir, 'artifacts'), { recursive: true });
  saveLedger(dir, key ? signLedger(ledger, key, manifest) : ledger);
  saveManifest(dir, manifest);

  out.write(`opsledger: created engagement ${engagement} at ${path.resolve(dir)}\n`);
  out.write(key ? 'opsledger: the ledger is signed\n' : 'opsledger: the ledger is unsigned\n');
  return EXIT_OK;
}

/**
 * Register an artifact in an engagement.
 * @param {object} flags The parsed flags.
 * @param {*} out The output stream.
 * @returns {number} The exit code.
 */
export function cmdArtifactAdd(flags, out) {
  const dir = flags.dir;
  const source = flags.path;
  if (!dir || dir === true || !source || source === true) {
    out.write('opsledger: artifact add needs --dir ENGAGEMENT and --path FILE\n');
    return EXIT_USAGE;
  }
  const ledger = loadLedger(dir);
  if (!ledger) {
    out.write(`opsledger: no engagement ledger at ${ledgerPath(dir)}\n`);
    return EXIT_FAILURE;
  }

  let manifest;
  try {
    manifest = registerArtifact(loadManifest(dir), source, {
      dir,
      classification: flags.classification === true ? 'internal' : flags.classification,
      note: flags.note === true ? '' : flags.note || '',
      id: flags.id === true ? undefined : flags.id,
    });
  } catch (error) {
    out.write(`opsledger: ${error.message}\n`);
    return EXIT_FAILURE;
  }

  const signed = resignIfNeeded(ledger, manifest, flags);
  if (signed.error) {
    out.write(`opsledger: ${signed.error}\n`);
    return EXIT_FAILURE;
  }
  saveManifest(dir, manifest);
  saveLedger(dir, signed.ledger);

  const entry = manifest.artifacts[manifest.artifacts.length - 1];
  out.write(`opsledger: registered ${entry.id} (${entry.path})\n`);
  out.write(`opsledger: sha256 ${entry.sha256}\n`);
  return EXIT_OK;
}

/**
 * Append an event to an engagement.
 * @param {object} flags The parsed flags.
 * @param {*} out The output stream.
 * @returns {number} The exit code.
 */
export function cmdEventAdd(flags, out) {
  const dir = flags.dir;
  const type = flags.type;
  const summary = flags.summary;
  if (!dir || dir === true || !type || type === true || !summary || summary === true) {
    out.write('opsledger: event add needs --dir ENGAGEMENT, --type ACTION and --summary TEXT\n');
    return EXIT_USAGE;
  }
  if (!EVENT_TYPES.includes(type)) {
    out.write(`opsledger: unknown event type ${JSON.stringify(type)}; expected one of ${EVENT_TYPES.join(', ')}\n`);
    return EXIT_USAGE;
  }
  const ledger = loadLedger(dir);
  if (!ledger) {
    out.write(`opsledger: no engagement ledger at ${ledgerPath(dir)}\n`);
    return EXIT_FAILURE;
  }

  const manifest = loadManifest(dir);
  const updated = appendEvent(ledger, {
    type,
    summary,
    actor: flags.actor === true ? undefined : flags.actor,
    ref: flags.ref === true ? undefined : flags.ref,
  });
  const signed = resignIfNeeded(updated, manifest, flags);
  if (signed.error) {
    out.write(`opsledger: ${signed.error}\n`);
    return EXIT_FAILURE;
  }
  saveLedger(dir, signed.ledger);

  const event = signed.ledger.events[signed.ledger.events.length - 1];
  out.write(`opsledger: recorded event ${event.index} (${event.type})\n`);
  out.write(`opsledger: hash ${event.eventHash}\n`);
  return EXIT_OK;
}

/**
 * Verify the chain and the artifacts of an engagement.
 * @param {object} flags The parsed flags.
 * @param {*} out The output stream.
 * @returns {number} The exit code.
 */
export function cmdVerify(flags, out) {
  const dir = flags.dir;
  if (!dir || dir === true) {
    out.write('opsledger: verify needs --dir ENGAGEMENT\n');
    return EXIT_USAGE;
  }
  const ledger = loadLedger(dir);
  if (!ledger) {
    out.write(`opsledger: no engagement ledger at ${ledgerPath(dir)}\n`);
    return EXIT_FAILURE;
  }
  const { key, error } = resolveKey(flags);
  if (error) {
    out.write(`opsledger: ${error}\n`);
    return EXIT_FAILURE;
  }

  const manifest = loadManifest(dir);
  const result = verifyChain(ledger, { key, manifest });
  const artifacts = verifyArtifacts(dir, manifest);

  out.write(`opsledger: ${result.checked} event(s) checked\n`);
  if (result.ok) {
    out.write('opsledger: chain INTACT\n');
  } else {
    out.write(`opsledger: chain BROKEN at event ${result.brokenIndex}\n`);
    out.write(`opsledger: ${result.reason}\n`);
    if (result.expectedHash) {
      out.write(`opsledger: expected ${result.expectedHash}\n`);
    }
    if (result.actualHash) {
      out.write(`opsledger: recorded ${result.actualHash}\n`);
    }
  }
  if (result.signature.present) {
    if (result.signature.valid === true) {
      out.write('opsledger: signature verified\n');
    } else if (result.signature.valid === false) {
      out.write('opsledger: signature INVALID — the supplied key does not match\n');
    } else {
      out.write('opsledger: signature present, not checked because no key was supplied\n');
    }
  } else {
    out.write('opsledger: ledger is unsigned\n');
  }
  if (artifacts.checked > 0) {
    out.write(`opsledger: ${artifacts.checked} artifact(s) checked\n`);
  }
  if (!artifacts.ok) {
    out.write(`opsledger: ${artifacts.mismatches.length} artifact(s) do not match their manifest\n`);
    for (const mismatch of artifacts.mismatches) {
      out.write(`opsledger:   ${mismatch.id}: ${mismatch.reason}\n`);
    }
  }

  return result.ok && artifacts.ok ? EXIT_OK : EXIT_FAILURE;
}

/**
 * Render the engagement report.
 * @param {object} flags The parsed flags.
 * @param {*} out The output stream.
 * @returns {number} The exit code.
 */
export function cmdReport(flags, out) {
  const dir = flags.dir;
  if (!dir || dir === true) {
    out.write('opsledger: report needs --dir ENGAGEMENT\n');
    return EXIT_USAGE;
  }
  const format = flags.format === true ? 'md' : flags.format || 'md';
  if (!['md', 'html', 'json'].includes(format)) {
    out.write(`opsledger: unknown format ${JSON.stringify(format)}; expected md, html or json\n`);
    return EXIT_USAGE;
  }
  const ledger = loadLedger(dir);
  if (!ledger) {
    out.write(`opsledger: no engagement ledger at ${ledgerPath(dir)}\n`);
    return EXIT_FAILURE;
  }
  const manifest = loadManifest(dir);
  const verification = verifyChain(ledger, { manifest });

  let payload;
  if (format === 'html') {
    payload = toHtml(ledger, manifest, verification);
  } else if (format === 'json') {
    payload = toJson(ledger, manifest, verification);
  } else {
    payload = toMarkdown(ledger, manifest, verification);
  }

  const destination = flags.out;
  if (destination && destination !== true) {
    mkdirSync(path.dirname(path.resolve(destination)), { recursive: true });
    writeFileSync(path.resolve(destination), payload, 'utf8');
    out.write(`opsledger: wrote the ${format} report to ${path.resolve(destination)}\n`);
  } else {
    out.write(payload);
  }
  return EXIT_OK;
}

/**
 * Build a throwaway engagement and show what the tool does.
 * @param {object} flags The parsed flags.
 * @param {*} out The output stream.
 * @returns {number} The exit code.
 */
export function cmdDemo(flags, out) {
  const root = mkdtempSync(path.join(tmpdir(), 'opsledger-demo-'));
  const dir = path.join(root, 'CONTOSO-2026-11');
  mkdirSync(dir, { recursive: true });

  const transcript = path.join(root, 'recon-transcript.txt');
  writeFileSync(transcript, 'host discovery: 10.10.10.5\nservice scan: 22/tcp open\n', 'utf8');
  const finding = path.join(root, 'finding-notes.md');
  writeFileSync(finding, '# Finding\n\nWeak SSH banner on the edge host.\n', 'utf8');

  out.write(`opsledger: demo engagement at ${dir}\n\n`);

  const initFlags = { dir };
  out.write(`> opsledger init --dir ${dir}\n`);
  cmdInit(initFlags, out);

  out.write(`\n> opsledger artifact add --path ${transcript} --classification confidential\n`);
  cmdArtifactAdd({ dir, path: transcript, classification: 'confidential', note: 'initial recon transcript' }, out);

  out.write(`\n> opsledger artifact add --path ${finding} --classification internal\n`);
  cmdArtifactAdd({ dir, path: finding, classification: 'internal', note: 'weak SSH banner' }, out);

  out.write('\n> opsledger event add --type phase --summary "reconnaissance"\n');
  cmdEventAdd({ dir, type: 'phase', summary: 'reconnaissance', actor: 'operator' }, out);

  out.write('\n> opsledger event add --type action --summary "port scan of the edge host"\n');
  cmdEventAdd({ dir, type: 'action', summary: 'port scan of the edge host', actor: 'operator', ref: 'art-001' }, out);

  out.write('\n> opsledger event add --type finding --summary "weak SSH banner observed"\n');
  cmdEventAdd({ dir, type: 'finding', summary: 'weak SSH banner observed', actor: 'operator', ref: 'art-002' }, out);

  out.write('\n> opsledger verify --dir ENGAGEMENT\n');
  const verified = cmdVerify({ dir }, out);

  out.write('\n> opsledger report --format md\n');
  cmdReport({ dir, format: 'md' }, out);

  out.write('\nopsledger: the demo engagement is a throwaway directory, and it is not removed automatically\n');
  const removal = process.platform === 'win32'
    ? `Remove-Item -LiteralPath "${root}" -Recurse -Force`
    : `rm -rf "${root}"`;
  out.write(`opsledger: remove it with: ${removal}\n`);
  return verified;
}

/**
 * Run the command line interface.
 * @param {string[]} argv The arguments, without the node executable and script.
 * @param {*} out The output stream.
 * @returns {number} The exit code.
 */
export function main(argv, out = process.stdout) {
  const [command, ...rest] = argv;

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    out.write(`${USAGE}\n`);
    return command ? EXIT_OK : EXIT_USAGE;
  }

  if (command === 'init') {
    return cmdInit(parseFlags(rest).flags, out);
  }
  if (command === 'verify') {
    return cmdVerify(parseFlags(rest).flags, out);
  }
  if (command === 'report') {
    return cmdReport(parseFlags(rest).flags, out);
  }
  if (command === 'demo') {
    return cmdDemo(parseFlags(rest).flags, out);
  }
  if (command === 'artifact') {
    const [subcommand, ...args] = rest;
    if (subcommand !== 'add') {
      out.write('opsledger: artifact takes the subcommand "add"\n');
      return EXIT_USAGE;
    }
    return cmdArtifactAdd(parseFlags(args).flags, out);
  }
  if (command === 'event') {
    const [subcommand, ...args] = rest;
    if (subcommand !== 'add') {
      out.write('opsledger: event takes the subcommand "add"\n');
      return EXIT_USAGE;
    }
    return cmdEventAdd(parseFlags(args).flags, out);
  }

  out.write(`opsledger: unknown command ${JSON.stringify(command)}\n\n${USAGE}\n`);
  return EXIT_USAGE;
}

// Compare resolved paths rather than the `file://` URL, because the URL form
// of the script path differs between platforms: on Windows `process.argv[1]`
// is a drive-letter path, so a `file://` comparison never matches and the
// command line silently does nothing.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
