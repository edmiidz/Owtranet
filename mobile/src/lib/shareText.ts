/**
 * Tidies text handed over by other apps' share sheets before it goes into a
 * post or message. The X app, for example, wraps the tweet in straight quotes
 * (sometimes with a newline before the closing one) and puts every @handle on
 * its own line, which reads badly as markdown.
 */

const OPEN_QUOTES = ['"', '“', '„', '«'];
const CLOSE_QUOTES = ['"', '”', '“', '»'];

/** Strip one pair of wrapping quotes and rejoin @handles split onto their own lines. */
export function cleanSharedText(raw: string): { text: string; wasQuoted: boolean } {
  let text = (raw || '').replace(/\r\n/g, '\n').trim();
  let wasQuoted = false;
  if (text.length > 1 && OPEN_QUOTES.includes(text[0]) && CLOSE_QUOTES.includes(text[text.length - 1])) {
    text = text.slice(1, -1).trim();
    wasQuoted = true;
  }
  // X puts each @handle on its own line: "led by \n@a16z\n to" / "announcing \n@lightfld\n's".
  text = text.replace(/[ \t]+\n(@\w+)/g, ' $1');
  text = text.replace(/(@\w+)\n(?=['\u2019,.:;)!?])/g, '$1');
  text = text.replace(/(@\w+)\n[ \t]*(?=\S)/g, '$1 ');
  text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return { text, wasQuoted };
}

/** Markdown blockquote of `text`, preserving paragraph breaks. */
export function asBlockquote(text: string): string {
  return text.split('\n').map(line => (line.trim() ? `> ${line}` : '>')).join('\n');
}

/**
 * Body for a shared forum post. Quoted share-sheet text becomes a blockquote;
 * the user's own note stays plain.
 */
export function formatSharedNote(raw: string): string {
  const { text, wasQuoted } = cleanSharedText(raw);
  if (!text) return '';
  return wasQuoted ? asBlockquote(text) : text;
}
