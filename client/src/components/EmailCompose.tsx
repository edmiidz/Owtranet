import React, { useState, useEffect, useRef } from 'react';
import { X, Send, Paperclip, Type, Trash, Save, Clock } from 'lucide-react';
import { useBrandingStore } from '../stores/brandingStore';

interface Email {
  uid: number;
  flags: string[];
  date: string;
  subject: string;
  from: string;
  to: string;
  text: string;
  html: string;
  attachments?: any[];
}

interface ReplyContext {
  type: 'reply' | 'replyAll' | 'forward';
  email: Email;
}

interface EmailComposeProps {
  isOpen: boolean;
  onClose: () => void;
  onSend: (emailData: EmailData) => Promise<void>;
  replyContext?: ReplyContext | null;
  draftToEdit?: Email | null;
  /** Prefill (e.g. editing a cancelled scheduled send). Attachments cannot be restored. */
  initialValues?: Partial<EmailData> | null;
}

interface EmailData {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: File[];
  /** ISO-8601 instant. When set, the server queues the message instead of sending it. */
  scheduledAt?: string;
}

/** Date → value for an <input type="datetime-local"> in the browser's local time. */
const toLocalInputValue = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Gmail-style quick picks, computed in local time. */
const schedulePresets = (): { label: string; date: Date }[] => {
  const at = (daysAhead: number, hour: number) => {
    const d = new Date();
    d.setDate(d.getDate() + daysAhead);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const now = new Date();
  const daysToMonday = ((8 - now.getDay()) % 7) || 7; // next Monday, never today
  const presets = [
    { label: 'Tomorrow morning', date: at(1, 8) },
    { label: 'Tomorrow afternoon', date: at(1, 13) },
    { label: 'Monday morning', date: at(daysToMonday, 8) }
  ];
  // Later today (in 3 hours, on the hour) if that still lands before 9 PM
  const laterToday = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  laterToday.setMinutes(0, 0, 0);
  if (laterToday.getHours() <= 21 && laterToday.getDate() === now.getDate()) {
    presets.unshift({ label: 'Later today', date: laterToday });
  }
  return presets;
};

const formatScheduleLabel = (d: Date) =>
  d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const EmailCompose: React.FC<EmailComposeProps> = ({ isOpen, onClose, onSend, replyContext, draftToEdit, initialValues }) => {
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleValue, setScheduleValue] = useState('');
  const [isScheduling, setIsScheduling] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track changes for unsaved warning
  useEffect(() => {
    if (to || cc || bcc || subject || text) {
      setHasUnsavedChanges(true);
    }
  }, [to, cc, bcc, subject, text]);

  // Auto-save every 30 seconds
  useEffect(() => {
    if (!isOpen || !hasUnsavedChanges) return;

    // Clear existing timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    // Set new timer
    autoSaveTimerRef.current = setTimeout(() => {
      if (to || subject || text) {
        handleSaveDraft();
      }
    }, 30000); // 30 seconds

    // Cleanup
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [isOpen, hasUnsavedChanges, to, subject, text]);

  // Populate reply context or draft when modal opens
  useEffect(() => {
    setShowSchedule(false);
    setScheduleValue('');

    // Prefill (editing a cancelled scheduled send)
    if (initialValues) {
      setTo(initialValues.to || '');
      setCc(initialValues.cc || '');
      setBcc(initialValues.bcc || '');
      setSubject(initialValues.subject || '');
      setText(initialValues.text || '');
      setAttachments([]);
      setShowCc(!!initialValues.cc);
      setShowBcc(!!initialValues.bcc);
      setLastSaved(null);
      setHasUnsavedChanges(true);
      return;
    }

    // Handle draft editing
    if (draftToEdit) {
      setTo(draftToEdit.to || '');
      setCc('');
      setBcc('');
      setSubject(draftToEdit.subject || '');
      setText(draftToEdit.text || '');
      setAttachments([]);
      setShowCc(false);
      setShowBcc(false);
      setLastSaved(null);
      setHasUnsavedChanges(false);
      return;
    }

    if (!replyContext) {
      // Clear form for new compose
      setTo('');
      setCc('');
      setBcc('');
      setSubject('');
      setText('');
      setAttachments([]);
      setShowCc(false);
      setShowBcc(false);
      setLastSaved(null);
      setHasUnsavedChanges(false);
      return;
    }

    const { type, email } = replyContext;
    
    // Extract email address from "Name <email@domain.com>" format
    const extractEmail = (emailStr: string) => {
      const match = emailStr.match(/<([^>]+)>/);
      return match ? match[1] : emailStr.split('<')[0].trim();
    };

    // Parse multiple recipients handling quoted display names properly
    const parseRecipients = (recipientsStr: string): string[] => {
      const recipients: string[] = [];
      let current = '';
      let inQuotes = false;
      let inAngleBrackets = false;
      
      for (let i = 0; i < recipientsStr.length; i++) {
        const char = recipientsStr[i];
        
        if (char === '"' && !inAngleBrackets) {
          inQuotes = !inQuotes;
          current += char;
        } else if (char === '<') {
          inAngleBrackets = true;
          current += char;
        } else if (char === '>') {
          inAngleBrackets = false;
          current += char;
        } else if (char === ',' && !inQuotes && !inAngleBrackets) {
          if (current.trim()) {
            recipients.push(current.trim());
          }
          current = '';
        } else {
          current += char;
        }
      }
      
      // Add the last recipient
      if (current.trim()) {
        recipients.push(current.trim());
      }
      
      return recipients;
    };

    switch (type) {
      case 'reply':
        setTo(extractEmail(email.from));
        setSubject(email.subject.startsWith('Re: ') ? email.subject : `Re: ${email.subject}`);
        setText(`\n\n--- Original Message ---\nFrom: ${email.from}\nDate: ${new Date(email.date).toLocaleString()}\nSubject: ${email.subject}\n\n${email.text}`);
        break;
        
      case 'replyAll':
        setTo(extractEmail(email.from));
        
        // Parse CC from original email recipients using proper parsing
        const originalRecipients = parseRecipients(email.to).map(r => extractEmail(r));
        console.log('Original recipients:', originalRecipients);
        console.log('Email from:', extractEmail(email.from));
        
        // Get current user's email from token (basic implementation)
        const token = localStorage.getItem('owtranet-token');
        let currentUserEmail = '';
        if (token) {
          try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            currentUserEmail = payload.email || payload.username || '';
            console.log('Current user email from token:', currentUserEmail);
            console.log('Full token payload:', payload);
          } catch (e) {
            console.log('Failed to parse token:', e);
            // Fallback - could also make an API call to get current user
          }
        }
        
        // Create list of user emails to filter out (both token email and company email)
        const emailDomain = useBrandingStore.getState().companyEmailDomain;
        const userEmails: string[] = [];
        if (currentUserEmail) {
          userEmails.push(currentUserEmail);

          // If user has @gmail.com email, also check for corresponding company email
          if (currentUserEmail.includes('@gmail.com') && emailDomain) {
            const username = currentUserEmail.split('@')[0];
            userEmails.push(`${username}@${emailDomain}`);
          }

          // Also check if there's a company email version based on username or github_username from token
          const payload = JSON.parse(atob(localStorage.getItem('owtranet-token')?.split('.')[1] || '{}'));
          if (payload.username && emailDomain) {
            userEmails.push(`${payload.username}@${emailDomain}`);
          }
          if (payload.github_username && emailDomain) {
            userEmails.push(`${payload.github_username}@${emailDomain}`);
          }
        }
        
        console.log('User emails to filter out:', userEmails);
        
        // Filter out all user emails
        const ccRecipients = originalRecipients.filter(recipientEmail => 
          !userEmails.includes(recipientEmail)
        );
        console.log('CC recipients after filtering:', ccRecipients);
        
        setCc(ccRecipients.join(', '));
        setSubject(email.subject.startsWith('Re: ') ? email.subject : `Re: ${email.subject}`);
        setText(`\n\n--- Original Message ---\nFrom: ${email.from}\nDate: ${new Date(email.date).toLocaleString()}\nSubject: ${email.subject}\n\n${email.text}`);
        setShowCc(true);
        break;
        
      case 'forward':
        setTo('');
        setSubject(email.subject.startsWith('Fwd: ') ? email.subject : `Fwd: ${email.subject}`);
        setText(`\n\n--- Forwarded Message ---\nFrom: ${email.from}\nTo: ${email.to}\nDate: ${new Date(email.date).toLocaleString()}\nSubject: ${email.subject}\n\n${email.text}`);
        break;
    }
  }, [replyContext, draftToEdit, initialValues]);

  const handleFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setAttachments(prev => [...prev, ...files]);
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const submitEmail = async (scheduledAt?: Date) => {
    if (!to.trim() || !subject.trim() || !text.trim()) {
      alert('Please fill in recipient, subject, and message');
      return;
    }

    if (scheduledAt) setIsScheduling(true); else setIsSending(true);

    try {
      const emailData: EmailData = {
        to: to.trim(),
        cc: cc.trim() || undefined,
        bcc: bcc.trim() || undefined,
        subject: subject.trim(),
        text: text.trim(),
        html: `<p>${text.trim().replace(/\n/g, '<br>')}</p>`,
        attachments: attachments,
        scheduledAt: scheduledAt ? scheduledAt.toISOString() : undefined
      };

      await onSend(emailData);

      // Reset form
      setTo('');
      setCc('');
      setBcc('');
      setSubject('');
      setText('');
      setAttachments([]);
      setShowCc(false);
      setShowBcc(false);
      setShowSchedule(false);
      setScheduleValue('');
      setHasUnsavedChanges(false);

      onClose();
    } catch (error) {
      console.error(scheduledAt ? 'Failed to schedule email:' : 'Failed to send email:', error);
      const detail = error instanceof Error && error.message ? ` (${error.message})` : '';
      alert(`${scheduledAt ? 'Failed to schedule email' : 'Failed to send email'}. Please try again.${detail}`);
    } finally {
      setIsSending(false);
      setIsScheduling(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitEmail();
  };

  const openSchedule = () => {
    if (!to.trim() || !subject.trim() || !text.trim()) {
      alert('Please fill in recipient, subject, and message before scheduling');
      return;
    }
    if (!scheduleValue) setScheduleValue(toLocalInputValue(schedulePresets()[0].date));
    setShowSchedule(v => !v);
  };

  const handleScheduleConfirm = async () => {
    const date = new Date(scheduleValue);
    if (Number.isNaN(date.getTime())) {
      alert('Please pick a valid date and time');
      return;
    }
    if (date.getTime() - Date.now() < 60 * 1000) {
      alert('The scheduled time must be at least a minute in the future');
      return;
    }
    await submitEmail(date);
  };

  const busy = isSending || isScheduling;
  const canSend = !busy && !!to.trim() && !!subject.trim() && !!text.trim();

  const handleSaveDraft = async () => {
    setIsSavingDraft(true);

    try {
      const token = localStorage.getItem('owtranet-token');
      if (!token) throw new Error('No authentication token');

      const response = await fetch('/api/webmail/draft', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          to: to.trim(),
          cc: cc.trim(),
          bcc: bcc.trim(),
          subject: subject.trim(),
          text: text.trim()
        })
      });

      if (!response.ok) {
        throw new Error('Failed to save draft');
      }

      setLastSaved(new Date());
      setHasUnsavedChanges(false);
    } catch (error) {
      console.error('Failed to save draft:', error);
      alert('Failed to save draft. Please try again.');
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleClose = () => {
    if (busy) return;

    // Warn if there are unsaved changes
    if (hasUnsavedChanges && (to || subject || text)) {
      if (!confirm('You have unsaved changes. Do you want to discard this draft?')) {
        return;
      }
    }

    // Clear auto-save timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">
            {replyContext
              ? `${replyContext.type === 'reply' ? 'Reply' : replyContext.type === 'replyAll' ? 'Reply All' : 'Forward'}: ${replyContext.email.subject}`
              : 'Compose Email'
            }
          </h2>
          <button
            onClick={handleClose}
            disabled={busy}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="p-4 space-y-4 flex-1 overflow-y-auto">
            {/* To Field */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                To *
              </label>
              <input
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="recipient@example.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
                disabled={busy}
              />
            </div>

            {/* CC/BCC Toggle Buttons */}
            <div className="flex items-center space-x-4">
              {!showCc && (
                <button
                  type="button"
                  onClick={() => setShowCc(true)}
                  className="text-sm text-blue-600 hover:text-blue-800"
                  disabled={busy}
                >
                  + CC
                </button>
              )}
              {!showBcc && (
                <button
                  type="button"
                  onClick={() => setShowBcc(true)}
                  className="text-sm text-blue-600 hover:text-blue-800"
                  disabled={busy}
                >
                  + BCC
                </button>
              )}
            </div>

            {/* CC Field */}
            {showCc && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  CC
                </label>
                <input
                  type="text"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  placeholder="cc1@example.com, cc2@example.com"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={busy}
                />
              </div>
            )}

            {/* BCC Field */}
            {showBcc && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  BCC
                </label>
                <input
                  type="text"
                  value={bcc}
                  onChange={(e) => setBcc(e.target.value)}
                  placeholder="bcc1@example.com, bcc2@example.com"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={busy}
                />
              </div>
            )}

            {/* Subject Field */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Subject *
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Email subject"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
                disabled={busy}
              />
            </div>

            {/* Message Field */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Message *
              </label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Write your email message here..."
                rows={12}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
                required
                disabled={busy}
              />
              <p className="text-xs text-gray-500 mt-1">
                Line breaks will be converted to HTML formatting
              </p>
            </div>

            {/* Attachments Section */}
            {attachments.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Attachments ({attachments.length})
                </label>
                <div className="space-y-2">
                  {attachments.map((file, index) => (
                    <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded border">
                      <div className="flex items-center space-x-2">
                        <Paperclip className="h-4 w-4 text-gray-400" />
                        <span className="text-sm text-gray-700">{file.name}</span>
                        <span className="text-xs text-gray-500">({Math.round(file.size / 1024)}KB)</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeAttachment(index)}
                        className="text-red-500 hover:text-red-700"
                        title="Remove attachment"
                      >
                        <Trash className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Hidden File Input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileChange}
              className="hidden"
              accept="*/*"
            />
          </div>

          {/* Footer - Always visible */}
          <div className="relative flex-shrink-0 border-t border-gray-200 bg-gray-50 p-3 sm:p-4">
            {/* Schedule send picker */}
            {showSchedule && (
              <div className="absolute bottom-full right-3 sm:right-4 mb-2 w-80 max-w-[calc(100vw-2rem)] bg-white border border-gray-200 rounded-lg shadow-xl p-4 z-10">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-900 flex items-center">
                    <Clock className="h-4 w-4 mr-1.5 text-gray-500" />
                    Schedule send
                  </h3>
                  <button type="button" onClick={() => setShowSchedule(false)} className="text-gray-400 hover:text-gray-600" title="Close">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="space-y-1 mb-3">
                  {schedulePresets().map(p => {
                    const active = scheduleValue === toLocalInputValue(p.date);
                    return (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => setScheduleValue(toLocalInputValue(p.date))}
                        className={`w-full flex items-center justify-between px-3 py-2 text-sm rounded-md ${active ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-100'}`}
                      >
                        <span>{p.label}</span>
                        <span className="text-xs text-gray-500">{formatScheduleLabel(p.date)}</span>
                      </button>
                    );
                  })}
                </div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Or pick a date and time</label>
                <input
                  type="datetime-local"
                  value={scheduleValue}
                  min={toLocalInputValue(new Date(Date.now() + 2 * 60 * 1000))}
                  onChange={(e) => setScheduleValue(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Times are in your local time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone}).
                </p>
                <button
                  type="button"
                  onClick={handleScheduleConfirm}
                  disabled={busy || !scheduleValue}
                  className="mt-3 w-full inline-flex items-center justify-center px-3 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Clock className="h-4 w-4 mr-1.5" />
                  {isScheduling ? 'Scheduling...' : 'Schedule send'}
                </button>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              {/* Attachment buttons - hidden on very small screens */}
              <div className="hidden sm:flex items-center space-x-2">
                <button
                  type="button"
                  onClick={handleFileSelect}
                  disabled={busy}
                  className="p-2 text-gray-600 hover:text-gray-800 rounded hover:bg-gray-100 disabled:opacity-50"
                  title="Add attachments"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="p-2 text-gray-400 hover:text-gray-600 rounded"
                  title="Rich Text (Coming Soon)"
                  disabled
                >
                  <Type className="h-4 w-4" />
                </button>
              </div>

              {/* Save status */}
              {lastSaved && (
                <div className="text-xs text-gray-500 hidden sm:block">
                  Saved {lastSaved.toLocaleTimeString()}
                </div>
              )}

              {/* Action buttons - always visible */}
              <div className="flex gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={busy || isSavingDraft}
                  className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveDraft}
                  disabled={busy || isSavingDraft || (!to && !subject && !text)}
                  className="inline-flex items-center justify-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Save className="h-4 w-4 mr-1.5" />
                  {isSavingDraft ? 'Saving...' : 'Save Draft'}
                </button>
                <button
                  type="button"
                  onClick={openSchedule}
                  disabled={!canSend}
                  className={`inline-flex items-center justify-center px-3 py-2 border text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed ${showSchedule ? 'border-blue-300 text-blue-700 bg-blue-50' : 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50'}`}
                  title="Schedule send"
                >
                  <Clock className="h-4 w-4 mr-1.5 flex-shrink-0" />
                  <span>Schedule</span>
                </button>
                <button
                  type="submit"
                  disabled={!canSend}
                  className="flex-1 sm:flex-initial inline-flex items-center justify-center px-3 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="h-4 w-4 mr-1 flex-shrink-0" />
                  <span>{isSending ? 'Sending...' : 'Send'}</span>
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EmailCompose;