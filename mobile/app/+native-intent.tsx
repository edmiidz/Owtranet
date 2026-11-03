import { getShareExtensionKey } from 'expo-share-intent';
import { hrefForWebPath } from '@/lib/deepLinks';

/**
 * expo-router hook for native deep links. The iOS share extension opens the
 * app with `intranet://dataUrl=<key>?nonce=…`, which is not a route; send it to
 * the Quick share screen instead, where the useShareIntent hook (root layout)
 * reads the shared payload from the app group and fills in the form.
 *
 * Universal / app links arrive as the full web URL
 * (https://intranet.example.com/group-chat/General). Web paths don't match the
 * app's routes, so translate them; anything unmapped opens the home screen.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (path.includes(`dataUrl=${getShareExtensionKey()}`) || path.includes('dataUrl=')) return '/share';
    const web = /^https?:\/\/[^/?#]+([^#]*)/i.exec(path);
    if (web) return hrefForWebPath(web[1] || '/') ?? '/';
    return path;
  } catch {
    return '/';
  }
}
