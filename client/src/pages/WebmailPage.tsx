import React, { useState, useEffect } from 'react';
import { Mail, Inbox, Send, Archive, Trash2, FileText, Search, RefreshCw, AlertCircle, X, Reply, ReplyAll, Forward, Paperclip, Edit, Clock, CheckCircle, AlertTriangle, Ban } from 'lucide-react';
import EmailCompose from '../components/EmailCompose';
import { useBrandingStore } from '../stores/brandingStore';
import LinkifiedText from '../components/LinkifiedText';

interface Email {
  uid: number;
  flags: string[];
  date: string;
  subject: string;
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  text: string;
  html: string;
  attachments?: any[];
}

interface EmailData {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: File[];
  scheduledAt?: string; // ISO-8601; queue instead of send
}

/** Row from GET /api/webmail/scheduled (scheduled_emails). Dates are ISO UTC. */
interface ScheduledEmail {
  id: number;
  to_addr: string;
  cc: string | null;
  bcc: string | null;
  subject: string;
  text_body: string | null;
  attachments: { filename: string; size?: number }[];
  status: 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled';
  attempts: number;
  last_error: string | null;
  scheduled_at: string;
  sent_at: string | null;
  created_at: string;
}

const SCHEDULED_MAILBOX = 'Scheduled'; // virtual folder — lives in MySQL, not IMAP

const formatScheduledTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const WebmailPage: React.FC = () => {
  const { companyName, companyEmailDomain } = useBrandingStore();
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMailbox, setSelectedMailbox] = useState('INBOX');
  const [showCompose, setShowCompose] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [replyContext, setReplyContext] = useState<{type: 'reply' | 'replyAll' | 'forward', email: Email} | null>(null);
  const [draftToEdit, setDraftToEdit] = useState<Email | null>(null);
  const [composeInitial, setComposeInitial] = useState<Partial<EmailData> | null>(null);
  const [scheduledEmails, setScheduledEmails] = useState<ScheduledEmail[]>([]);
  const [scheduledLoading, setScheduledLoading] = useState(false);
  const [scheduledBusyId, setScheduledBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const authHeaders = () => ({
    'Authorization': `Bearer ${localStorage.getItem('owtranet-token') || ''}`,
    'Content-Type': 'application/json'
  });

  const loadScheduled = async () => {
    setScheduledLoading(true);
    try {
      const response = await fetch('/api/webmail/scheduled', { headers: authHeaders() });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }
      const data = await response.json();
      setScheduledEmails(data.emails || []);
    } catch (err) {
      console.error('Error loading scheduled emails:', err);
      // Not fatal for the rest of webmail — keep the badge at its last value.
    } finally {
      setScheduledLoading(false);
    }
  };

  const pendingScheduledCount = scheduledEmails.filter(e => e.status === 'scheduled' || e.status === 'sending' || e.status === 'failed').length;

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(current => (current === message ? null : current)), 6000);
  };

  const openScheduledFolder = () => {
    setSelectedMailbox(SCHEDULED_MAILBOX);
    setSelectedEmail(null);
    loadScheduled();
  };

  const refreshCurrent = () => {
    setSelectedEmail(null);
    if (selectedMailbox === SCHEDULED_MAILBOX) loadScheduled(); else loadEmails(selectedMailbox);
  };

  const handleCancelScheduled = async (item: ScheduledEmail, thenEdit = false) => {
    if (!thenEdit && !confirm('Cancel this scheduled email? It will not be sent.')) return;
    setScheduledBusyId(item.id);
    try {
      const response = await fetch(`/api/webmail/scheduled/${item.id}`, { method: 'DELETE', headers: authHeaders() });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }
      await loadScheduled();
      if (thenEdit) {
        if (item.attachments && item.attachments.length > 0) {
          alert(`This email had ${item.attachments.length} attachment(s). They cannot be restored — please re-attach them before sending.`);
        }
        setReplyContext(null);
        setDraftToEdit(null);
        setComposeInitial({
          to: item.to_addr,
          cc: item.cc || undefined,
          bcc: item.bcc || undefined,
          subject: item.subject,
          text: item.text_body || ''
        });
        setShowCompose(true);
      } else {
        showNotice('Scheduled email cancelled.');
      }
    } catch (err) {
      console.error('Failed to cancel scheduled email:', err);
      alert(`Failed to cancel: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setScheduledBusyId(null);
    }
  };

  const handleSendScheduledNow = async (item: ScheduledEmail) => {
    if (!confirm(`Send "${item.subject}" to ${item.to_addr} right now?`)) return;
    setScheduledBusyId(item.id);
    try {
      const response = await fetch(`/api/webmail/scheduled/${item.id}/send-now`, { method: 'POST', headers: authHeaders() });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const retryNote = data.outcome === 'retry' ? ' It has been re-queued and will be retried automatically in about 5 minutes.' : '';
        throw new Error((data.details || data.error || `HTTP ${response.status}`) + retryNote);
      }
      showNotice('Email sent.');
    } catch (err) {
      console.error('Failed to send scheduled email now:', err);
      alert(`Failed to send: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setScheduledBusyId(null);
      loadScheduled();
    }
  };

  const loadEmails = async (mailbox = 'INBOX', search?: string) => {
    setLoading(true);
    setError(null);
    
    try {
      const token = localStorage.getItem('owtranet-token');
      if (!token) {
        throw new Error('No authentication token');
      }

      let url = `/api/webmail/inbox?limit=50&mailbox=${encodeURIComponent(mailbox)}`;
      if (search) {
        url = `/api/webmail/search?q=${encodeURIComponent(search)}&limit=50&mailbox=${encodeURIComponent(mailbox)}`;
      }

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      setEmails(data.emails || []);
    } catch (error) {
      console.error('Error loading emails:', error);
      setError(error instanceof Error ? error.message : 'Failed to load emails');
      setEmails([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSendEmail = async (emailData: EmailData) => {
    const token = localStorage.getItem('owtranet-token');
    if (!token) {
      throw new Error('No authentication token');
    }

    // Use FormData for file uploads
    const formData = new FormData();
    formData.append('to', emailData.to);
    if (emailData.cc) formData.append('cc', emailData.cc);
    if (emailData.bcc) formData.append('bcc', emailData.bcc);
    formData.append('subject', emailData.subject);
    formData.append('text', emailData.text);
    if (emailData.html) formData.append('html', emailData.html);
    if (emailData.scheduledAt) formData.append('scheduled_at', emailData.scheduledAt);
    
    // Add attachments
    if (emailData.attachments) {
      emailData.attachments.forEach((file: File) => {
        formData.append('attachments', file);
      });
    }

    const response = await fetch('/api/webmail/compose', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
        // Don't set Content-Type - let browser set it for FormData
      },
      body: formData
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to send email');
    }
    const result = await response.json().catch(() => ({}));

    // If editing a draft, delete it after sending
    if (draftToEdit) {
      try {
        const token = localStorage.getItem('owtranet-token');
        await fetch(`/api/webmail/emails/${draftToEdit.uid}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ mailbox: 'Drafts' })
        });
      } catch (error) {
        console.error('Failed to delete draft after sending:', error);
      }
      setDraftToEdit(null);
    }

    // Clear reply context and refresh
    setReplyContext(null);
    setComposeInitial(null);
    if (result.scheduled) {
      showNotice(`Scheduled for ${formatScheduledTime(result.scheduled_at)}. Find it under Scheduled.`);
      loadScheduled();
    } else {
      showNotice('Email sent.');
    }
    if (selectedMailbox === SCHEDULED_MAILBOX) loadScheduled(); else loadEmails(selectedMailbox);
  };

  const handleReply = (type: 'reply' | 'replyAll' | 'forward') => {
    if (!selectedEmail) return;
    
    setReplyContext({ type, email: selectedEmail });
    setShowCompose(true);
  };

  const handleCompose = () => {
    setReplyContext(null);
    setDraftToEdit(null);
    setComposeInitial(null);
    setShowCompose(true);
  };

  const handleArchiveEmail = async (email: Email, goToNext = false) => {
    try {
      const token = localStorage.getItem('owtranet-token');
      if (!token) return;

      await fetch(`/api/webmail/emails/${email.uid}/move`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          targetMailbox: 'Archive',
          sourceMailbox: selectedMailbox 
        })
      });

      // Update local state
      setEmails(prev => prev.filter(e => e.uid !== email.uid));
      
      if (goToNext) {
        // Go to next email or back to list
        const currentIndex = emails.findIndex(e => e.uid === email.uid);
        const nextEmail = emails[currentIndex + 1] || emails[currentIndex - 1];
        setSelectedEmail(nextEmail || null);
      } else {
        setSelectedEmail(null);
      }
      
    } catch (error) {
      console.error('Failed to archive email:', error);
      alert('Failed to archive email');
    }
  };

  const handleDeleteEmail = async (email: Email, goToNext = false) => {
    if (!confirm('Are you sure you want to delete this email? This action cannot be undone.')) {
      return;
    }

    try {
      const token = localStorage.getItem('owtranet-token');
      if (!token) return;

      await fetch(`/api/webmail/emails/${email.uid}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ mailbox: selectedMailbox })
      });

      // Update local state
      setEmails(prev => prev.filter(e => e.uid !== email.uid));
      
      if (goToNext) {
        // Go to next email or back to list
        const currentIndex = emails.findIndex(e => e.uid === email.uid);
        const nextEmail = emails[currentIndex + 1] || emails[currentIndex - 1];
        setSelectedEmail(nextEmail || null);
      } else {
        setSelectedEmail(null);
      }
      
    } catch (error) {
      console.error('Failed to delete email:', error);
      alert('Failed to delete email');
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      loadEmails(selectedMailbox, searchQuery.trim());
    } else {
      loadEmails(selectedMailbox);
    }
  };

  const handleEmailClick = async (email: Email) => {
    // Set email immediately for quick UI response (with headers-only data)
    setSelectedEmail(email);

    try {
      const token = localStorage.getItem('owtranet-token');
      if (token) {
        // Fetch full email content if we only have headers
        if (!email.text && !email.html) {
          const response = await fetch(`/api/webmail/emails/${email.uid}?mailbox=${encodeURIComponent(selectedMailbox)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });

          if (response.ok) {
            const data = await response.json();
            const fullEmail = { ...email, ...data.email };
            setSelectedEmail(fullEmail);

            // Update the email in the list with full content
            setEmails(prev => prev.map(e =>
              e.uid === email.uid ? fullEmail : e
            ));
          }
        }

        // Mark as read if not already read
        if (!email.flags.includes('\\Seen')) {
          await fetch(`/api/webmail/emails/${email.uid}/read`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ mailbox: selectedMailbox })
          });

          // Update local state
          setEmails(prev => prev.map(e =>
            e.uid === email.uid
              ? { ...e, flags: [...e.flags.filter(f => f !== '\\Seen'), '\\Seen'] }
              : e
          ));
        }
      }
    } catch (error) {
      console.error('Failed to load email:', error);
    }
  };

  const formatEmailTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  };

  useEffect(() => {
    loadEmails();
    loadScheduled(); // badge count for the Scheduled folder
  }, []);

  // Gmail-style keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle shortcuts when not typing in input fields
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Only handle shortcuts when webmail is open and email is selected
      if (!selectedEmail) return;

      // Ignore shortcuts when modifier keys are pressed (Alt/Option, Ctrl, Meta/Cmd)
      if (e.altKey || e.ctrlKey || e.metaKey) {
        return;
      }

      switch (e.key) {
        case '[':
          e.preventDefault();
          handleArchiveEmail(selectedEmail, true); // Archive and go to next
          break;
        case 'e':
          e.preventDefault();
          handleArchiveEmail(selectedEmail, false); // Archive
          break;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          handleDeleteEmail(selectedEmail, true); // Delete and go to next
          break;
        case 'r':
          e.preventDefault();
          handleReply('reply');
          break;
        case 'a':
          e.preventDefault();
          handleReply('replyAll');
          break;
        case 'f':
          e.preventDefault();
          handleReply('forward');
          break;
        case 'c':
          e.preventDefault();
          handleCompose();
          break;
        case 'u':
          e.preventDefault();
          setSelectedEmail(null); // Back to inbox
          break;
        case 'j':
          e.preventDefault();
          // Go to next email
          const currentIndex = emails.findIndex(e => e.uid === selectedEmail.uid);
          const nextEmail = emails[currentIndex + 1];
          if (nextEmail) setSelectedEmail(nextEmail);
          break;
        case 'k':
          e.preventDefault();
          // Go to previous email
          const prevIndex = emails.findIndex(e => e.uid === selectedEmail.uid);
          const prevEmail = emails[prevIndex - 1];
          if (prevEmail) setSelectedEmail(prevEmail);
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedEmail, emails, selectedMailbox]);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Webmail</h1>
            <p className="mt-1 text-sm text-gray-600">
              {`Your @${companyEmailDomain} Email Interface`}
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <button 
              onClick={refreshCurrent}
              disabled={loading || scheduledLoading}
              className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${loading || scheduledLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button 
              onClick={handleCompose}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            >
              <Send className="h-4 w-4 mr-2" />
              Compose
            </button>
          </div>
        </div>
      </div>

      {/* New Feature Notice */}
      <div className="mb-6 bg-blue-50 border border-blue-200 rounded-md p-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <Mail className="h-5 w-5 text-blue-400" />
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-blue-800">
              {`🆕 New: ${companyName} Webmail Interface with Keyboard Shortcuts!`}
            </h3>
            <div className="mt-2 text-sm text-blue-700">
              <p>
                {`Access your @${companyEmailDomain} email account directly through the intranet!`} Compose emails, read messages, 
                manage folders, and search through your emails - all without leaving the platform.
              </p>
              <p className="mt-2">
                <strong>⌨️ Keyboard shortcuts:</strong> [ = Archive & Next, Delete/Backspace = Delete, r = Reply, a = Reply All, f = Forward, c = Compose, j/k = Navigate
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white shadow rounded-lg">
        <div className="flex">
          {/* Sidebar */}
          <div className="w-64 bg-gray-50 rounded-l-lg p-4 border-r border-gray-200">
            <div className="space-y-1">
              <button 
                onClick={() => {
                  setSelectedMailbox('INBOX'); 
                  setSelectedEmail(null); 
                  loadEmails('INBOX');
                }}
                className={`w-full text-left px-3 py-2 text-sm font-medium rounded-md ${
                  selectedMailbox === 'INBOX' && !selectedEmail ? 'text-gray-900 bg-primary-100' : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <div className="flex items-center">
                  <Inbox className="h-4 w-4 mr-3" />
                  Inbox
                  {emails.length > 0 && selectedMailbox === 'INBOX' && (
                    <span className="ml-auto text-xs bg-primary-600 text-white rounded-full px-2 py-1">
                      {emails.filter(e => !e.flags.includes('\\Seen')).length}
                    </span>
                  )}
                </div>
              </button>
              <button
                onClick={() => {
                  setSelectedMailbox('Sent');
                  setSelectedEmail(null);
                  loadEmails('Sent');
                }}
                className={`w-full text-left px-3 py-2 text-sm font-medium rounded-md ${
                  selectedMailbox === 'Sent' && !selectedEmail ? 'text-gray-900 bg-primary-100' : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <div className="flex items-center">
                  <Send className="h-4 w-4 mr-3" />
                  Sent
                </div>
              </button>
              <button
                onClick={() => {
                  setSelectedMailbox('Drafts');
                  setSelectedEmail(null);
                  loadEmails('Drafts');
                }}
                className={`w-full text-left px-3 py-2 text-sm font-medium rounded-md ${
                  selectedMailbox === 'Drafts' && !selectedEmail ? 'text-gray-900 bg-primary-100' : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <div className="flex items-center">
                  <FileText className="h-4 w-4 mr-3" />
                  Drafts
                </div>
              </button>
              <button
                onClick={openScheduledFolder}
                className={`w-full text-left px-3 py-2 text-sm font-medium rounded-md ${
                  selectedMailbox === SCHEDULED_MAILBOX && !selectedEmail ? 'text-gray-900 bg-primary-100' : 'text-gray-700 hover:bg-gray-100'
                }`}
                title="Emails queued to send later"
              >
                <div className="flex items-center">
                  <Clock className="h-4 w-4 mr-3" />
                  Scheduled
                  {pendingScheduledCount > 0 && (
                    <span className="ml-auto text-xs bg-gray-200 text-gray-700 rounded-full px-2 py-1">
                      {pendingScheduledCount}
                    </span>
                  )}
                </div>
              </button>
              <button
                onClick={() => {
                  setSelectedMailbox('Archive');
                  setSelectedEmail(null);
                  loadEmails('Archive');
                }}
                className={`w-full text-left px-3 py-2 text-sm font-medium rounded-md ${
                  selectedMailbox === 'Archive' && !selectedEmail ? 'text-gray-900 bg-primary-100' : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <div className="flex items-center">
                  <Archive className="h-4 w-4 mr-3" />
                  Archive
                </div>
              </button>
              <button 
                onClick={() => {
                  setSelectedMailbox('Trash'); 
                  setSelectedEmail(null); 
                  loadEmails('Trash');
                }}
                className={`w-full text-left px-3 py-2 text-sm font-medium rounded-md ${
                  selectedMailbox === 'Trash' && !selectedEmail ? 'text-gray-900 bg-primary-100' : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <div className="flex items-center">
                  <Trash2 className="h-4 w-4 mr-3" />
                  Trash
                </div>
              </button>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 p-6">
            {/* Search Bar */}
            <form onSubmit={handleSearch} className="mb-6">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Search className="h-4 w-4 text-gray-400" />
                </div>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search emails..."
                  className="block w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-primary-500 focus:border-primary-500 text-sm"
                />
              </div>
            </form>

            {/* Success notice (schedule / cancel / send-now) */}
            {notice && (
              <div className="mb-6 bg-green-50 border border-green-200 rounded-md p-4">
                <div className="flex items-start">
                  <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                  <p className="ml-3 text-sm text-green-800 flex-1">{notice}</p>
                  <button onClick={() => setNotice(null)} className="text-green-500 hover:text-green-700" title="Dismiss">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Error State */}
            {error && selectedMailbox !== SCHEDULED_MAILBOX && (
              <div className="mb-6 bg-red-50 border border-red-200 rounded-md p-4">
                <div className="flex">
                  <AlertCircle className="h-5 w-5 text-red-400" />
                  <div className="ml-3">
                    <p className="text-sm text-red-800">{error}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Loading State */}
            {loading && selectedMailbox !== SCHEDULED_MAILBOX && (
              <div className="text-center py-8">
                <RefreshCw className="h-8 w-8 animate-spin mx-auto text-gray-400 mb-2" />
                <p className="text-gray-500">Loading emails...</p>
              </div>
            )}

            {/* Show EITHER Email List OR Email Detail (not both) */}
            {selectedEmail ? (
              /* Email Detail View - Full Screen */
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="p-6 border-b border-gray-200">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <h2 className="text-xl font-semibold text-gray-900 mb-3">
                        {selectedEmail.subject}
                      </h2>
                      <div className="space-y-2">
                        <div className="flex items-center text-sm text-gray-600">
                          <span className="font-medium w-16">From:</span>
                          <span>
                            {typeof selectedEmail.from === 'string' 
                              ? selectedEmail.from 
                              : (selectedEmail.from as any)?.text || (selectedEmail.from as any)?.value || String(selectedEmail.from)
                            }
                          </span>
                        </div>
                        <div className="flex items-center text-sm text-gray-600">
                          <span className="font-medium w-16">To:</span>
                          <span>
                            {typeof selectedEmail.to === 'string' 
                              ? selectedEmail.to 
                              : (selectedEmail.to as any)?.text || (selectedEmail.to as any)?.value || String(selectedEmail.to)
                            }
                          </span>
                        </div>
                        {selectedEmail.cc && (
                          <div className="flex items-center text-sm text-gray-600">
                            <span className="font-medium w-16">CC:</span>
                            <span>
                              {typeof selectedEmail.cc === 'string' 
                                ? selectedEmail.cc 
                                : (selectedEmail.cc as any)?.text || (selectedEmail.cc as any)?.value || String(selectedEmail.cc)
                              }
                            </span>
                          </div>
                        )}
                        {selectedEmail.bcc && (
                          <div className="flex items-center text-sm text-gray-600">
                            <span className="font-medium w-16">BCC:</span>
                            <span>
                              {typeof selectedEmail.bcc === 'string' 
                                ? selectedEmail.bcc 
                                : (selectedEmail.bcc as any)?.text || (selectedEmail.bcc as any)?.value || String(selectedEmail.bcc)
                              }
                            </span>
                          </div>
                        )}
                        <div className="flex items-center text-sm text-gray-600">
                          <span className="font-medium w-16">Date:</span>
                          <span>{new Date(selectedEmail.date).toLocaleString()}</span>
                        </div>
                        {selectedEmail.attachments && selectedEmail.attachments.length > 0 && (
                          <div className="flex items-center text-sm text-gray-600">
                            <span className="font-medium w-16">Files:</span>
                            <div className="flex items-center space-x-2">
                              <Paperclip className="h-4 w-4" />
                              <span>{selectedEmail.attachments.length} attachment{selectedEmail.attachments.length > 1 ? 's' : ''}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => setSelectedEmail(null)}
                      className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100"
                      title="Close email"
                    >
                      <X className="h-6 w-6" />
                    </button>
                  </div>
                  
                  {/* Action Buttons */}
                  <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                    {/* Draft Edit or Reply Actions */}
                    <div className="flex items-center space-x-2">
                      {selectedMailbox === 'Drafts' ? (
                        <button
                          onClick={() => {
                            setDraftToEdit(selectedEmail);
                            setShowCompose(true);
                          }}
                          className="inline-flex items-center px-3 py-2 border border-blue-300 shadow-sm text-sm font-medium rounded-md text-blue-700 bg-blue-50 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                          title="Edit Draft"
                        >
                          <Edit className="h-4 w-4 mr-2" />
                          Edit Draft
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => handleReply('reply')}
                            className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                            title="Reply (r)"
                          >
                            <Reply className="h-4 w-4 mr-2" />
                            Reply
                          </button>
                          <button
                            onClick={() => handleReply('replyAll')}
                            className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                            title="Reply All (a)"
                          >
                            <ReplyAll className="h-4 w-4 mr-2" />
                            Reply All
                          </button>
                          <button
                            onClick={() => handleReply('forward')}
                            className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                            title="Forward (f)"
                          >
                            <Forward className="h-4 w-4 mr-2" />
                            Forward
                          </button>
                        </>
                      )}
                    </div>

                    {/* Archive and Delete Actions */}
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleArchiveEmail(selectedEmail, true)}
                        className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                        title="Archive & Next ([)"
                      >
                        <Archive className="h-4 w-4 mr-2" />
                        Archive & Next
                      </button>
                      <button
                        onClick={() => handleDeleteEmail(selectedEmail, true)}
                        className="inline-flex items-center px-3 py-2 border border-red-300 shadow-sm text-sm font-medium rounded-md text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                        title="Delete (Delete/Backspace key)"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
                
                <div className="p-6">
                  {(() => {
                    // Safely extract HTML content
                    let htmlContent = '';
                    if (selectedEmail.html) {
                      if (typeof selectedEmail.html === 'string') {
                        htmlContent = selectedEmail.html;
                      } else if (selectedEmail.html && typeof selectedEmail.html === 'object') {
                        htmlContent = (selectedEmail.html as any)?.html || 
                                     (selectedEmail.html as any)?.value || 
                                     String(selectedEmail.html);
                      } else {
                        htmlContent = String(selectedEmail.html);
                      }
                    }
                    
                    // Safely extract text content
                    let textContent = '';
                    if (selectedEmail.text) {
                      if (typeof selectedEmail.text === 'string') {
                        textContent = selectedEmail.text;
                      } else if (selectedEmail.text && typeof selectedEmail.text === 'object') {
                        textContent = (selectedEmail.text as any)?.text || 
                                     (selectedEmail.text as any)?.value || 
                                     String(selectedEmail.text);
                      } else {
                        textContent = String(selectedEmail.text);
                      }
                    }
                    
                    return htmlContent ? (
                      <div 
                        className="prose prose-sm max-w-none"
                        dangerouslySetInnerHTML={{ __html: htmlContent }}
                      />
                    ) : (
                      <div className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed">
                        <LinkifiedText text={textContent} />
                      </div>
                    );
                  })()}
                  
                  {/* Attachments */}
                  {selectedEmail.attachments && selectedEmail.attachments.length > 0 && (
                    <div className="mt-6 pt-6 border-t border-gray-200">
                      <h4 className="text-sm font-medium text-gray-900 mb-3">
                        Attachments ({selectedEmail.attachments.length})
                      </h4>
                      <div className="space-y-2">
                        {selectedEmail.attachments.map((attachment: any, index: number) => (
                          <div key={index} className="flex items-center p-3 bg-gray-50 rounded-md border border-gray-200">
                            <Paperclip className="h-4 w-4 text-gray-400 mr-3" />
                            <div className="flex-1">
                              <p className="text-sm font-medium text-gray-900">
                                {attachment.filename || `Attachment ${index + 1}`}
                              </p>
                              <p className="text-xs text-gray-500">
                                {attachment.contentType || 'Unknown type'}
                                {attachment.size && ` • ${Math.round(attachment.size / 1024)}KB`}
                              </p>
                            </div>
                            <button
                              onClick={async () => {
                                try {
                                  const token = localStorage.getItem('owtranet-token');
                                  if (!token) {
                                    alert('Authentication required');
                                    return;
                                  }

                                  const response = await fetch(
                                    `/api/webmail/emails/${selectedEmail.uid}/attachments/${index}?mailbox=${encodeURIComponent(selectedMailbox)}`,
                                    {
                                      headers: {
                                        'Authorization': `Bearer ${token}`
                                      }
                                    }
                                  );

                                  if (!response.ok) {
                                    const errorData = await response.json();
                                    throw new Error(errorData.error || 'Download failed');
                                  }

                                  // Get the blob and create a download link
                                  const blob = await response.blob();
                                  const url = window.URL.createObjectURL(blob);
                                  const a = document.createElement('a');
                                  a.href = url;
                                  a.download = attachment.filename || `attachment_${index + 1}`;
                                  document.body.appendChild(a);
                                  a.click();
                                  window.URL.revokeObjectURL(url);
                                  document.body.removeChild(a);
                                } catch (error) {
                                  console.error('Download error:', error);
                                  alert(`Failed to download attachment: ${error instanceof Error ? error.message : 'Unknown error'}`);
                                }
                              }}
                              className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                            >
                              Download
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : selectedMailbox === SCHEDULED_MAILBOX ? (
              /* Scheduled sends — virtual folder backed by scheduled_emails */
              <div className="space-y-2">
                {scheduledLoading && scheduledEmails.length === 0 ? (
                  <div className="text-center py-8">
                    <RefreshCw className="h-8 w-8 animate-spin mx-auto text-gray-400 mb-2" />
                    <p className="text-gray-500">Loading scheduled emails...</p>
                  </div>
                ) : scheduledEmails.length === 0 ? (
                  <div className="text-center py-8">
                    <Clock className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                    <p className="text-gray-500">No scheduled emails</p>
                    <p className="text-xs text-gray-400 mt-1">Compose an email and choose “Schedule” instead of “Send”.</p>
                  </div>
                ) : (
                  scheduledEmails.map((item) => {
                    const busy = scheduledBusyId === item.id;
                    const actionable = item.status === 'scheduled' || item.status === 'failed';
                    const statusChip = {
                      scheduled: { cls: 'bg-blue-100 text-blue-800', icon: <Clock className="h-3 w-3 mr-1" />, label: 'Scheduled' },
                      sending:   { cls: 'bg-yellow-100 text-yellow-800', icon: <RefreshCw className="h-3 w-3 mr-1 animate-spin" />, label: 'Sending' },
                      sent:      { cls: 'bg-green-100 text-green-800', icon: <CheckCircle className="h-3 w-3 mr-1" />, label: 'Sent' },
                      failed:    { cls: 'bg-red-100 text-red-800', icon: <AlertTriangle className="h-3 w-3 mr-1" />, label: 'Failed' },
                      cancelled: { cls: 'bg-gray-100 text-gray-700', icon: <Ban className="h-3 w-3 mr-1" />, label: 'Cancelled' }
                    }[item.status];
                    return (
                      <div key={item.id} className={`p-4 border rounded-md bg-white ${item.status === 'failed' ? 'border-red-200' : 'border-gray-200'}`}>
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusChip.cls}`}>
                                {statusChip.icon}{statusChip.label}
                              </span>
                              <span className="text-xs text-gray-500">
                                {item.status === 'sent' && item.sent_at
                                  ? `Sent ${formatScheduledTime(item.sent_at)}`
                                  : `${item.status === 'failed' ? 'Was due' : 'Sends'} ${formatScheduledTime(item.scheduled_at)}`}
                              </span>
                            </div>
                            <p className="text-sm font-medium text-gray-900 mt-2 truncate">{item.subject}</p>
                            <p className="text-sm text-gray-600 truncate">To: {item.to_addr}{item.cc ? ` · CC: ${item.cc}` : ''}</p>
                            {item.text_body && (
                              <p className="text-xs text-gray-500 mt-1 truncate">{item.text_body.substring(0, 120)}{item.text_body.length > 120 ? '...' : ''}</p>
                            )}
                            {item.attachments && item.attachments.length > 0 && (
                              <p className="text-xs text-gray-500 mt-1 flex items-center">
                                <Paperclip className="h-3 w-3 mr-1" />
                                {item.attachments.map(a => a.filename).join(', ')}
                              </p>
                            )}
                            {item.status === 'failed' && item.last_error && (
                              <p className="text-xs text-red-700 mt-1">Error after {item.attempts} attempt{item.attempts === 1 ? '' : 's'}: {item.last_error}</p>
                            )}
                          </div>
                          {actionable && (
                            <div className="flex flex-col sm:flex-row gap-2 flex-shrink-0">
                              <button
                                onClick={() => handleSendScheduledNow(item)}
                                disabled={busy}
                                className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50"
                                title="Send now"
                              >
                                <Send className="h-3.5 w-3.5 mr-1" />
                                Send now
                              </button>
                              <button
                                onClick={() => handleCancelScheduled(item, true)}
                                disabled={busy}
                                className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                                title="Cancel and reopen in the composer"
                              >
                                <Edit className="h-3.5 w-3.5 mr-1" />
                                Edit
                              </button>
                              <button
                                onClick={() => handleCancelScheduled(item)}
                                disabled={busy}
                                className="inline-flex items-center px-3 py-1.5 border border-red-200 text-xs font-medium rounded-md text-red-700 bg-white hover:bg-red-50 disabled:opacity-50"
                                title="Cancel scheduled send"
                              >
                                <Ban className="h-3.5 w-3.5 mr-1" />
                                Cancel
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
                {scheduledEmails.length > 0 && (
                  <p className="text-xs text-gray-400 pt-2">Sent items stay here for 7 days; they are also in your Sent folder.</p>
                )}
              </div>
            ) : (
              /* Email List View */
              <>
                {!loading && !error && (
                  <div className="space-y-2">
                    {emails.length === 0 ? (
                      <div className="text-center py-8">
                        <Mail className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                        <p className="text-gray-500">No emails found in {selectedMailbox}</p>
                      </div>
                    ) : (
                      emails.map((email) => {
                        const isUnread = !email.flags.includes('\\Seen');
                        return (
                          <div
                            key={email.uid}
                            onClick={() => handleEmailClick(email)}
                            className={`p-4 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer transition-colors ${
                              isUnread ? 'bg-blue-50 border-blue-200' : 'bg-white'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-3 flex-1">
                                <div className="flex-shrink-0">
                                  <div className="w-8 h-8 bg-primary-500 rounded-full flex items-center justify-center">
                                    <span className="text-sm font-medium text-white">
                                      {(() => {
                                        const fromText = typeof email.from === 'string' 
                                          ? email.from 
                                          : (email.from as any)?.text || (email.from as any)?.value || String(email.from);
                                        return fromText.charAt(0).toUpperCase();
                                      })()}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between">
                                    <p className={`text-sm ${isUnread ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
                                      {typeof email.from === 'string' 
                                        ? email.from 
                                        : (email.from as any)?.text || (email.from as any)?.value || String(email.from)
                                      }
                                    </p>
                                    <p className="text-xs text-gray-500">
                                      {formatEmailTime(email.date)}
                                    </p>
                                  </div>
                                  <p className={`text-sm ${isUnread ? 'font-medium text-gray-900' : 'text-gray-600'} mt-1 truncate`}>
                                    {email.subject}
                                  </p>
                                  {email.text && (
                                    <p className="text-xs text-gray-500 mt-1 truncate">
                                      {(() => {
                                        const textContent = typeof email.text === 'string' 
                                          ? email.text 
                                          : (email.text as any)?.text || (email.text as any)?.value || String(email.text);
                                        return textContent.substring(0, 100) + (textContent.length > 100 ? '...' : '');
                                      })()}
                                    </p>
                                  )}
                                </div>
                                {isUnread && (
                                  <div className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0" />
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {/* Pagination */}
                {!loading && emails.length > 0 && (
                  <div className="mt-6 flex items-center justify-between">
                    <div className="text-sm text-gray-500">
                      Showing {emails.length} emails in {selectedMailbox}
                    </div>
                    <div className="flex items-center space-x-2">
                      <button 
                        onClick={() => loadEmails(selectedMailbox)}
                        className="px-3 py-1 text-sm text-primary-600 hover:text-primary-700"
                      >
                        Load More
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Email Compose Modal */}
      <EmailCompose
        isOpen={showCompose}
        onClose={() => {
          setShowCompose(false);
          setReplyContext(null);
          setDraftToEdit(null);
          setComposeInitial(null);
        }}
        onSend={handleSendEmail}
        replyContext={replyContext}
        draftToEdit={draftToEdit}
        initialValues={composeInitial}
      />
    </div>
  );
};

export default WebmailPage;