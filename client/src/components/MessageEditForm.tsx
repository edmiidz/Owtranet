import React, { useEffect, useRef, useState } from 'react';

interface MessageEditFormProps {
  initialContent: string;
  maxLength?: number;
  onSave: (content: string) => Promise<void>;
  onCancel: () => void;
}

// Inline editor shown in place of a chat bubble's body while its sender edits
// it. Enter saves, Shift+Enter adds a line, Escape cancels — same keys as the
// composer.
const MessageEditForm: React.FC<MessageEditFormProps> = ({ initialContent, maxLength = 2000, onSave, onCancel }) => {
  const [value, setValue] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);

  const trimmed = value.trim();
  const canSave = !!trimmed && trimmed.length <= maxLength && !saving;

  const save = async () => {
    if (!canSave) return;
    if (trimmed === initialContent.trim()) {
      onCancel();
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(trimmed);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to save edit');
      setSaving(false);
    }
  };

  return (
    <div className="w-full">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            save();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        rows={Math.min(Math.max(value.split('\n').length, 2), 8)}
        disabled={saving}
        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
      />
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      <div className="flex items-center justify-end space-x-2 mt-1">
        <span className="text-xs text-gray-400 mr-auto">Enter to save · Esc to cancel</span>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="text-xs px-2 py-1 rounded text-gray-600 bg-white border border-gray-300 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="text-xs px-2 py-1 rounded text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
};

export default MessageEditForm;

// Tooltip for the "(edited)" marker: when the latest edit happened, in the
// long datetime format used across the app.
export const editedTitle = (editedAt?: string | null): string =>
  editedAt
    ? `Edited ${new Date(editedAt).toLocaleString('en-CA', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false, timeZoneName: 'short'
      }).replace(',', '')}`
    : 'Edited';
