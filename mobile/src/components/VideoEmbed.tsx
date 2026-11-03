import React from 'react';
import { useWindowDimensions, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useAuthStore } from '@/stores/auth';
import { openExternal } from '@/lib/files';

/**
 * Video URL → embeddable player, mirroring `videoEmbedHtml()` / the Google
 * Drive image rule in server.js so a post looks the same in the app as on the
 * web (which renders the server's iframe HTML). The app renders the markdown
 * itself, so without this a `![Google Drive](https://drive.google.com/file/d/…/view)`
 * became an <Image> pointed at an HTML page: a blank 220px box (TestFlight
 * feedback "Fails to show embedded video").
 */
export interface VideoEmbedInfo { src: string; portrait: boolean; kind: 'youtube' | 'drive' | 'facebook' }

export function videoEmbedFor(url: string | undefined | null): VideoEmbedInfo | null {
  if (!url) return null;
  const drive = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (drive) return { src: `https://drive.google.com/file/d/${drive[1]}/preview`, portrait: false, kind: 'drive' };
  const yt = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/);
  if (yt) return { src: `https://www.youtube.com/embed/${yt[1]}?playsinline=1`, portrait: /youtube\.com\/shorts\//.test(url), kind: 'youtube' };
  const fb = url.match(/^https?:\/\/(?:www\.|m\.|web\.)?facebook\.com\/(?:reel\/\d+|share\/r\/[A-Za-z0-9_-]+|watch\/?\?(?:.*&)?v=\d+|[^/?#]+\/videos\/(?:[^/?#]+\/)?\d+|video\.php\?v=\d+)/)
    || url.match(/^https?:\/\/fb\.watch\/[A-Za-z0-9_-]+\/?$/);
  if (fb) {
    const canonical = url.replace(/^https?:\/\/(?:m\.|web\.)?facebook\.com/, 'https://www.facebook.com').split('#')[0];
    const portrait = /\/reel\/|\/share\/r\//.test(canonical);
    return { src: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(canonical)}&show_text=false&width=${portrait ? 360 : 560}`, portrait, kind: 'facebook' };
  }
  return null;
}

const BARE_URL = /https?:\/\/[^\s<>()]+/g;

/**
 * Same rule as the server's paragraph renderer: a paragraph that contains a
 * *bare* video link (not `[text](url)`, not already `![](url)`) gets the player
 * appended after it, so "Check out: <youtube link>" posts show the video here
 * too. `[text](url)` stays a plain link — that is the opt-out on web as well.
 */
export function appendVideoEmbeds(markdown: string): string {
  if (!markdown || !/youtube\.com|youtu\.be|facebook\.com|fb\.watch|drive\.google\.com/.test(markdown)) return markdown;
  return markdown.split(/\n{2,}/).map((para) => {
    if (/^\s*```/.test(para)) return para;
    const embeds: string[] = [];
    const seen = new Set<string>();
    for (const m of para.matchAll(BARE_URL)) {
      const url = m[0].replace(/[.,;:!?'")\]]+$/, '');
      const before = para.slice(0, m.index);
      // Inside ](…) or ![…](…) → an explicit link/embed, leave it alone.
      if (/\]\($/.test(before) || /<$/.test(before)) continue;
      // Link text that is the URL itself ([https://…](https://…)) counts as bare.
      if (!videoEmbedFor(url) || seen.has(url)) continue;
      if (para.includes(`](${url})`) && !para.includes(`[${url}](${url})`)) continue;
      seen.add(url);
      embeds.push(`![](${url})`);
    }
    return embeds.length ? `${para}\n\n${embeds.join('\n\n')}` : para;
  }).join('\n\n');
}

/**
 * Responsive player: full width at 16:9, or a 9:16 portrait box capped at 360pt
 * (matches `.embed-video` on web).
 *
 * The player is wrapped in a one-line HTML page whose baseUrl is the workspace
 * rather than loaded as the WebView's top document: YouTube refuses an embed
 * that arrives without an HTTP Referer ("Video player configuration error",
 * seen in the simulator) and Google Drive's preview came up black the same way.
 * Framed from an https origin, both behave as they do on the web client.
 */
export function VideoEmbed({ embed }: { embed: VideoEmbedInfo }) {
  const { width: screenWidth } = useWindowDimensions();
  const workspaceUrl = useAuthStore(s => s.workspaceUrl);
  const maxWidth = embed.portrait ? Math.min(360, screenWidth - 64) : Math.min(640, screenWidth - 64);
  const height = embed.portrait ? maxWidth * 16 / 9 : maxWidth * 9 / 16;
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{position:absolute;inset:0;width:100%;height:100%;border:0}</style></head><body><iframe src="${embed.src}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></body></html>`;
  return (
    <View style={{ width: '100%', alignItems: 'flex-start', marginVertical: 8 }}>
      <View style={{ width: maxWidth, height, borderRadius: 10, overflow: 'hidden', backgroundColor: '#000' }}>
        <WebView
          source={{ html, baseUrl: workspaceUrl }}
          originWhitelist={['*']}
          style={{ flex: 1, backgroundColor: '#000' }}
          allowsFullscreenVideo
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction
          javaScriptEnabled
          domStorageEnabled
          setSupportMultipleWindows={false}
          // Only the wrapper page may occupy the WebView. A "Watch on YouTube" /
          // "Open in Drive" tap tries to navigate the top frame away; hand it to
          // the system browser instead, as an external link tapped in a post would be.
          onShouldStartLoadWithRequest={(req: any) => {
            if (req.isTopFrame === false || req.url === 'about:blank' || req.url.startsWith(workspaceUrl)) return true;
            openExternal(req.url);
            return false;
          }}
        />
      </View>
    </View>
  );
}
