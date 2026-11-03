import React from 'react';
import { Image } from 'react-native';
import MarkdownDisplay, { MarkdownIt } from 'react-native-markdown-display';
import { useTheme } from '@/theme';
import { openLink } from '@/lib/deepLinks';
import { absoluteUrl } from '@/api/client';
import { appendVideoEmbeds, VideoEmbed, videoEmbedFor } from '@/components/VideoEmbed';

// The library's default parser is MarkdownIt({ typographer: true }) — markdown-it
// ships with linkify OFF, so a bare https://… pasted into a message rendered as
// dead plain text while [text](url) worked. The web client goes through marked(),
// which autolinks by default (and runs with `breaks: true`, so a single newline
// is a line break), hence the mismatch. Built once at module scope because the
// `markdownit` prop is memoized on identity.
const markdownItInstance = MarkdownIt({ typographer: true, linkify: true, breaks: true });

// Images come out of the server as workspace-relative paths (![Image](/uploads/
// images/x.jpg)). The web client resolves those against its own origin; a native
// app has no origin, so they must go through absoluteUrl() against the
// workspaceUrl. Without this the library's defaultImageHandler prefixes them
// into 'https:///uploads/...' and nothing loads.
//
// A ![…](url) whose url is a YouTube / Google Drive / Facebook video is a
// player, not a picture — the server's markdownToHtml does the same for the
// web client (renderer.image → iframe). See VideoEmbed.tsx.
const renderRules = {
  image: (node: any) => {
    const embed = videoEmbedFor(node.attributes?.src);
    if (embed) return <VideoEmbed key={node.key} embed={embed} />;
    const uri = absoluteUrl(node.attributes?.src);
    if (!uri) return null;
    return (
      <Image
        key={node.key}
        source={{ uri }}
        accessible={!!node.attributes?.alt}
        accessibilityLabel={node.attributes?.alt || undefined}
        style={{ width: '100%', height: 220, borderRadius: 10, marginVertical: 6 }}
        resizeMode="contain"
      />
    );
  },
};

/**
 * `color` overrides the body/heading text colour — chat bubbles for your own
 * messages are a solid primary fill, so their text has to be white rather than
 * the theme's default foreground.
 */
export function Markdown({ children, color, fontSize }: { children: string; color?: string; fontSize?: number }) {
  const t = useTheme();
  const fg = color || t.text;
  const size = fontSize ?? 15.5;
  const styles = {
    body: { color: fg, fontSize: size, lineHeight: size + 5.5 },
    heading1: { color: fg, fontSize: 22, fontWeight: '700', marginTop: 10, marginBottom: 6 },
    heading2: { color: fg, fontSize: 19, fontWeight: '700', marginTop: 10, marginBottom: 6 },
    heading3: { color: fg, fontSize: 17, fontWeight: '700', marginTop: 8, marginBottom: 4 },
    link: { color: color ? '#dbeafe' : t.primary, textDecorationLine: 'underline' },
    code_inline: { backgroundColor: t.chip, color: t.chipText, borderRadius: 4, paddingHorizontal: 4 },
    code_block: { backgroundColor: t.chip, color: t.text, borderRadius: 8, padding: 10 },
    fence: { backgroundColor: t.chip, color: t.text, borderRadius: 8, padding: 10, borderColor: t.border },
    blockquote: { backgroundColor: t.chip, borderLeftColor: t.primary, borderLeftWidth: 3, padding: 8 },
    bullet_list: { marginBottom: 6 }, ordered_list: { marginBottom: 6 },
    table: { borderColor: t.border }, th: { padding: 6 }, td: { padding: 6 }, tr: { borderColor: t.border },
    hr: { backgroundColor: t.border },
  } as any;
  // Bare video links get their player appended, as the server's paragraph renderer does on web.
  const source = React.useMemo(() => appendVideoEmbeds(children), [children]);
  return <MarkdownDisplay markdownit={markdownItInstance} style={styles} rules={renderRules} onLinkPress={(url: string) => { openLink(url); return false; }}>{source}</MarkdownDisplay>;
}
