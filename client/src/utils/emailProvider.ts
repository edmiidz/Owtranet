import type { EmailProvider, User } from '../types';

/** The provider a member effectively uses: their own choice, else the instance default. */
export function effectiveEmailProvider(
  user: Pick<User, 'email_provider'> | null | undefined,
  defaultEmailProvider: EmailProvider
): EmailProvider {
  return user?.email_provider || defaultEmailProvider;
}

/**
 * Only the self-hosted provider (Postfix/Dovecot + Nextcloud) has Webmail and automatic
 * mailbox provisioning. Email Requests work for every provider.
 */
export function usesSelfHostedMail(
  user: Pick<User, 'email_provider'> | null | undefined,
  defaultEmailProvider: EmailProvider
): boolean {
  return effectiveEmailProvider(user, defaultEmailProvider) === 'self_hosted';
}

/** Display name of an external mail provider, or null for self-hosted. */
export function externalProviderName(provider: EmailProvider | null | undefined): string | null {
  switch (provider) {
    case 'google_workspace': return 'Google Workspace';
    case 'microsoft_365': return 'Microsoft 365';
    default: return null;
  }
}
