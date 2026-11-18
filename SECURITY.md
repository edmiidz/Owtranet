# Security Policy

Owtranet stores sensitive data (member records, encrypted payroll fields,
webmail credentials, API tokens), so security reports are taken seriously.

## Reporting a vulnerability

Owtranet is pre-release, so for now please report vulnerabilities as ordinary
**public issues** on this repository, labelled or titled as security issues.
This will change to a private reporting channel before the first stable
release, and this file will be updated when it does.

Include the affected version or commit, steps to reproduce, and the impact you
expect. Credit is given in the fixing commit or release notes unless you ask
otherwise.

## Supported versions

Only the latest `main` is supported. Self-hosted instances should pull fixes
from `main` and redeploy.

## Hardening checklist for operators

- Set a long random `JWT_SECRET` (`openssl rand -hex 32`); the server refuses to
  start without it.
- Set a separate `EMAIL_ENCRYPTION_KEY` and, if agreements collect payroll
  details, a unique `PAYROLL_ENCRYPTION_KEY` per instance.
- Serve the app only over HTTPS (see `nginx.conf`) and keep `CORS_ORIGIN` set to
  your own domain.
- Treat `/api/v1/*` tokens like passwords.
