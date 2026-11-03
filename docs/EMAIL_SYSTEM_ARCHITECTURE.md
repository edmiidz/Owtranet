# Email System Architecture

## Overview

Members whose email provider is `self_hosted` (see *Email & calendar provider*
in the README) get a mailbox on the same box as the intranet: **Postfix** for
delivery, **Dovecot** for IMAP, and the intranet's built-in webmail on top. This
document describes the **canonical** layout. Code that creates, moves or deletes
mailboxes must follow it.

Instances that use Microsoft 365 or Google Workspace for everyone can skip this
document — the self-hosted mail stack is optional.

## Configuration

| Env var (`.env`) | Purpose | Default |
|---|---|---|
| `COMPANY_EMAIL_DOMAIN` | Domain of member mailboxes (`jane@<domain>`) | — (required for self-hosted mail) |
| `MAIL_SYSTEM_ADDRESS` | Account the intranet sends system mail from via local SMTP | `system@<COMPANY_EMAIL_DOMAIN>` |
| `MAIL_SMTP_PASSWORD` | Dovecot password used for local IMAP/SMTP logins (static passdb) | — (required for webmail) |
| `MAIL_USER_SUFFIX` | Suffix of the legacy Linux mail users (`<name>-<suffix>`) — see below | `intranet` |

## Critical Architecture Principles

### 1. Virtual Mail Users (NOT System Users)

**RULE:** Email accounts are virtual mail users managed by Postfix/Dovecot. Do not create Linux system users.

- **User ID**: all virtual mail users use `uid=5000, gid=5000` (`vmail`)
- **No system users**: email accounts do not need `useradd`/`chpasswd`
- **Authentication**: Dovecot's static passdb (shared password = `MAIL_SMTP_PASSWORD`) or an SQL passdb against the intranet database

### 2. Mailbox Paths

**RULE:** Mailbox paths use the full email address.

```
✅ CORRECT:   /var/mail/jane@example.com/
❌ INCORRECT: /var/mail/jane-intranet/
❌ INCORRECT: /var/mail/jane/
```

**Why:** Dovecot expects the email-address format, and Postfix must deliver to the same path.

### 3. Database Schema (`server_email_accounts`)

**RULE:** `server_username` equals the email address.

```sql
-- CORRECT
email_address:   jane@example.com
server_username: jane@example.com   ✅

-- INCORRECT
email_address:   jane@example.com
server_username: jane-intranet      ❌
```

### 4. Postfix Virtual Mailbox Maps

**RULE:** Maps use the email address for the mailbox path.

```
# /etc/postfix/virtual_mailbox_maps
✅ CORRECT:   jane@example.com    jane@example.com/
❌ INCORRECT: jane@example.com    jane-intranet/
```

```bash
sudo postmap /etc/postfix/virtual_mailbox_maps
sudo systemctl reload postfix
```

## Where the code does this

- **Email requests** (`POST /api/email-requests` → admin approval in `server.js`)
  is the canonical path: on approval it creates `/var/mail/<email>/{cur,new,tmp}`
  owned by `vmail`, appends `<email>    <email>/` to `virtual_mailbox_maps`,
  runs `postmap`, inserts `server_email_accounts` with `server_username = email`,
  and sets `users.company_email`.
- **Admin → Company Emails** (`/api/admin/company-email/*`) links, resets and
  deletes those accounts.
- **Legacy server-account endpoints** (`/api/email/check-availability`,
  `/api/admin/email/server-accounts`, the account-creation endpoint next to
  them, and the `userdel` step of the delete endpoints) still use the older
  `<name>-${MAIL_USER_SUFFIX}` Linux-user model. They are kept for instances
  that already have such users; **new code should not extend them**, and new
  mailboxes should be created through the email-request flow.

## Email Account Creation Checklist

### Step 1: Generate Password
```javascript
const tempPassword = crypto.randomBytes(8).toString('hex');
const encryptedPassword = emailCrypto.encryptPassword(tempPassword);
```

### Step 2: Create Mailbox Directory
```bash
sudo mkdir -p "/var/mail/${email}/"{cur,new,tmp}
sudo chown -R vmail:vmail "/var/mail/${email}"
sudo chmod -R 700 "/var/mail/${email}"
```

### Step 3: Update Postfix Virtual Mailbox Maps
```bash
echo "${email}    ${email}/" | sudo tee -a /etc/postfix/virtual_mailbox_maps
sudo postmap /etc/postfix/virtual_mailbox_maps
sudo systemctl reload postfix
```

### Step 4: Database Insert
```sql
INSERT INTO server_email_accounts
  (email_address, server_username, linked_user_id, server_status, email_password_encrypted)
VALUES
  (email, email, user_id, 'active', encrypted_password);
  -- both columns hold the email address
```

### Step 5: Update User Record
```sql
UPDATE users
SET company_email = email, company_email_created_at = NOW()
WHERE id = user_id;
```

## Do Not Do These Things

### ❌ Create System Users
```bash
sudo useradd -m -s /bin/bash "${username}-${MAIL_USER_SUFFIX}"   # ❌
```

