import { useColorScheme } from 'react-native';

export const palette = {
  light: {
    bg: '#f5f6f8', card: '#ffffff', text: '#0f172a', muted: '#64748b', border: '#e2e8f0',
    primary: '#2563eb', primaryText: '#ffffff', danger: '#dc2626', success: '#16a34a', warning: '#d97706',
    chip: '#eef2ff', chipText: '#3730a3', tabBar: '#ffffff', input: '#ffffff'
  },
  dark: {
    bg: '#0b1220', card: '#111a2e', text: '#e5e7eb', muted: '#94a3b8', border: '#1f2a44',
    primary: '#3b82f6', primaryText: '#ffffff', danger: '#f87171', success: '#4ade80', warning: '#fbbf24',
    chip: '#1e293b', chipText: '#c7d2fe', tabBar: '#0f172a', input: '#0f172a'
  }
};
export type Theme = typeof palette.light;

export function useTheme(): Theme {
  const scheme = useColorScheme();
  return scheme === 'dark' ? palette.dark : palette.light;
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const radius = { sm: 8, md: 12, lg: 16 };
