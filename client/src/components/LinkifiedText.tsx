import React from 'react';

// Plain-text fields (profile "About", plain-text email bodies, ledger notes) are
// rendered as-is rather than through markdown, so a pasted https://… stayed
// unclickable while the same URL in a post, DM or group message became a link
// (those go through `marked`, which autolinks). This splits the text on URLs and
// wraps each one in an <a>, keeping everything else as plain React text — no
// HTML injection, so it's safe for user-supplied content.
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

export default function LinkifiedText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className}>
      {linkifyParts(text).map((p, i) =>
        p.href ? (
          <a
            key={i}
            href={p.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800 underline break-all"
          >
            {p.text}
          </a>
        ) : (
          <React.Fragment key={i}>{p.text}</React.Fragment>
        )
      )}
    </span>
  );
}
