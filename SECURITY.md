# Security Policy

## Supported Versions

DevForgeKit is currently in active development. Security fixes are
applied to the latest `main` branch and included in the next release.

| Version | Supported |
| ------- | --------- |
| latest (main) | Yes |
| previous releases | Best effort |

## Reporting a Vulnerability

If you discover a security vulnerability, please **do not** open a
public GitHub issue. Instead, email **<security@devforgekit.dev>** with:

1. A description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Suggested fix (if any)

You will receive a response within 48 hours. If the vulnerability is
confirmed, a fix will be prioritized and a GitHub Security Advisory will
be published.

## Security measures already in place

- **Plugin signing**: Ed25519 signatures + SHA-256 checksums on all
  plugin packages. Checksum verification is mandatory and cannot be
  skipped. Third-party signing keys require explicit `plugin trust`.
- **Secrets encryption**: Workspace secrets are AES-256-GCM encrypted
  with a machine-local key (`~/.config/devforgekit/workspace-secret.key`,
  mode 0600). Secrets are never included in workspace exports.
- **No telemetry**: DevForgeKit does not phone home. The `telemetry`
  config field exists but is unconsumed — no data leaves your machine.
- **No remote fetch**: The registry is local YAML files. No package
  manifests or install plans are fetched over the network.
- **Dependency scanning**: CodeQL, OSSF Scorecard, and
  dependency-review workflows run in CI. Dependabot and Renovate watch
  dependencies.
- **Input validation**: All YAML manifests are AJV-validated against
  JSON schemas. Plugin manifests are schema-validated and
  engine-compatibility-checked before registration.
- **Path safety**: `fs_safe_copy` backs up existing files before
  overwriting. The PATH manager uses idempotent marker blocks.

## Scope

This policy covers the DevForgeKit repository and its CLI. It does not
cover third-party tools that DevForgeKit installs (Homebrew packages,
npm globals, etc.) — those are the responsibility of their respective
maintainers.
