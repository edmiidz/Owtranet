import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Send, MessageSquare, ArrowLeft, Heart, Trash2, Reply, X } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { messagesApi, usersApi } from '../utils/api';
import { notifyBadgesChanged } from '../utils/badges';
import ForumContent from '../components/ForumContent';
import { DirectMessage } from '../types';

interface Conversation {
  conversation_id: number;
  updated_at: string;
  other_user_id: number;
  other_user_name: string;
  other_user_github: string | null;
  other_user_avatar: string | null;
  last_message: string | null;
  last_sender_id: number | null;
  last_message_at: string | null;
  unread_count: number;
}

const MessagesPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const { user: currentUser } = useAuthStore();
  
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<number | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [newMessage, setNewMessage] = useState('');
  const [replyTo, setReplyTo] = useState<DirectMessage | null>(null);
  const [sending, setSending] = useState(false);
  // An AI agent answers a DM a few seconds after it is sent; while it writes,
  // show "<Agent> is typing…" and poll the thread until its reply lands.
  const [agentTyping, setAgentTyping] = useState<{ conversationId: number; name: string; sinceCount: number } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [lastMessageCount, setLastMessageCount] = useState<number>(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Initialize conversation if user param is provided
  useEffect(() => {
    const userParam = searchParams.get('user');
    if (userParam) {
      initializeConversationWithUser(userParam);
    } else {
      loadConversations();
    }
  }, [searchParams]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Initialize audio for notifications
  useEffect(() => {
    // Create a simple notification sound using Web Audio API
    const createNotificationSound = () => {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
      oscillator.frequency.setValueAtTime(600, audioContext.currentTime + 0.1);
      
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.3);
    };
    
    audioRef.current = { play: createNotificationSound } as any;
  }, []);

  // Check for new messages and play notification sound
  useEffect(() => {
    if (messages.length > lastMessageCount && lastMessageCount > 0) {
      // New message arrived - check if page is not visible
      if (document.hidden || !document.hasFocus()) {
        try {
          audioRef.current?.play();
        } catch (error) {
          console.log('Audio notification failed:', error);
        }
      }
    }
    setLastMessageCount(messages.length);
  }, [messages, lastMessageCount]);

  // Poll for new messages when page is not visible
  useEffect(() => {
    if (!selectedConversation || selectedConversation === -1) return;
    
    const pollInterval = setInterval(() => {
      if (document.hidden) {
        loadMessages(selectedConversation);
      }
    }, 5000); // Check every 5 seconds when page is hidden
    
    return () => clearInterval(pollInterval);
  }, [selectedConversation]);

  useEffect(() => {
    if (!agentTyping) return;
    const startedAt = Date.now();
    const poll = setInterval(async () => {
      try {
        const data = await messagesApi.getMessages(agentTyping.conversationId);
        if (selectedConversation === agentTyping.conversationId) setMessages(data);
        if (data.length > agentTyping.sinceCount || Date.now() - startedAt > 120000) {
          setAgentTyping(null);
          if (selectedConversation === agentTyping.conversationId) {
            await messagesApi.markAsRead(agentTyping.conversationId);
            notifyBadgesChanged();
          }
        }
      } catch {
        setAgentTyping(null);
      }
    }, 3000);
    return () => clearInterval(poll);
  }, [agentTyping, selectedConversation]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadConversations = async (): Promise<Conversation[]> => {
    try {
      setIsLoading(true);
      const convData = await messagesApi.getConversations();
      setConversations(convData);
      return convData;
    } catch (err: any) {
      setError('Failed to load conversations');
      return [];
    } finally {
      setIsLoading(false);
    }
  };

  const initializeConversationWithUser = async (githubUsername: string) => {
    try {
      setIsLoading(true);
      
      // Get user by github username
      const userData = await usersApi.getUser(githubUsername);
      
      if (!userData) {
        setError('User not found');
        return;
      }

      // Load existing conversations (use the returned list — state is stale here)
      const convList = await loadConversations();
      
      // Check if conversation already exists (the param may be a username or "id:123")
      const existingConv = convList.find(c => c.other_user_id === userData.id);
      
      if (existingConv) {
        setSelectedConversation(existingConv.conversation_id);
        loadMessages(existingConv.conversation_id);
      } else {
        // Create a virtual conversation for new chat
        const virtualConv: Conversation = {
          conversation_id: -1, // Use -1 to indicate new conversation
          updated_at: new Date().toISOString(),
          other_user_id: userData.id,
          other_user_name: userData.name,
          other_user_github: userData.github_username || null,
          other_user_avatar: userData.avatar_url || null,
          last_message: null,
          last_sender_id: null,
          last_message_at: null,
          unread_count: 0
        };
        
        setConversations(prev => [virtualConv, ...prev]);
        setSelectedConversation(-1);
        setMessages([]);
      }
    } catch (err: any) {
      setError('Failed to initialize conversation');
    } finally {
      setIsLoading(false);
    }
  };

  const loadMessages = async (conversationId: number) => {
    if (conversationId === -1) {
      setMessages([]);
      return;
    }
    
    try {
      const messagesData = await messagesApi.getMessages(conversationId);
      setMessages(messagesData);
      
      // Mark messages as read and let the sidebar badge know
      await messagesApi.markAsRead(conversationId);
      notifyBadgesChanged();
    } catch (err: any) {
      setError('Failed to load messages');
    }
  };

  // Upload a pasted image and splice the resulting markdown into the draft at
  // the cursor — same flow as the forum composer and group chat.
  const uploadImage = async (file: File) => {
    try {
      setIsUploading(true);
      setError('');

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
      const start = textarea?.selectionStart ?? newMessage.length;
      const end = textarea?.selectionEnd ?? newMessage.length;
      const next = newMessage.substring(0, start) + data.markdown + newMessage.substring(end);
      setNewMessage(next);
      setTimeout(() => {
        textarea?.focus();
        textarea?.setSelectionRange(start + data.markdown.length, start + data.markdown.length);
      }, 0);
    } catch (err) {
      console.error('Image upload error:', err);
      setError('Failed to upload image. Please try again.');
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

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newMessage.trim() || !selectedConversation) return;
    
    const targetConversation = conversations.find(c => 
      c.conversation_id === selectedConversation || 
      (selectedConversation === -1 && c.conversation_id === -1)
    );
    
    if (!targetConversation) return;

    try {
      setSending(true);
      
      const response = await messagesApi.sendMessage({
        recipient_id: targetConversation.other_user_id,
        content: newMessage.trim(),
        reply_to_id: replyTo?.id
      });

      // If this was a new conversation (id = -1), update with real conversation ID
      if (selectedConversation === -1) {
        setSelectedConversation(response.conversation_id);
        // Reload conversations to get the new one
        await loadConversations();
      }
      
      // Add message to current view
      setMessages(prev => {
        const next = [...prev, response.data];
        if (response.agent_replying) {
          setAgentTyping({ conversationId: response.conversation_id, name: targetConversation.other_user_name, sinceCount: next.length });
        }
        return next;
      });
      setNewMessage('');
      setReplyTo(null);

    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const startReply = (message: DirectMessage) => {
    setReplyTo(message);
    textareaRef.current?.focus();
  };

  const selectConversation = (conversation: Conversation) => {
    setSelectedConversation(conversation.conversation_id);
    setReplyTo(null);
    if (conversation.conversation_id !== -1) {
      loadMessages(conversation.conversation_id);
    } else {
      setMessages([]);
    }
  };

  const formatMessageTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    
    if (diffInSeconds < 60) return 'Just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    return date.toLocaleDateString();
  };

  const likeMessage = async (messageId: number) => {
    try {
      const response = await fetch(`/api/messages/${messageId}/like`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();

        // Update the specific message in the messages array
        setMessages(prev => prev.map(msg =>
          msg.id === messageId
            ? { ...msg, total_likes: data.total_likes, user_vote: data.user_vote }
            : msg
        ));
      }
    } catch (error) {
      console.error('Failed to like message:', error);
    }
  };

  const deleteMessage = async (messageId: number) => {
    if (!confirm('Are you sure you want to delete this message? It will show as "Deleted" to all participants.')) {
      return;
    }

    try {
      const response = await fetch(`/api/messages/${messageId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('owtranet-token')}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        // Update the message to show as deleted
        setMessages(prev => prev.map(msg =>
          msg.id === messageId
            ? { ...msg, deleted_at: new Date().toISOString(), deleted_by: currentUser?.id || null }
            : msg
        ));
      } else {
        const data = await response.json();
        setError(data.error || 'Failed to delete message');
        setTimeout(() => setError(''), 3000);
      }
    } catch (error) {
      console.error('Failed to delete message:', error);
      setError('Failed to delete message');
      setTimeout(() => setError(''), 3000);
    }
  };

  const selectedConvData = conversations.find(c => c.conversation_id === selectedConversation);

  return (
    <div className="h-[calc(100vh-6rem)] flex">
      {/* Conversations Sidebar */}
      <div className="w-80 border-r border-gray-200 bg-white flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center">
            <MessageSquare className="h-5 w-5 mr-2" />
            Messages
          </h2>
        </div>
        
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-center text-gray-500">Loading conversations...</div>
          ) : conversations.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 text-gray-400" />
              <p>No conversations yet</p>
              <p className="text-sm">Visit a user's profile to start messaging</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {conversations.map((conversation) => (
                <button
                  key={conversation.conversation_id}
                  onClick={() => selectConversation(conversation)}
                  className={`w-full p-4 text-left hover:bg-gray-50 transition-colors ${
                    selectedConversation === conversation.conversation_id ? 'bg-blue-50 border-r-2 border-blue-500' : ''
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <div className="relative">
                      <img
                        src={conversation.other_user_avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(conversation.other_user_name)}&background=random`}
                        alt={conversation.other_user_name}
                        className="w-10 h-10 rounded-full"
                      />
                      {conversation.unread_count > 0 && (
                        <div className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                          {conversation.unread_count > 9 ? '9+' : conversation.unread_count}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">
                        {conversation.other_user_name}
                      </p>
                      <p className="text-sm text-gray-500 truncate">
                        {conversation.last_message || 'Start a conversation...'}
                      </p>
                    </div>
                    {conversation.last_message_at && (
                      <div className="text-xs text-gray-400">
                        {formatMessageTime(conversation.last_message_at)}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col bg-gray-50">
        {selectedConversation && selectedConvData ? (
          <>
            {/* Chat Header */}
            <div className="bg-white border-b border-gray-200 p-4">
              <div className="flex items-center">
                <button
                  onClick={() => setSelectedConversation(null)}
                  className="lg:hidden mr-3 text-gray-500 hover:text-gray-700"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <img
                  src={selectedConvData.other_user_avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(selectedConvData.other_user_name)}&background=random`}
                  alt={selectedConvData.other_user_name}
                  className="w-8 h-8 rounded-full mr-3"
                />
                <div>
                  <h3 className="font-medium text-gray-900">{selectedConvData.other_user_name}</h3>
                  {selectedConvData.other_user_github && (
                    <p className="text-sm text-gray-500">@{selectedConvData.other_user_github}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.sender_id === currentUser?.id ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`${
                    // Give messages carrying a pasted image more room than a
                    // text bubble, otherwise screenshots render postage-stamp sized.
                    /!\[[^\]]*\]\(|<img/i.test(message.content || '')
                      ? 'max-w-[85%] lg:max-w-lg'
                      : 'max-w-xs lg:max-w-md'
                  } px-4 py-2 rounded-lg ${
                    message.deleted_at
                      ? 'bg-gray-100 border border-gray-300'
                      : message.sender_id === currentUser?.id
                        ? 'bg-blue-500 text-white'
                        : 'bg-white border border-gray-200'
                  }`}>
                    {message.deleted_at ? (
                      <p className="text-gray-500 italic text-sm">
                        Deleted
                      </p>
                    ) : (
                      <>
                        {message.reply_to_content && (
                          <div className={`border-l-2 pl-3 py-2 mb-2 text-sm rounded-r ${
                            message.sender_id === currentUser?.id
                              ? 'bg-blue-400 bg-opacity-40 border-blue-200 text-blue-50'
                              : 'bg-gray-100 border-gray-300 text-gray-600'
                          }`}>
                            <p className="font-medium">{message.reply_to_sender_name}:</p>
                            <p className="truncate">{message.reply_to_content}</p>
                          </div>
                        )}
                        <ForumContent
                          content={message.content_html || message.content}
                          className={message.sender_id === currentUser?.id ? 'text-white' : 'text-gray-900'}
                        />
                      </>
                    )}
                    <div className={`flex items-center justify-between mt-1 ${
                      message.deleted_at
                        ? 'text-gray-400'
                        : message.sender_id === currentUser?.id ? 'text-blue-100' : 'text-gray-500'
                    }`}>
                      <p className="text-xs">
                        {formatMessageTime(message.created_at)}
                      </p>

                      {/* Action buttons */}
                      {!message.deleted_at && (
                        <div className="flex items-center space-x-2">
                          {/* Like button */}
                          <div className="flex items-center space-x-1">
                            <button
                              onClick={() => likeMessage(message.id)}
                              className={`p-1 rounded hover:bg-opacity-80 transition-colors ${
                                message.user_vote === 1
                                  ? 'text-red-500 hover:text-red-600'
                                  : message.sender_id === currentUser?.id
                                    ? 'text-blue-200 hover:text-red-300'
                                    : 'text-gray-400 hover:text-red-500'
                              }`}
                              title={message.user_vote === 1 ? 'Unlike' : 'Like'}
                            >
                              <Heart
                                className={`h-3 w-3 ${message.user_vote === 1 ? 'fill-current' : ''}`}
                              />
                            </button>
                            {(message.total_likes || 0) > 0 && (
                              <span className="text-xs">
                                {message.total_likes}
                              </span>
                            )}
                          </div>

                          {/* Reply button */}
                          <button
                            onClick={() => startReply(message)}
                            className={`p-1 rounded hover:bg-opacity-80 transition-colors ${
                              message.sender_id === currentUser?.id
                                ? 'text-blue-200 hover:text-white'
                                : 'text-gray-400 hover:text-blue-500'
                            }`}
                            title="Reply"
                          >
                            <Reply className="h-3 w-3" />
                          </button>

                          {/* Delete button (only for own messages) */}
                          {message.sender_id === currentUser?.id && (
                            <button
                              onClick={() => deleteMessage(message.id)}
                              className={`p-1 rounded hover:bg-opacity-80 transition-colors ${
                                message.sender_id === currentUser?.id
                                  ? 'text-blue-200 hover:text-red-300'
                                  : 'text-gray-400 hover:text-red-500'
                              }`}
                              title="Delete message"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {agentTyping && agentTyping.conversationId === selectedConversation && (
                <div className="flex items-center gap-2 text-sm text-violet-700 italic px-2">
                  <span className="inline-flex gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-violet-500 animate-bounce" />
                    <span className="h-1.5 w-1.5 rounded-full bg-violet-500 animate-bounce [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-violet-500 animate-bounce [animation-delay:300ms]" />
                  </span>
                  {agentTyping.name} is typing…
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            <div className="bg-white border-t border-gray-200 p-4">
              {replyTo && (
                <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-2 text-sm text-gray-600">
                  <p className="truncate">
                    <span className="font-medium text-gray-800">
                      Replying to {replyTo.sender_id === currentUser?.id ? 'yourself' : replyTo.sender_name}:
                    </span>{' '}
                    {replyTo.content}
                  </p>
                  <button
                    type="button"
                    onClick={() => setReplyTo(null)}
                    className="ml-2 text-gray-400 hover:text-gray-600 flex-shrink-0"
                    title="Cancel reply"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
              <form onSubmit={sendMessage} className="flex space-x-3 items-end">
                <div className="relative flex-1">
                  <textarea
                    ref={textareaRef}
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onPaste={handlePaste}
                    placeholder={`Message ${selectedConvData.other_user_name}... (paste images to upload)`}
                    className="w-full rounded-lg border border-gray-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-sm leading-relaxed"
                    disabled={sending}
                    rows={Math.min(Math.max(newMessage.split('\n').length, 1), 4)}
                    style={{ maxHeight: '120px', minHeight: '48px' }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage(e);
                      } else if (e.key === 'Escape' && replyTo) {
                        setReplyTo(null);
                      }
                    }}
                  />
                  {isUploading && (
                    <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center rounded-lg">
                      <div className="flex items-center space-x-2 text-blue-600">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                        <span className="text-sm">Uploading image...</span>
                      </div>
                    </div>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={!newMessage.trim() || sending || isUploading}
                  className="bg-blue-500 text-white px-4 py-3 rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </div>
          </>
        ) : (
          /* No Conversation Selected */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <MessageSquare className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Select a Conversation</h3>
              <p className="text-gray-500">Choose a conversation from the sidebar to start messaging</p>
            </div>
          </div>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="fixed bottom-4 right-4 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg">
          {error}
        </div>
      )}
    </div>
  );
};

export default MessagesPage;