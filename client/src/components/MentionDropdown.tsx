import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bot } from 'lucide-react';
import { usersApi } from '../utils/api';
import type { MentionCandidate } from '../types';

/**
 * @mention dropdown. Attach it to any existing <textarea> by ref:
 * typing "@" opens a live search over people and AI agents, ↑/↓ move, Enter or
 * Tab (or a click) inserts the exact handle, Esc closes. It listens on the
 * document in the capture phase so it sees keys before the page's own
 * onKeyDown (markdown shortcuts) and swallows only the keys it uses while open.
 */
interface MentionDropdownProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Receives the full new textarea value after a mention is inserted. */
  onChange: (value: string) => void;
  /** Tasks and other places where agents do not answer can hide them. */
  includeAgents?: boolean;
}

// The "@query" immediately before the caret, if the caret is inside a mention.
// Not after a word character, "." or "@", so e-mail addresses don't trigger it.
const MENTION_AT_CARET = /(^|[^\w.@])@(\w{0,30})$/;

// Pixel position of a character offset inside a textarea (mirror-div technique).
const MIRRORED_STYLES = [
  'boxSizing', 'width', 'height', 'overflowX', 'overflowY', 'borderTopWidth', 'borderRightWidth',
  'borderBottomWidth', 'borderLeftWidth', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'lineHeight', 'fontFamily',
  'textAlign', 'textTransform', 'textIndent', 'letterSpacing', 'wordSpacing', 'tabSize'
] as const;

function caretCoordinates(el: HTMLTextAreaElement, position: number) {
  const div = document.createElement('div');
  const style = div.style;
  const computed = window.getComputedStyle(el);
  style.position = 'absolute';
  style.visibility = 'hidden';
  style.whiteSpace = 'pre-wrap';
  style.overflowWrap = 'break-word';
  for (const prop of MIRRORED_STYLES) (style as any)[prop] = (computed as any)[prop];
  style.overflow = 'hidden';
  div.textContent = el.value.substring(0, position);
  const span = document.createElement('span');
  span.textContent = el.value.substring(position) || '.';
  div.appendChild(span);
  document.body.appendChild(div);
  const coords = {
    top: span.offsetTop + parseInt(computed.borderTopWidth, 10),
    left: span.offsetLeft + parseInt(computed.borderLeftWidth, 10),
    lineHeight: parseInt(computed.lineHeight, 10) || parseInt(computed.fontSize, 10) * 1.4
  };
  document.body.removeChild(div);
  return coords;
}

const DROPDOWN_WIDTH = 300;
const DROPDOWN_MAX_HEIGHT = 288;

