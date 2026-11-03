import { router } from 'expo-router';
import { useAuthStore } from '@/stores/auth';
import { openExternal } from '@/lib/files';

/**
 * Web-client path → expo-router href, or null when the app has no screen for it
 * (admin pages, /docs/:id, /uploads, /api …) and the browser should handle it.
 * Keep in step with client/src/App.tsx and the AASA paths in server.js.
 */
export function hrefForWebPath(pathname: string): string | null {
  const parts = pathname.split(/[?#]/)[0].split('/').filter(Boolean).map(p => { try { return decodeURIComponent(p); } catch { return p; } });
  const [a, b, c] = parts;
  const seg = (s: string) => encodeURIComponent(s);
  switch (a) {
    case undefined:
    case 'dashboard': return parts.length <= 1 ? '/' : null;
    case 'forum':
      if (!b) return '/forum';
      if (b === 'create') return '/forum/create';
      if ((b === 'post' || b === 'edit') && c) return `/forum/${seg(c)}`;
      return null;
    case 'tasks':
      if (!b) return '/tasks';
      if (b === 'create') return '/tasks/new';
      if (b === 'edit' && c) return `/tasks/${seg(c)}`;
      return /^\d+$/.test(b) ? `/tasks/${b}` : null;
    case 'investment-tracker':
      if (!b) return '/investments';
      return /^\d+$/.test(b) ? `/investments/${b}` : null;
    case 'ledger':
      if (!b) return '/ledger';
      return /^\d+$/.test(b) ? `/ledger/${b}` : null;
    case 'profile': return b ? `/members/${seg(b)}` : null;
    case 'search': return '/search';
    case 'messages': return '/messages';
    case 'group-chat': return b ? `/groups/${seg(b)}` : '/groups';
    default: return null;
  }
}

/** Host of a URL without a leading www., or '' if it doesn't parse as http(s). */
function hostOf(url: string): string {
  const m = /^https?:\/\/([^/?#]+)/i.exec(url);
  return m ? m[1].toLowerCase().replace(/^www\./, '') : '';
}

/**
 * Open a link tapped inside the app. Links into this workspace (absolute, or
 * workspace-relative like /forum/post/x) go to the matching native screen;
 * everything else leaves the app as before.
 */
export function openLink(url: string) {
  const workspaceUrl = useAuthStore.getState().workspaceUrl.replace(/\/$/, '');
  const relative = url.startsWith('/') && !url.startsWith('//');
  if (relative || (hostOf(url) && hostOf(url) === hostOf(workspaceUrl))) {
    const path = relative ? url : url.replace(/^https?:\/\/[^/?#]+/i, '') || '/';
    const href = hrefForWebPath(path);
    if (href) { router.push(href as any); return; }
    if (relative) { openExternal(`${workspaceUrl}${url}`); return; }
  }
  openExternal(url);
}
