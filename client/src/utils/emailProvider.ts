import type { EmailProvider, User } from '../types';

/** The provider a member effectively uses: their own choice, else the instance default. */
export function effectiveEmailProvider(
  user: Pick<User, 'email_provider'> | null | undefined,
  defaultEmailProvider: EmailProvider
): EmailProvider {
  return user?.email_provider || defaultEmailProvider;
}

/** Only the self-hosted provider (Postfix/Dovecot + Nextcloud) has Webmail and the Email Request flow. */
export function usesSelfHostedMail(
  user: Pick<User, 'email_provider'> | null | undefined,
  defaultEmailProvider: EmailProvider
): boolean {
  return effectiveEmailProvider(user, defaultEmailProvider) === 'self_hosted';
}
