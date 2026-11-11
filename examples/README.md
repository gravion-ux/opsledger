# opsledger examples

## `sample-engagement/`

A complete, valid engagement built by the library itself, so every hash in it is a real hash.
Verify it straight from the repository:

```bash
opsledger verify --dir examples/sample-engagement
```

```text
opsledger: 4 event(s) checked
opsledger: chain INTACT
opsledger: ledger is unsigned
opsledger: 2 artifact(s) checked
```

Render its report:

```bash
opsledger report --dir examples/sample-engagement --format md
```

The engagement contains four events — a phase, an action, a finding and a note — and two registered
artifacts with their SHA-256 digests and classifications.

## `sample-artifacts/`

The raw source files the sample engagement was built from: a recon transcript and a finding
write-up. They are here so you can register them yourself and watch the ledger grow:

```bash
opsledger init --dir ./MY-ENGAGEMENT
opsledger artifact add --dir ./MY-ENGAGEMENT --path examples/sample-artifacts/recon-transcript.txt \
  --classification confidential --note "initial recon transcript"
opsledger event add --dir ./MY-ENGAGEMENT --type action --summary "port scan of the edge host"
opsledger verify --dir ./MY-ENGAGEMENT
```

Registering the same file twice is safe: the artifact is copied into the engagement directory, and
the source file is never modified.

## Breaking the chain on purpose

To see what tamper detection reports, change one character in the sample ledger and verify again:

```bash
opsledger verify --dir examples/sample-engagement
```

```text
opsledger: chain BROKEN at event 1
opsledger: event 1 does not match its recorded hash
opsledger: expected 9f2c...
opsledger: recorded 41ab...
```

Put the file back afterwards — the example is committed to the repository and should stay intact.
