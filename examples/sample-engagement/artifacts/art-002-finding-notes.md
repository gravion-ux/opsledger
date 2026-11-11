# Finding: weak SSH banner

Severity: low

The edge host discloses its exact OpenSSH version in the protocol banner, which lets an
attacker match it against known-vulnerable builds without probing further.

Recommendation: configure `ServerTokens Minimal` and set a non-default `banner` path.