const MentionDropdown: React.FC<MentionDropdownProps> = ({ textareaRef, onChange, includeAgents = true }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<MentionCandidate[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  // The document listeners read live values through refs, not stale closures.
  const state = useRef({ open: false, items: [] as MentionCandidate[], active: 0, start: -1, caret: -1 });
  state.current.open = open;
  state.current.items = items;
  state.current.active = active;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const requestSeq = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    state.current.start = -1;
  }, []);

  const place = useCallback((el: HTMLTextAreaElement, start: number) => {
    const rect = el.getBoundingClientRect();
    const caret = caretCoordinates(el, start);
    let top = rect.top + caret.top - el.scrollTop + caret.lineHeight + 4;
    let left = rect.left + caret.left - el.scrollLeft;
    left = Math.max(8, Math.min(left, window.innerWidth - DROPDOWN_WIDTH - 8));
    // Flip above the line when there's no room below.
    if (top + DROPDOWN_MAX_HEIGHT > window.innerHeight && top - caret.lineHeight - DROPDOWN_MAX_HEIGHT - 8 > 0) {
      top = top - caret.lineHeight - DROPDOWN_MAX_HEIGHT - 8;
    }
    setPosition({ top, left });
  }, []);

  // Re-evaluate whether the caret sits in an "@query".
  const detect = useCallback(() => {
    const el = textareaRef.current;
    if (!el || document.activeElement !== el) return;
    const caret = el.selectionStart ?? 0;
    if (caret !== el.selectionEnd) return close();
    const match = MENTION_AT_CARET.exec(el.value.slice(0, caret));
    if (!match) return close();
    const q = match[2];
    state.current.start = caret - q.length - 1;
    state.current.caret = caret;
    setQuery(q);
    setOpen(true);
    place(el, state.current.start);
  }, [textareaRef, close, place]);

  const insert = useCallback((candidate: MentionCandidate) => {
    const el = textareaRef.current;
    const { start, caret } = state.current;
    if (!el || start < 0) return;
    const before = el.value.slice(0, start);
    const after = el.value.slice(caret).replace(/^\w*/, ''); // drop the rest of a half-typed word
    const insertion = `@${candidate.mention_handle} `;
    const next = before + insertion + after.replace(/^ /, '');
    onChangeRef.current(next);
    close();
    const cursor = before.length + insertion.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  }, [textareaRef, close]);

  // Search as the query changes (debounced; stale responses are ignored).
  useEffect(() => {
    if (!open) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        let results = await usersApi.searchUsers(query);
        if (!includeAgents) results = results.filter(r => r.account_type !== 'ai_agent');
        if (seq !== requestSeq.current) return;
        setItems(results);
        setActive(0);
      } catch {
        if (seq === requestSeq.current) setItems([]);
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    }, query ? 150 : 0);
    return () => clearTimeout(timer);
  }, [open, query, includeAgents]);

  // Keep the highlighted row in view.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  useEffect(() => {
    const isOurs = (e: Event) => e.target === textareaRef.current && !!textareaRef.current;

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isOurs(e) || !state.current.open) return;
      const { items: list, active: idx } = state.current;
      const swallow = () => { e.preventDefault(); e.stopPropagation(); };
      if (e.key === 'Escape') {
        swallow();
        close();
      } else if (list.length > 0 && e.key === 'ArrowDown') {
        swallow();
        setActive((idx + 1) % list.length);
      } else if (list.length > 0 && e.key === 'ArrowUp') {
        swallow();
        setActive((idx - 1 + list.length) % list.length);
      } else if (list.length > 0 && (e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        swallow();
        insert(list[idx] || list[0]);
      }
    };
    const onInput = (e: Event) => { if (isOurs(e)) detect(); };
    const onKeyUp = (e: KeyboardEvent) => {
      if (isOurs(e) && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) detect();
    };
    const onClick = (e: MouseEvent) => { if (isOurs(e)) detect(); };
    const onFocusOut = (e: FocusEvent) => { if (isOurs(e)) close(); };
    const onScroll = () => {
      const el = textareaRef.current;
      if (state.current.open && el && state.current.start >= 0) place(el, state.current.start);
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('keyup', onKeyUp, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('focusout', onFocusOut, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('keyup', onKeyUp, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('focusout', onFocusOut, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [textareaRef, detect, insert, close, place]);

  if (!open || !position) return null;

  return createPortal(
    <div
      className="fixed z-[1000] bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden"
      style={{ top: position.top, left: position.left, width: DROPDOWN_WIDTH }}
      // Keep focus in the textarea while clicking a row.
      onMouseDown={(e) => e.preventDefault()}
      role="listbox"
      aria-label="Mention a person or AI agent"
    >
      <div className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400 border-b border-gray-100">
        {includeAgents ? 'People & AI agents' : 'People'}
        {query && <span className="normal-case tracking-normal text-gray-500"> · “{query}”</span>}
      </div>
      <div ref={listRef} className="overflow-y-auto" style={{ maxHeight: DROPDOWN_MAX_HEIGHT - 60 }}>
        {items.length === 0 ? (
          <div className="px-3 py-3 text-sm text-gray-500">
            {loading ? 'Searching…' : `No one matches “@${query}”`}
          </div>
        ) : (
          items.map((item, index) => {
            const isAgent = item.account_type === 'ai_agent';
            return (
              <div
                key={item.id}
                data-index={index}
                role="option"
                aria-selected={index === active}
                className={`px-3 py-2 cursor-pointer flex items-center gap-3 ${
                  index === active ? 'bg-primary-50' : 'hover:bg-gray-50'
                }`}
                onMouseEnter={() => setActive(index)}
                onClick={() => insert(item)}
              >
                {item.avatar_url ? (
                  <img src={item.avatar_url} alt="" className="h-8 w-8 rounded-full flex-shrink-0 object-cover" />
                ) : (
                  <div className="h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-medium text-gray-600">{item.name.charAt(0)}</span>
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-gray-900 truncate">{item.name}</span>
                    {isAgent && (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                        <Bot className="h-3 w-3" /> AI
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 truncate">
                    @{item.mention_handle}
                    {isAgent && item.agent_tagline ? ` · ${item.agent_tagline}` : ''}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="px-3 py-1 text-[11px] text-gray-400 border-t border-gray-100">
        ↑↓ to move · Enter to insert · Esc to close
      </div>
    </div>,
    document.body
  );
};

export default MentionDropdown;
