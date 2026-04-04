# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 0.1.0-beta.1 | ✅ Active |

---

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email: **security@refactron.dev**

Include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fix (optional)

You will receive an acknowledgement within 48 hours. We aim to release a patch within 14 days of confirmation.

We will credit you in the release notes unless you prefer to remain anonymous.

---

## Scope

In scope:
- Remote code execution via crafted input files
- Path traversal in file analysis or fix application
- Secrets leaking through analysis output
- Dependency vulnerabilities with known CVEs

Out of scope:
- Issues requiring physical access to the machine
- Social engineering
- Bugs in `--dry-run` output only (no filesystem writes)