### ❌ Use Username Suffixes for New Mailboxes
```javascript
const serverUsername = `${username}-${MAIL_USER_SUFFIX}`;  // ❌ legacy only
const serverUsername = requestedEmail;                     // ✅
```

### ❌ Create Inconsistent Paths
All three must use the same format:
1. Mailbox path: `/var/mail/jane@example.com/`
2. Postfix map: `jane@example.com    jane@example.com/`
3. `server_email_accounts.server_username`: `jane@example.com`

## Authentication Flow

### Dovecot
Suggested location: `/etc/dovecot/dovecot-sql-intranet.conf.ext`

1. **SQL passdb** (optional) — authenticates selected users with their intranet password from the database.
2. **Static passdb** — every other virtual mail user authenticates with one shared password. Set the same value as `MAIL_SMTP_PASSWORD` in the intranet `.env`:
   ```
   passdb {
     driver = static
     args = password=<your-dovecot-password>
   }
   ```

### Webmail
`emailUtils.js` opens IMAP to `localhost:993` as `server_username` using
`MAIL_SMTP_PASSWORD`. The per-user encrypted password stored in
`server_email_accounts` is not yet used for IMAP.

## Verification Commands

```bash
# Accounts whose server_username differs from the address (should be empty,
# or only legacy <name>-<suffix> accounts)
mysql owtranet -e "SELECT email_address, server_username FROM server_email_accounts
                   WHERE email_address != server_username;"

# Mailboxes use the email format
ls -la /var/mail/ | grep "@example.com"

# Postfix mapping format: jane@example.com    jane@example.com/
grep "@example.com" /etc/postfix/virtual_mailbox_maps

# Dovecot sees the user
sudo doveadm user jane@example.com
sudo doveadm auth test jane@example.com '<your-dovecot-password>'
# expect uid 5000, gid 5000, home /var/mail/jane@example.com
```

## Before Changing Mail Code

1. Look at how existing accounts are configured (`server_email_accounts`, `/var/mail`, `virtual_mailbox_maps`).
2. Check how Dovecot sees a user with `doveadm user`.
3. Test on one account: create it, check the mailbox, IMAP login, webmail, and delivery.
4. Compare with the checklist above.

Red flags: `useradd`/`chpasswd`, username suffixes on new accounts, different
paths in Postfix vs Dovecot, `server_username` ≠ `email_address`.

## Group Email Aliases (Forwarding)

Group aliases forward mail to several people instead of delivering to a local
mailbox. They live in `/etc/postfix/virtual`, **not** `virtual_mailbox_maps`.

| File | Purpose | Example |
|------|---------|---------|
| `/etc/postfix/virtual_mailbox_maps` | Local mailbox delivery | `jane@example.com → jane@example.com/` |
| `/etc/postfix/virtual` | Forwarding / aliases | `sales@example.com → jane@example.com, sam@example.com` |

If an address is in both files, `virtual_mailbox_maps` wins and mail is
delivered locally instead of forwarded.

### Example `/etc/postfix/virtual`

```
sales@example.com        jane@example.com, sam@example.com
support@example.com      sam@example.com
engineering@example.com  jane@example.com, alex@example.com, sam@example.com

# AUTO-GENERATED GROUP ALIASES
...
```

### Automatic sync

`scripts/sync-email-aliases.sh` (called from `api/sync-email-aliases.js` when
groups change) regenerates everything below the `# AUTO-GENERATED GROUP ALIASES`
marker from the `groups` / `group_members` tables, keeps manual entries above
the marker, backs up the file to `/etc/postfix/backups/`, and runs `postmap` +
reload. Put hand-maintained aliases **above** the marker.

Members forward to `COALESCE(users.company_email, users.email)`:

```sql
SELECT gm.group_id, u.name, COALESCE(u.company_email, u.email) AS forward_email
FROM group_members gm JOIN users u ON gm.user_id = u.id;
```

### Adding an alias by hand

```bash
echo "newgroup@example.com    jane@example.com, sam@example.com" | sudo tee -a /etc/postfix/virtual
sudo postmap /etc/postfix/virtual
sudo systemctl reload postfix
```

### Converting a mailbox to a forwarding alias

```bash
sudo sed -i '/^sales@example.com/d' /etc/postfix/virtual_mailbox_maps
sudo postmap /etc/postfix/virtual_mailbox_maps
echo "sales@example.com    jane@example.com" | sudo tee -a /etc/postfix/virtual
sudo postmap /etc/postfix/virtual
sudo systemctl reload postfix
```

### Where would mail go?

```bash
postmap -q "sales@example.com" /etc/postfix/virtual_mailbox_maps
postmap -q "sales@example.com" /etc/postfix/virtual
```

## Related Files

- Email request / approval and admin email endpoints: `server.js`
- Webmail IMAP/SMTP: `emailUtils.js`
- Alias sync: `scripts/sync-email-aliases.sh`, `api/sync-email-aliases.js`
- Postfix: `/etc/postfix/virtual_mailbox_maps`, `/etc/postfix/virtual`
- Dovecot: `/etc/dovecot/dovecot-sql-intranet.conf.ext`
- Tables: `server_email_accounts`, `groups`, `group_members`, `users.company_email`
