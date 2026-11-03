/**
 * Blockquote helpers for the markdown editors (post create/edit, comment
 * create/edit). Kept as pure functions so the three editors — which each have
 * their own insertMarkdown signature — can share identical behaviour.
 */

/** Width at which quoted lines are hard-wrapped, in characters. */
export const QUOTE_WRAP_WIDTH = 80;

/**
 * Hard-wrap a single line at word boundaries near `width`.
 * A word longer than `width` (e.g. a URL) is left intact on its own line
 * rather than being broken mid-token, since breaking a URL would corrupt it.
 */
export function wrapLine(line: string, width: number = QUOTE_WRAP_WIDTH): string[] {
  const trimmed = line.trim();
  if (trimmed === '') return [''];

  const words = trimmed.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (current === '') {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== '') lines.push(current);

  return lines;
}

/**
 * True when the selection covers whole lines rather than a fragment inside a
 * line. This is what disambiguates ⌘/ : selecting whole lines quotes them,
 * selecting a phrase within a line strikes it through.
 *
 * A caret with no selection is not a line selection — there is nothing to quote.
 */
export function isLineSelection(value: string, start: number, end: number): boolean {
  if (start === end) return false;

  // A multi-line selection counts even if it starts or ends mid-line: the user
  // has clearly grabbed a block of text, not a phrase to strike through.
  if (value.substring(start, end).includes('\n')) return true;

  // Single-line case. Dragging to select a line very often stops a character or
  // two short of the end (or starts just past the leading indent), so compare
  // against the line's trimmed extent rather than demanding an exact match.
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = value.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = value.length;

  const line = value.substring(lineStart, lineEnd);
  const contentStart = lineStart + (line.length - line.trimStart().length);
  const contentEnd = lineEnd - (line.length - line.trimEnd().length);

  // Treat it as a line selection when it covers essentially all of the line's
  // text, allowing a small slop at each edge for imprecise dragging.
  const SLOP = 2;
  return start <= contentStart + SLOP && end >= contentEnd - SLOP;
}

/** True when every non-blank line in the range is already a blockquote. */
export function isAlreadyQuoted(text: string): boolean {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  return lines.length > 0 && lines.every((l) => /^\s*>\s?/.test(l));
}

/** Strip one level of '> ' from each line. */
export function unquoteText(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(/^(\s*)>\s?/, '$1'))
    .join('\n');
}

/**
 * Prefix each line with '> ', hard-wrapping long lines at `width`.
 * Blank lines become a bare '>' so the blockquote isn't split into two
 * separate quotes by the markdown renderer.
 */
export function quoteText(text: string, width: number = QUOTE_WRAP_WIDTH): string {
  return text
    .split('\n')
    .flatMap((line) => wrapLine(line, width))
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');
}

export interface QuoteResult {
  /** The full new textarea value. */
  value: string;
  /** Where to place the caret afterwards (end of the quoted block). */
  cursorPos: number;
}

/**
 * Toggle a blockquote over the selected range, expanded to whole lines so a
 * partial selection still quotes the lines it touches. Re-running on an
 * already-quoted block removes the quote.
 */
export function toggleQuote(
  value: string,
  start: number,
  end: number,
  width: number = QUOTE_WRAP_WIDTH
): QuoteResult {
  // Expand the range outward to cover the full first and last lines.
  let lineStart = value.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = value.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = value.length;

  const block = value.substring(lineStart, lineEnd);
  const replacement = isAlreadyQuoted(block)
    ? unquoteText(block)
    : quoteText(block, width);

  const newValue =
    value.substring(0, lineStart) + replacement + value.substring(lineEnd);

  return { value: newValue, cursorPos: lineStart + replacement.length };
}
