# Contributing to opsledger

Thanks for taking the time to contribute.

## Getting set up

```bash
git clone https://github.com/gravion-ux/opsledger.git
cd opsledger
npm test
```

`opsledger` targets Node.js 18 or newer and has **zero runtime dependencies**. Please do not add
one. The whole point of the tool is that it runs anywhere, offline, with nothing to install and
nothing to audit.

## Making a change

1. Open an issue first for anything larger than a bug fix, so the approach can be agreed on.
2. Create a branch from `main`.
3. Add or update tests. Every behavioural change needs a test that fails without your change.
4. Run `npm test` and `npm run demo` before opening a pull request.
5. Keep the commit history readable — one logical change per commit.

## Code style

- ES modules, `"type": "module"`, 2-space indentation, semicolons.
- Every exported function carries a JSDoc comment describing its parameters and return value.
- JSDoc types use the same spelling as the rest of the portfolio (`string`, `number`, `boolean`,
  `object`, `object[]`, `Promise<...>`).
- Line endings are LF. `.gitattributes` enforces this.
- The hash chain is a **compatibility contract**. Changing how an event hash is computed invalidates
  every ledger ever written. Treat `src/hash.js` and `src/ledger.js` as frozen interfaces unless a
  ledger-format version bump is part of the change.

## Tests

The suite uses the Node.js built-in test runner:

```bash
npm test
```

`npm test` runs `node --test` with an **explicit list of test files**. Do not replace it with a
bare directory argument — `node --test <directory>` collapses into a single synthetic file and
silently stops testing what you think you are testing.

Tests must never reach the network. All filesystem access goes through a temporary directory, and
the CLI is exercised through `main(argv, out)` with a capture stream so nothing is printed to the
real stdout.

## Maintainer

Priyanshu Kumar Thakur (Gravion)

## Reporting security issues

Please follow [SECURITY.md](SECURITY.md) rather than opening a public issue.

## Code of conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
