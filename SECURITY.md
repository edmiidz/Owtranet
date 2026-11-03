# Security Policy

Owtranet stores sensitive data (member records, encrypted payroll fields,
webmail credentials, API tokens), so security reports are taken seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Report privately through GitHub:
**Security → Report a vulnerability** on this repository
(https://github.com/edmiidz/Owtranet/security/advisories/new).

Include the affected version or commit, steps to reproduce, and the impact you
expect. You should get an acknowledgement within a few days. Once a fix is
released, the advisory is published with credit to you unless you ask
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
