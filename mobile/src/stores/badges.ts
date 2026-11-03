import { create } from 'zustand';
import { mobileApi } from '@/api';
import type { Counts } from '@/api/types';

interface BadgeState extends Counts {
  refresh: () => Promise<void>;
  set: (c: Partial<Counts>) => void;
}

export const useBadges = create<BadgeState>((set) => ({
  unread_notifications: 0, unread_messages: 0, pending_agreements: 0, open_tasks: 0, radio_unheard: 0,
  refresh: async () => {
    try { set(await mobileApi.counts()); } catch { /* offline — keep last known */ }
  },
  set: (c) => set(c),
}));
