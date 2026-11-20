# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Building a ledger no longer copies the event list once per event. `appendEvent` copies it on every
  call, so recording n events one after another copied the list n times over. The new `appendEvents`
  copies it once and adds every event, which keeps the cost proportional to the number of events
  rather than to its square.
  Measured against the previous revision on the same machine, with 8000 events, building a ledger is
  5.3 times faster.
- The `verify` command reads the artifact files in parallel. Opening a file costs far more than
  hashing its contents, and the opens no longer wait for one another.
  Measured on the same machine, with 200 artifact files of 64 KiB each, checking every artifact is
  4.0 times faster.
- Digests are computed with the one-shot `crypto.hash` function when the running Node build has it,
  which arrived in Node 20.12 and 21.7. The digest is identical either way, and the older
  `createHash` path is still used when the one-shot function is not available.
  Measured on the same machine, verifying a chain of 8000 events is 1.15 times faster.

### Added

- `appendEvents`, which appends a list of events in one pass and produces exactly the same ledger as
  appending them one at a time.
- `verifyArtifactsAsync`, which checks every registered artifact by reading the files in parallel and
  returns the same result as `verifyArtifacts`, including the order of the reported mismatches.
- `bench/benchmark.mjs`, which times the ledger, verification, report and artifact paths against a
  built-in corpus, so the numbers above can be reproduced with `node bench/benchmark.mjs`.

### Notes

- The command line interface is now asynchronous: `main` and `cmdVerify` return a promise for the
  exit code. The command line behaviour and the exit codes are unchanged, and the documented library
  API in `src/index.js` is unchanged.

## [0.1.0] - 2026-11-10

### Added

- Hash-chained engagement ledger: every event carries the SHA-256 of its own canonical serialization
  chained onto its predecessor's hash, starting from a fixed genesis hash.
- Canonical JSON serializer with recursive key sorting, so a hash does not depend on the order in
  which keys were written.
- Ledger document with `version`, `engagement`, `createdAt`, `events`, a `state` block recording the
  event count and the head hash, and an optional `signature`.
- Event types `action`, `finding`, `note`, `artifact` and `phase`.
- Artifact registration: files are copied into the engagement directory, hashed with SHA-256, and
  described in a manifest with an id, path, size, collection timestamp, classification and note.
- Classification levels `public`, `internal`, `confidential` and `restricted`.
- Chain verification that reports the precise first broken link, and separately detects a truncated
  tail through the recorded event count and head hash.
- Optional HMAC-SHA256 ledger signature that covers the ledger and the artifact manifest, with the
  key read only from an environment variable.
- Markdown, HTML and JSON report emitters.
- `init`, `artifact add`, `event add`, `verify`, `report` and `demo` CLI subcommands with exit codes
  0, 1 and 2.

[0.1.0]: https://github.com/gravion-ux/opsledger/releases/tag/v0.1.0
