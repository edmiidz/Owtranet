import { create } from 'zustand';
import type { EmailProvider, EmailProviderOption } from '../types';

const DEFAULT_EMAIL_PROVIDERS: EmailProviderOption[] = [
  { value: 'self_hosted', label: 'Self-hosted mail + calendar', webmail: true },
  { value: 'microsoft_365', label: 'Microsoft 365 (Outlook + Exchange calendar)', webmail: false },
  { value: 'google_workspace', label: 'Google Workspace (Gmail + Google Calendar)', webmail: false },
];

interface BrandingState {
  companyName: string;
  companyShortName: string;
  companyEmailDomain: string;
  baseUrl: string;
  baseCurrency: string;
  emailProviders: EmailProviderOption[];
  defaultEmailProvider: EmailProvider;
  loaded: boolean;
  fetchBranding: () => Promise<void>;
}

export const useBrandingStore = create<BrandingState>((set, get) => ({
  companyName: 'Intranet',
  companyShortName: 'Intranet',
  companyEmailDomain: '',
  baseUrl: '',
  baseCurrency: 'USD',
  emailProviders: DEFAULT_EMAIL_PROVIDERS,
  defaultEmailProvider: 'self_hosted',
  loaded: false,

  fetchBranding: async () => {
    if (get().loaded) return;
    try {
      const res = await fetch('/api/config/branding');
      if (res.ok) {
        const data = await res.json();
        set({
          companyName: data.companyName || 'Intranet',
          companyShortName: data.companyShortName || data.companyName || 'Intranet',
          companyEmailDomain: data.companyEmailDomain || '',
          baseUrl: data.baseUrl || '',
          baseCurrency: (data.baseCurrency || 'USD').toUpperCase(),
          emailProviders: Array.isArray(data.emailProviders) && data.emailProviders.length > 0 ? data.emailProviders : DEFAULT_EMAIL_PROVIDERS,
          defaultEmailProvider: data.defaultEmailProvider || 'self_hosted',
          loaded: true,
        });
      }
    } catch {
      // Silently fail, keep defaults
    }
  },
}));
