import React, { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ForumContent from '../components/ForumContent';
import {
  Users,
  Send,
  MessageCircle,
  Hash,
  User,
  Heart,
  Reply,
  X,
  ArrowDown,
  ArrowLeft
} from 'lucide-react';
import { groupChatApi } from '../utils/api';
import { notifyBadgesChanged } from '../utils/badges';
import { useAuthStore } from '../stores/authStore';
import type { GroupChatMessage, Group } from '../types';

const MAX_MESSAGE_LENGTH = 2000;
const MESSAGE_POLL_MS = 5000;
const GROUPS_POLL_MS = 30000;
const STICKY_THRESHOLD_PX = 80;

// Cheap change detection so a poll that returns the same chat does not
// re-render (and re-layout) every message bubble.
const fingerprint = (list: GroupChatMessage[]): string =>
  list
    .map(m => `${m.id}:${m.total_likes ?? 0}:${m.user_liked ? 1 : 0}:${m.is_edited ? 1 : 0}:${m.updated_at}`)
    .join('|');

const formatWhen = (iso: string): string => {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }) + ' ' + time;
};

const GroupChatPage: React.FC = () => {
  const { groupName } = useParams<{ groupName: string }>();
  const navigate = useNavigate();
  const me = useAuthStore(s => s.user);

  const [groups, setGroups] = useState<Group[]>([]);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [pageError, setPageError] = useState('');

  const [messages, setMessages] = useState<GroupChatMessage[]>([]);
  const [loadedGroupId, setLoadedGroupId] = useState<number | null>(null);
  const [messagesError, setMessagesError] = useState('');
  const [newBelow, setNewBelow] = useState(false);

  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<GroupChatMessage | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottomRef = useRef(true);
  const initialScrollPendingRef = useRef(false);
  const lastMarkedReadRef = useRef<number | null>(null);
  const lastMessageIdRef = useRef<number | null>(null);

  const selectedGroup = useMemo(
    () => (groupName ? groups.find(g => g.name === groupName) ?? null : null),
    [groups, groupName]
  );
  const selectedGroupId = selectedGroup?.id ?? null;

  // ---- Groups list -------------------------------------------------------

  const loadGroups = useCallback(async (initial = false) => {
    try {
      const data = await groupChatApi.getUserGroups();
      setGroups(data);
      setPageError('');
    } catch (error) {
      console.error('Failed to load groups:', error);
      if (initial) setPageError('Failed to load groups');
    } finally {
      if (initial) setGroupsLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadGroups(true);
    const timer = setInterval(() => { if (!document.hidden) loadGroups(); }, GROUPS_POLL_MS);
    return () => clearInterval(timer);
  }, [loadGroups]);

  // ---- Messages -----------------------------------------------------------

  const markRead = useCallback((groupId: number, messageId: number) => {
    if (document.hidden || lastMarkedReadRef.current === messageId) return;
    lastMarkedReadRef.current = messageId;
    groupChatApi.markAsRead(groupId, messageId)
      .then(() => {
        setGroups(prev => prev.map(g => (g.id === groupId ? { ...g, unread_count: 0 } : g)));
        notifyBadgesChanged();
      })
      .catch(() => { lastMarkedReadRef.current = null; });
  }, []);

  const loadMessages = useCallback(async (groupId: number, initial = false) => {
    try {
      const data = await groupChatApi.getMessages(groupId);
      setMessages(prev => (!initial && fingerprint(prev) === fingerprint(data) ? prev : data));
      setMessagesError('');
      const last = data[data.length - 1];
      if (last) markRead(groupId, last.id);
    } catch (error) {
      console.error('Failed to load messages:', error);
      if (initial) setMessagesError('Failed to load messages');
    } finally {
      if (initial) setLoadedGroupId(groupId);
    }
  }, [markRead]);

  useEffect(() => {
    setMessages([]);
    setLoadedGroupId(null);
    setMessagesError('');
    setSendError('');
    setReplyTo(null);
    setNewBelow(false);
    stickToBottomRef.current = true;
    initialScrollPendingRef.current = true;
    lastMarkedReadRef.current = null;
    lastMessageIdRef.current = null;
    if (selectedGroupId === null) return;

    loadMessages(selectedGroupId, true);
    const timer = setInterval(() => { if (!document.hidden) loadMessages(selectedGroupId); }, MESSAGE_POLL_MS);
    const onVisible = () => { if (!document.hidden) loadMessages(selectedGroupId); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [selectedGroupId, loadMessages]);

  // ---- Scrolling ------------------------------------------------------------

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
    stickToBottomRef.current = true;
    setNewBelow(false);
  }, []);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distance < STICKY_THRESHOLD_PX;
    if (stickToBottomRef.current) setNewBelow(false);
  };

  // Keep the view pinned to the newest message unless the reader scrolled up.
  useLayoutEffect(() => {
    if (loadedGroupId === null || messages.length === 0) return;
    const last = messages[messages.length - 1];
    const isNew = lastMessageIdRef.current !== null && last.id !== lastMessageIdRef.current;
    lastMessageIdRef.current = last.id;

    if (initialScrollPendingRef.current) {
      initialScrollPendingRef.current = false;
      scrollToBottom('auto');
      // Images/embeds finish loading after first paint; settle once more.
      const settle = setTimeout(() => { if (stickToBottomRef.current) scrollToBottom('auto'); }, 400);
      return () => clearTimeout(settle);
    }
    if (stickToBottomRef.current || last.sender_id === me?.id) {
      scrollToBottom('smooth');
    } else if (isNew) {
      setNewBelow(true);
    }
  }, [messages, loadedGroupId, me?.id, scrollToBottom]);

  // ---- Composer -------------------------------------------------------------

  const send = async () => {
    const content = draft.trim();
    if (!content || !selectedGroup || isSending || isUploading) return;
    if (content.length > MAX_MESSAGE_LENGTH) {
      setSendError(`Message cannot exceed ${MAX_MESSAGE_LENGTH} characters`);
      return;
    }
    setIsSending(true);
    setSendError('');
    try {
      await groupChatApi.sendMessage(selectedGroup.id, content, replyTo?.id);
      setDraft('');
      setReplyTo(null);
      stickToBottomRef.current = true;
      await loadMessages(selectedGroup.id);
      loadGroups();
      textareaRef.current?.focus();
    } catch (error) {
      console.error('Failed to send message:', error);
      setSendError('Your message was not sent. It is still in the box — press Send to try again.');
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape' && replyTo) {
      setReplyTo(null);
    }
  };

  const uploadImage = async (file: File) => {
    try {
      setIsUploading(true);
      setSendError('');

      const formData = new FormData();
      formData.append('image', file);

      const token = localStorage.getItem('owtranet-token');
      const response = await fetch('/api/upload/image', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      if (!response.ok) throw new Error('Failed to upload image');
      const data = await response.json();

      const textarea = textareaRef.current;
      const start = textarea?.selectionStart ?? draft.length;
      const end = textarea?.selectionEnd ?? draft.length;
      const next = draft.substring(0, start) + data.markdown + draft.substring(end);
      setDraft(next);
      setTimeout(() => {
        textarea?.focus();
        textarea?.setSelectionRange(start + data.markdown.length, start + data.markdown.length);
      }, 0);
    } catch (err) {
      console.error('Image upload error:', err);
      setSendError('Failed to upload image. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) await uploadImage(file);
        break;
      }
    }
  };

  const likeMessage = async (messageId: number) => {
    if (!selectedGroup) return;
    try {
      const data = await groupChatApi.likeMessage(selectedGroup.id, messageId);
      setMessages(prev =>
        prev.map(msg =>
          msg.id === messageId
            ? { ...msg, total_likes: data.total_likes, user_liked: data.user_liked }
            : msg
        )
      );
    } catch (error) {
      console.error('Failed to like message:', error);
    }
  };

  const startReply = (message: GroupChatMessage) => {
    setReplyTo(message);
    textareaRef.current?.focus();
  };

  // ---- Render ---------------------------------------------------------------

  if (!groupsLoaded) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading groups...</p>
        </div>
      </div>
    );
  }

  if (pageError) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4">
        <h3 className="text-sm font-medium text-red-800">Error</h3>
        <div className="mt-2 text-sm text-red-700">{pageError}</div>
        <button onClick={() => loadGroups(true)} className="mt-3 text-sm text-red-700 underline">Try again</button>
      </div>
    );
  }

  const unknownGroup = !!groupName && !selectedGroup;
  const isMessagesLoading = selectedGroupId !== null && loadedGroupId !== selectedGroupId;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex h-[calc(100vh-9rem)] min-h-[24rem] bg-white rounded-lg border border-gray-200 overflow-hidden">
        {/* Groups Sidebar (hidden on small screens while a chat is open) */}
        <div className={`w-full md:w-80 md:flex-shrink-0 border-r border-gray-200 overflow-y-auto ${selectedGroup ? 'hidden md:block' : ''}`}>
          <div className="p-4 border-b border-gray-200">
            <h1 className="text-xl font-bold text-gray-900 flex items-center">
              <Users className="h-6 w-6 mr-2" />
              Group Chat
            </h1>
          </div>
          
          <div className="divide-y divide-gray-100">
            {groups.length === 0 ? (
              <div className="p-4 text-center text-gray-500">
                <Users className="h-12 w-12 mx-auto text-gray-300 mb-4" />
                <p>No groups found</p>
                <p className="text-sm mt-2">Ask an admin to add you to groups</p>
              </div>
            ) : (
              groups.map((group) => {
                const active = selectedGroupId === group.id;
                const unread = group.unread_count || 0;
                return (
                  <button
                    type="button"
                    key={group.id}
                    onClick={() => navigate(`/group-chat/${group.name}`)}
                    className={`w-full text-left p-4 hover:bg-gray-50 ${active ? 'bg-blue-50 border-r-2 border-blue-500' : ''}`}
                  >
                    <div className="flex items-center">
                      <div className="flex items-center justify-center w-10 h-10 bg-blue-100 rounded-lg mr-3 flex-shrink-0">
                        <Hash className="h-5 w-5 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className={`text-sm truncate ${unread > 0 ? 'font-semibold text-gray-900' : 'font-medium text-gray-900'}`}>
                            {group.display_name}
                          </p>
                          {group.last_message_at && (
                            <span className="text-xs text-gray-400 ml-2 flex-shrink-0">
                              {formatWhen(group.last_message_at)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          <p className={`text-sm truncate ${unread > 0 ? 'text-gray-700' : 'text-gray-500'}`}>
                            {group.last_message
                              ? `${group.last_sender_name}: ${group.last_message}`
                              : <span className="italic">No messages yet</span>}
                          </p>
                          {unread > 0 && (
                            <span className="ml-2 bg-red-500 text-white text-xs font-semibold rounded-full min-w-[1.25rem] h-5 px-1.5 flex items-center justify-center flex-shrink-0">
                              {unread > 99 ? '99+' : unread}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Chat Area */}
        <div className={`flex-1 min-w-0 flex-col ${selectedGroup ? 'flex' : 'hidden md:flex'}`}>
          {selectedGroup ? (
            <>
              {/* Chat Header */}
              <div className="p-4 border-b border-gray-200 bg-white flex items-center">
                <button
                  type="button"
                  onClick={() => navigate('/group-chat')}
                  className="md:hidden mr-3 text-gray-500 hover:text-gray-700"
                  title="Back to groups"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div className="flex items-center justify-center w-10 h-10 bg-blue-100 rounded-lg mr-3 flex-shrink-0">
                  <Hash className="h-5 w-5 text-blue-600" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-gray-900 truncate">
                    {selectedGroup.display_name}
                  </h2>
                  {selectedGroup.description && (
                    <p className="text-sm text-gray-500 truncate">{selectedGroup.description}</p>
                  )}
                </div>
              </div>

              {/* Messages Area */}
              <div className="relative flex-1 min-h-0">
                <div
                  ref={listRef}
                  onScroll={handleScroll}
                  onLoadCapture={() => { if (stickToBottomRef.current) scrollToBottom('auto'); }}
                  className="absolute inset-0 overflow-y-auto p-4 space-y-4 bg-gray-50"
                >
                  {isMessagesLoading ? (
                    <div className="flex justify-center py-8">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                    </div>
                  ) : messagesError ? (
                    <div className="text-center text-red-600 py-8">
                      <p>{messagesError}</p>
                      <button onClick={() => loadMessages(selectedGroup.id, true)} className="mt-2 text-sm underline">Try again</button>
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="text-center text-gray-500 py-8">
                      <MessageCircle className="h-12 w-12 mx-auto text-gray-300 mb-4" />
                      <p>No messages yet</p>
                      <p className="text-sm mt-2">Start the conversation!</p>
                    </div>
                  ) : (
                    messages.map((message) => {
                      const mine = message.sender_id === me?.id;
                      if (message.message_type === 'system') {
                        return (
                          <p key={message.id} className="text-center text-xs text-gray-500">{message.content}</p>
                        );
                      }
                      return (
                        <div key={message.id} className="flex space-x-3">
                          <div className="flex-shrink-0">
                            {message.sender_avatar_url ? (
                              <img
                                src={message.sender_avatar_url}
                                alt={message.sender_name}
                                className="w-8 h-8 rounded-full object-cover"
                              />
                            ) : (
                              <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center">
                                <User className="h-4 w-4 text-gray-600" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className={`rounded-lg p-3 shadow-sm ${mine ? 'bg-blue-50' : 'bg-white'}`}>
                              <div className="flex items-center space-x-2 mb-1">
                                <span className="text-sm font-medium text-gray-900">
                                  {message.sender_name}
                                </span>
                                <span className="text-xs text-gray-500" title={new Date(message.created_at).toLocaleString()}>
                                  {formatWhen(message.created_at)}
                                  {message.is_edited ? ' · edited' : ''}
                                </span>
                              </div>
                              {message.reply_to_content && (
                                <div className="bg-gray-100 border-l-2 border-gray-300 pl-3 py-2 mb-2 text-sm text-gray-600">
                                  <p className="font-medium">{message.reply_to_sender_name}:</p>
                                  <p className="truncate">{message.reply_to_content}</p>
                                </div>
                              )}
                              <ForumContent
                                content={message.content_html || message.content}
                                className="prose prose-sm max-w-none"
                              />
                              <div className="flex items-center space-x-1 mt-2 -mb-1">
                                <button
                                  onClick={() => likeMessage(message.id)}
                                  className={`flex items-center space-x-1 text-xs px-2 py-1 rounded-full transition-colors ${
                                    message.user_liked
                                      ? 'text-red-500 bg-red-50 hover:bg-red-100'
                                      : 'text-gray-400 hover:text-red-400 hover:bg-gray-100'
                                  }`}
                                  title={message.user_liked ? 'Unlike' : 'Like'}
                                >
                                  <Heart className={`h-3.5 w-3.5 ${message.user_liked ? 'fill-current' : ''}`} />
                                  {(message.total_likes || 0) > 0 && (
                                    <span>{message.total_likes}</span>
                                  )}
                                </button>
                                <button
                                  onClick={() => startReply(message)}
                                  className="flex items-center space-x-1 text-xs px-2 py-1 rounded-full text-gray-400 hover:text-blue-500 hover:bg-gray-100 transition-colors"
                                  title="Reply"
                                >
                                  <Reply className="h-3.5 w-3.5" />
                                  <span>Reply</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {newBelow && (
                  <button
                    type="button"
                    onClick={() => scrollToBottom('smooth')}
                    className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center space-x-1 bg-blue-600 text-white text-xs px-3 py-1.5 rounded-full shadow hover:bg-blue-700"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                    <span>New messages</span>
                  </button>
                )}
              </div>

              {/* Composer */}
              <div className="p-3 border-t border-gray-200 bg-white">
                {replyTo && (
                  <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-md px-3 py-2 mb-2 text-sm text-gray-600">
                    <p className="truncate">
                      <span className="font-medium text-gray-800">Replying to {replyTo.sender_name}:</span> {replyTo.content}
                    </p>
                    <button type="button" onClick={() => setReplyTo(null)} className="ml-2 text-gray-400 hover:text-gray-600" title="Cancel reply">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
                <form onSubmit={(e) => { e.preventDefault(); send(); }}>
                  <div className="flex items-end space-x-2">
                    <div className="relative flex-1">
                      <textarea
                        ref={textareaRef}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onPaste={handlePaste}
                        rows={2}
                        maxLength={MAX_MESSAGE_LENGTH}
                        placeholder={`Message ${selectedGroup.display_name}… (Enter to send, Shift+Enter for a new line, paste images to upload)`}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm resize-none"
                      />
                      {isUploading && (
                        <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center rounded-md">
                          <div className="flex items-center space-x-2 text-blue-600">
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                            <span className="text-sm">Uploading image...</span>
                          </div>
                        </div>
                      )}
                    </div>
                    <button
                      type="submit"
                      disabled={isSending || isUploading || !draft.trim()}
                      className="h-10 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                    >
                      <Send className="h-4 w-4" />
                      <span>{isSending ? 'Sending…' : 'Send'}</span>
                    </button>
                  </div>
                  <div className="flex items-center justify-between mt-1 text-xs">
                    <span className="text-red-600">{sendError}</span>
                    <span className={draft.length > MAX_MESSAGE_LENGTH * 0.9 ? 'text-orange-600' : 'text-gray-400'}>
                      {draft.length > 0 ? `${draft.length}/${MAX_MESSAGE_LENGTH}` : 'Markdown supported'}
                    </span>
                  </div>
                </form>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-gray-50">
              <div className="text-center px-4">
                <Users className="h-16 w-16 mx-auto text-gray-300 mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  {unknownGroup ? 'Group not found' : 'Select a Group'}
                </h3>
                <p className="text-gray-500">
                  {unknownGroup
                    ? 'You may not be a member of this group, or it was archived.'
                    : 'Choose a group from the list to start chatting'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GroupChatPage;
