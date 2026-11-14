# opsledger

Tamper-evident, locally verifiable evidence ledger for red-team engagements.

[![CI](https://github.com/gravion-ux/opsledger/actions/workflows/ci.yml/badge.svg)](https://github.com/gravion-ux/opsledger/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-43853d.svg)](https://nodejs.org)

## The problem

Every engagement produces evidence: a recon transcript, a set of screenshots, a packet capture, a
finding write-up, a list of commands that were run. At the end of the engagement somebody has to be
able to answer three questions.

1. Did this file change after it was collected?
2. Did this record change after it was written?
3. Can I show that the evidence and the account of the engagement still belong together?

The answers usually live in a spreadsheet, a folder of files with timestamps, and the memory of the
person who ran the engagement. Timestamps are not evidence — anyone with write access can change a
file and update its modification time. A spreadsheet is not evidence either, for the same reason.

The cryptographic answer is old and well understood: hash each record, chain the hashes so that
changing any record changes every hash after it, and sign the result with a key that only the
operator holds. `opsledger` does exactly that, in one file, with no server and no database.

## What this exists for

| Approach | What it gives you | What it does not give you |
| --- | --- | --- |
| A folder of files plus a spreadsheet | A list of what was collected | Any proof that the files or the list were not altered |
| `sha256sum` per file, checked in a script | Per-file integrity at a point in time | A link between the files and the sequence of events, or any tamper *location* |
| Forensics case-management software | A full workflow with an acquisition trail | A tool that is small enough to run on a laptop during a live engagement, with no database to provision |
| A GRC or evidence platform | Centralised records and retention policy | Local, offline, dependency-free operation during an engagement |

`opsledger` is deliberately the opposite of a platform: a single-file CLI with **zero runtime
dependencies**, no network access, no telemetry and no account. Everything it writes stays in the
engagement directory you point it at.

## How the chain works

Every event in the ledger carries the SHA-256 of its own content, chained onto the hash of the
event before it.

```
 genesis                event 0                event 1                event 2
 (64 zeros)  -->  hash of event 0  -->  hash of event 1  -->  hash of event 2
                   + prev hash           + prev hash           + prev hash
```

Concretely, for each event:

```
eventHash = SHA-256( canonicalJson(event without its own eventHash) + previousHash )
```

`canonicalJson` sorts object keys recursively and emits compact JSON, so the same logical event
always produces the same bytes and therefore the same hash — the hash does not depend on the order
the keys were written in.

Because each hash covers the previous one, changing an event changes its hash, which changes the
next event's hash, and so on to the end of the ledger. `opsledger verify` walks the chain from the
genesis hash and reports the **precise index of the first broken link**, not just "the chain
failed":

```bash
opsledger verify --dir ENGAGEMENT
```

```text
opsledger: 3 event(s) checked
opsledger: chain BROKEN at event 1
opsledger: event 1 does not match its recorded hash
opsledger: expected 9f2c...
opsledger: recorded 41ab...
```

### Catching a truncated tail

A chain alone cannot detect the removal of the **last** event — the remaining chain is still
internally consistent. The ledger therefore also records a `state` block:

```json
{ "eventCount": 3, "headHash": "41ab..." }
```

Verification checks the recorded event count and head hash after the chain walk, so a removed tail,
or a tail whose links were recomputed to hide the removal, is still reported.

## What verification proves — and what it does not

This matters, so it is stated plainly.

**An unsigned ledger proves** that the record has not been changed since it was written, provided
nobody with access to the ledger rewrote the whole chain from scratch. The chain is a consistency
guarantee, not an identity guarantee. An attacker who can rewrite every event and recompute every
hash produces a perfectly consistent ledger.

**A signed ledger closes that gap.** With an HMAC key the operator controls, the signature covers the
ledger *and* the artifact manifest. Someone who cannot reach the key cannot produce a valid
signature, and therefore cannot produce a ledger that verifies. Because the signature covers the
manifest too, evidence added after signing invalidates the signature until the ledger is signed
again — which is the behaviour you want, because evidence added behind the operator's back should
be visible.

**What `opsledger` does not do:**

- It does not prove **when** something happened. Timestamps come from the local clock and can be
  wrong or forged. It proves the record is unaltered, not that the clock was honest.
- It does not provide **non-repudiation**. The HMAC key is symmetric: anyone holding it can produce
  a signature. Use it to detect tampering, not to attribute authorship in a dispute.
- It does not encrypt anything. The ledger and the artifacts are plain files. Protect the engagement
  directory with filesystem permissions and encryption at rest.
- It does not prove the evidence was **collected correctly**. It proves the evidence has not changed
  since collection. A transcript written by hand hashes just as cleanly as one captured by a tool.
- It does not **verify external truth**. It never contacts an artifact repository, a timestamp
  authority, or a peer. If you need an external anchor, publish the head hash somewhere immutable
  and keep that separately.

## Install

```bash
npm install -g opsledger
```

Or run it without installing:

```bash
npx opsledger demo
```

## 30-second quick start

```bash
# 1. Create an engagement.
opsledger init --dir ./ENGAGEMENT

# 2. Register the evidence you collected.
opsledger artifact add --dir ./ENGAGEMENT --path ./recon-transcript.txt --classification confidential

# 3. Record what happened.
opsledger event add --dir ./ENGAGEMENT --type action --summary "port scan of the edge host" --actor operator

# 4. Prove nothing has changed.
opsledger verify --dir ./ENGAGEMENT

# 5. Write the report.
opsledger report --dir ./ENGAGEMENT --format md --out report.md
```

A complete, deterministic example ships with the repository:

```bash
npm run demo
```

## CLI

```
opsledger init --dir ENGAGEMENT [--sign-key-env ENV]
opsledger artifact add --dir ENGAGEMENT --path FILE [--classification LEVEL] [--note TEXT]
                        [--id ID] [--sign-key-env ENV]
opsledger event add --dir ENGAGEMENT --type TYPE --summary TEXT [--actor TEXT] [--ref ID]
                     [--sign-key-env ENV]
opsledger verify --dir ENGAGEMENT [--key-env ENV]
opsledger report --dir ENGAGEMENT [--format md|html|json] [--out FILE]
opsledger demo
```

Exit codes: `0` success — and for `verify`, an intact chain, `1` verification failed or a required
input was missing, `2` usage error.

### Event types

| Type | Use it for |
| --- | --- |
| `phase` | A shift in the engagement, such as `reconnaissance` or `exploitation` |
| `action` | A command or operation that was performed |
| `finding` | A vulnerability or weakness that was observed |
| `artifact` | Evidence that was collected or handed over |
| `note` | Anything else worth recording in the timeline |

Every event records an `index`, a `type`, a one-line `summary`, an optional `actor`, an optional
`ref` (usually an artifact id such as `art-001`) and a `timestamp`.

### Classifications

Artifacts are labelled `public`, `internal`, `confidential` or `restricted`. The default is
`internal`. The label is recorded in the manifest and shown in the reports; `opsledger` does not
enforce access control — the classification is a statement you make, not a permission it grants.

### Signing a ledger

The signing key is read **only** from an environment variable. It is never written to disk, never
stored in the ledger, and never echoed into any output.

```bash
export OPSLEDGER_KEY="$(openssl rand -hex 32)"
opsledger init --dir ./ENGAGEMENT --sign-key-env OPSLEDGER_KEY
opsledger event add --dir ./ENGAGEMENT --type note --summary "scope agreed" --sign-key-env OPSLEDGER_KEY
opsledger verify --dir ./ENGAGEMENT --key-env OPSLEDGER_KEY
```

A **signed ledger requires `--sign-key-env` for every mutation.** Because the signature covers the
artifact manifest, registering a new artifact after signing changes the signed payload, so the
ledger has to be signed again. `opsledger` refuses the mutation rather than silently invalidating
the signature.

`opsledger verify` reports the three signature states separately, because they mean different
things:

```text
opsledger: ledger is unsigned
opsledger: signature present, not checked because no key was supplied
opsledger: signature verified
opsledger: signature INVALID — the supplied key does not match
```

## Storage layout

Everything lives in the engagement directory. Nothing is written anywhere else.

```
ENGAGEMENT/
  ledger.json      the hash-chained event ledger, its state block and its signature
  manifest.json    the artifact manifest
  artifacts/
    art-001-recon-transcript.txt
    art-002-finding-notes.md
```

The manifest entry for each artifact is:

```json
{
  "id": "art-001",
  "path": "artifacts/art-001-recon-transcript.txt",
  "sha256": "...",
  "size": 2048,
  "collectedAt": "2026-11-02T09:12:00.000Z",
  "classification": "confidential",
  "note": "initial recon transcript"
}
```

Registering a file copies it into `artifacts/` and never modifies the source. `opsledger verify`
also re-hashes every registered artifact and reports any that no longer match their recorded
digest, so a swapped or edited evidence file is caught alongside an edited ledger.

## Reports

```bash
opsledger report --dir ./ENGAGEMENT --format md      # Markdown, to stdout
opsledger report --dir ./ENGAGEMENT --format html    # self-contained HTML page
opsledger report --dir ./ENGAGEMENT --format json    # machine-readable
opsledger report --dir ./ENGAGEMENT --format md --out report.md
```

The Markdown report holds the engagement header, the verification result, the event timeline and the
artifact manifest with hashes. The HTML report is the same content in a single self-contained page
with every interpolated value escaped. The JSON report is the ledger, the manifest and the
verification result as one document.

Reports do **not** check the signature — `report` has no key flag, so a signed ledger appears in the
report as signed but unchecked. Run `opsledger verify --key-env ENV` when the signature matters.

## Library use

```js
import { appendEvent, createLedger, signLedger, verifyChain } from 'opsledger';

const ledger = appendEvent(createLedger({ engagement: 'ACME-2026-11', createdAt: new Date().toISOString() }), {
  type: 'action',
  summary: 'port scan of the edge host',
  actor: 'operator',
});

const signed = signLedger(ledger, process.env.OPSLEDGER_KEY, { version: 1, artifacts: [] });
const result = verifyChain(signed, { key: process.env.OPSLEDGER_KEY });
console.log(result.ok, result.brokenIndex);
```

## Development

```bash
npm test          # node --test with an explicit test file list
npm run demo      # deterministic end-to-end demo
```

Requires Node.js 18 or newer. The test suite has no network access and no runtime dependencies.

## Scope and legal

`opsledger` is a recording and verification tool. It does not scan, probe, exploit, or connect to
anything, and it makes no network requests of any kind. It records what you tell it and proves that
record has not changed.

Use it only on engagements you own or are explicitly authorized to conduct. An engagement directory
contains sensitive information about your targets — treat it as confidential evidence, and review
anything you share from it.

## Author

Priyanshu Kumar Thakur (Gravion)

## Sponsors

Sponsorship pays for the maintenance, triage and release time behind this tool. Sponsors are
listed here by name, and name placement starts at the $25 a month tier.

- [Sponsor on GitHub](https://github.com/sponsors/gravion-ux)

## License

[MIT](LICENSE)
