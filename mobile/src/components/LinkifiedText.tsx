import React from 'react';
import { Text } from 'react-native';
import { useTheme } from '@/theme';
import { openExternal } from '@/lib/files';

// Plain-text fields (a member's "About") aren't markdown, so the linkify-enabled
// <Markdown> component would reinterpret *, #, _ etc. This keeps the text as-is
// and only turns bare URLs into tappable links — same rules as the web client's
// components/LinkifiedText.tsx.
const URL_RE = /(\bhttps?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+)/gi;
// Punctuation that usually ends the sentence rather than the URL.
const TRAILING_RE = /[.,;:!?)\]}'"]+$/;

export function linkifyParts(text: string): Array<{ text: string; href?: string }> {
  const parts: Array<{ text: string; href?: string }> = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0];
    const start = m.index ?? 0;
    const trail = url.match(TRAILING_RE)?.[0] ?? '';
    // Keep a closing paren that balances one inside the URL (e.g. Wikipedia links).
    let cut = trail.length;
    if (trail.startsWith(')') && (url.split('(').length - 1) >= (url.split(')').length - 1)) cut = trail.length - 1;
    if (cut > 0) url = url.slice(0, url.length - cut);
    if (start > last) parts.push({ text: text.slice(last, start) });
    parts.push({ text: url, href: /^https?:\/\//i.test(url) ? url : `https://${url}` });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** Nest inside a <Text>/<P> so the surrounding font and colour carry over. */
export function LinkifiedText({ text }: { text: string }) {
  const t = useTheme();
  return (
    <>
      {linkifyParts(text).map((p, i) =>
        p.href ? (
          <Text key={i} style={{ color: t.primary, textDecorationLine: 'underline' }} onPress={() => openExternal(p.href!)}>
            {p.text}
          </Text>
        ) : (
          <React.Fragment key={i}>{p.text}</React.Fragment>
        )
      )}
    </>
  );
}
