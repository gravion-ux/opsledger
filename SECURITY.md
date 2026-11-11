# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |

## Reporting a vulnerability

Please report suspected vulnerabilities privately by opening a GitHub Security Advisory on the
repository rather than a public issue. Include the affected version, reproduction steps, and the
impact you observed.

You can expect an acknowledgement within a few days. Fixes are released as a new patch version.

Maintainer: Priyanshu Kumar Thakur (Gravion).

## Scope and authorized use

`opsledger` is a defensive evidence tool. It records what happened during an engagement and proves
that the record has not been altered. It does not perform the assessment.

- `opsledger` makes **no network requests** and has **zero runtime dependencies**.
- The signing key is read only from the environment variable you name with `--sign-key-env`. The key
  is never written to the ledger, never written to disk, and never echoed into any output. Anyone
  with read access to the engagement directory can read the ledger and the artifacts, but cannot
  forge a valid signature without the key.
- **The engagement directory contains engagement metadata.** Event summaries, actor names, artifact
  notes and the registered artifacts themselves may contain sensitive target information, findings,
  credentials discovered during testing, or personal data. Treat the directory as confidential
  evidence: restrict access, encrypt it at rest, and review it before sharing a report.
- Artifact files are copied into the engagement directory verbatim. Registering a file that contains
  secrets copies those secrets into the directory as well.
- The tool never deletes or modifies a source file. It reads the file you register, copies it, and
  records its SHA-256.

Only use `opsledger` on engagements you own or are explicitly authorized to conduct, and only store
evidence you are permitted to retain.

## Key management

The HMAC key is the operator's responsibility. Use a high-entropy secret from your platform's secret
store, rotate it deliberately, and remember that rotating a key invalidates every signature produced
with the previous key. `opsledger` never stores the key, so it cannot recover one for you.
