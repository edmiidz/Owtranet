import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  Send,
  Eye,
  Info,
  Bold,
  Italic,
  Link2,
  Code,
  List,
  AtSign,
  Users,
  Lock,
  Globe,
  Paperclip,
  X,
  FileIcon
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useBrandingStore } from '../stores/brandingStore';
import { postsApi, usersApi } from '../utils/api';
import { toggleQuote, isLineSelection } from '../utils/markdownQuote';
import MentionDropdown from '../components/MentionDropdown';

const CreatePostPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [previewMode, setPreviewMode] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<number[]>([]);
  const [visibility, setVisibility] = useState<'all_members' | 'specific_members' | 'author_only'>('all_members');
  const [isUploading, setIsUploading] = useState(false);
  // Support prefilled title from wiki links
  const prefillTitle = (location.state as { prefillTitle?: string } | null)?.prefillTitle || '';
  const [title, setTitle] = useState(prefillTitle);
  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');
  const [attachment, setAttachment] = useState<{
    filename: string;
    originalName: string;
    mimeType: string;
    size: number;
    url: string;
  } | null>(null);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load users for visibility selection
  useEffect(() => {
    const loadUsers = async () => {
      try {
        const userData = await usersApi.getUsers();
        setUsers(userData.filter((user: any) => user.role !== 'deactivated'));
      } catch (err) {
        console.error('Failed to load users:', err);
      }
    };
    loadUsers();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setError('');
      setIsLoading(true);

      // Use attachment filename as title if title is empty
      let finalTitle = title;
      if ((!title || title.trim().length === 0) && attachment) {
        // Remove file extension for title
        finalTitle = attachment.originalName.replace(/\.[^/.]+$/, '');
      }

      // Manual validation - content is optional if there's an attachment
      if (!attachment && (!content || content.trim().length < 10)) {
        setError('Content must be at least 10 characters when no attachment is provided');
        setIsLoading(false);
        return;
      }

      // Title validation - now checking finalTitle
      if (!finalTitle || finalTitle.trim().length < 5) {
        setError('Title must be at least 5 characters');
        setIsLoading(false);
        return;
      }

      // Validate specific members selection
      if (visibility === 'specific_members' && selectedUsers.length === 0) {
        setError('Please select at least one member for specific visibility');
        setIsLoading(false);
        return;
      }

      // Parse tags
      const parsedTags = tags 
        ? tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0)
        : [];

      const postData: any = {
        title: finalTitle.trim(),
        content: content.trim(),
        tags: parsedTags,
        visibility,
        visible_to_users: visibility === 'specific_members' ? selectedUsers : []
      };

      // Add attachment info if present
      if (attachment) {
        postData.attachment_filename = attachment.filename;
        postData.attachment_original_name = attachment.originalName;
        postData.attachment_mime_type = attachment.mimeType;
        postData.attachment_size = attachment.size;
      }

      const response = await postsApi.createPost(postData);

      // Agents tagged in the post are answering; PostPage shows that and polls.
      navigate(`/forum/post/${response.slug}`, { state: { agentsSummoned: response.agentsSummoned } });
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create post. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const insertMarkdown = (before: string, after: string = '', placeholder: string = '') => {
    const textarea = textareaRef.current || document.getElementById('content') as HTMLTextAreaElement;
    console.log('insertMarkdown called:', { before, after, placeholder, textareaFound: !!textarea });
    
    if (!textarea) {
      console.error('Textarea not found!');
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = textarea.value.substring(start, end);
    const replacement = selectedText || placeholder;
    
    console.log('Selection info:', { start, end, selectedText, replacement });
    
    const newText = textarea.value.substring(0, start) + 
                   before + replacement + after + 
                   textarea.value.substring(end);
    
    console.log('Setting new text:', newText.length, 'characters');
    
    // Update state first, then DOM
    setContent(newText);
    
    // Set cursor position
    const newCursorPos = start + before.length + replacement.length;
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  const uploadAttachment = async (file: File) => {
    try {
      setAttachmentUploading(true);
      setError('');

      const formData = new FormData();
      formData.append('attachment', file);

      const token = localStorage.getItem('owtranet-token');
      const response = await fetch('/api/posts/attachment', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const data = await response.json();
      setAttachment({
        filename: data.filename,
        originalName: data.originalName,
        mimeType: data.mimeType,
        size: data.size,
        url: data.url
      });

      // Auto-populate title if it's empty
      if (!title || title.trim().length === 0) {
        const fileNameWithoutExt = data.originalName.replace(/\.[^/.]+$/, '');
        setTitle(fileNameWithoutExt);
      }

    } catch (err: any) {
      setError('Failed to upload attachment. Please try again.');
      console.error('Attachment upload error:', err);
    } finally {
      setAttachmentUploading(false);
    }
  };

  const removeAttachment = async () => {
    if (!attachment) return;

    try {
      const token = localStorage.getItem('owtranet-token');
      await fetch(`/api/posts/attachment/${attachment.filename}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      setAttachment(null);
    } catch (err) {
      console.error('Failed to delete attachment:', err);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const uploadImage = async (file: File) => {
    try {
      setIsUploading(true);
      setError('');

      const formData = new FormData();
      formData.append('image', file);

      const token = localStorage.getItem('owtranet-token');
      const response = await fetch('/api/upload/image', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const data = await response.json();
      
      // Insert markdown at current cursor position
      insertMarkdown('', '', data.markdown);

    } catch (err: any) {
      setError('Failed to upload image. Please try again.');
      console.error('Image upload error:', err);
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
        e.preventDefault(); // Prevent default paste behavior
        const file = item.getAsFile();
        if (file) {
          await uploadImage(file);
        }
        break;
      }
    }
  };

  // ⌘/ is context-sensitive: quote whole-line selections, strike through a
  // phrase selected inside a line. See utils/markdownQuote.
  const applyQuote = () => {
    const textarea =
      textareaRef.current || (document.getElementById('content') as HTMLTextAreaElement);
    if (!textarea) return;

    const { value, cursorPos } = toggleQuote(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd
    );
    setContent(value);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(cursorPos, cursorPos);
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
    
    if (!isCtrlOrCmd) return;

    console.log('Key pressed:', e.key, 'Ctrl/Cmd:', isCtrlOrCmd, 'Shift:', e.shiftKey);

    switch (e.key.toLowerCase()) {
      case 'b':
        e.preventDefault();
        console.log('Applying bold formatting');
        insertMarkdown('**', '**', 'bold text');
        break;
      case 'i':
        e.preventDefault();
        console.log('Applying italic formatting');
        insertMarkdown('*', '*', 'italic text');
        break;
      case 'k':
        e.preventDefault();
        if (e.shiftKey) {
          console.log('Applying code block formatting');
          insertMarkdown('\n```\n', '\n```\n', 'code block');
        } else {
          console.log('Applying link formatting');
          insertMarkdown('[', '](url)', 'link text');
        }
        break;
      case 'e':
        e.preventDefault();
        console.log('Applying inline code formatting');
        insertMarkdown('`', '`', 'code');
        break;
      case 'l':
        e.preventDefault();
        console.log('Applying list formatting');
        insertMarkdown('- ', '', 'list item');
        break;
      case '/': {
        e.preventDefault();
        const ta =
          textareaRef.current || (document.getElementById('content') as HTMLTextAreaElement);
        if (ta && isLineSelection(ta.value, ta.selectionStart, ta.selectionEnd)) {
          applyQuote();
        } else {
          insertMarkdown('~~', '~~', 'strikethrough');
        }
        break;
      }
      case 'enter':
        if (!e.shiftKey) {
          e.preventDefault();
          console.log('Submitting form via keyboard shortcut');
          const form = document.querySelector('form');
          if (form) {
            const event = new Event('submit', { bubbles: true, cancelable: true });
            form.dispatchEvent(event);
          }
        }
        break;
    }
  };

  const markdownButtons = [
    { icon: Bold, label: 'Bold', action: () => insertMarkdown('**', '**', 'bold text') },
    { icon: Italic, label: 'Italic', action: () => insertMarkdown('*', '*', 'italic text') },
    { icon: Code, label: 'Code', action: () => insertMarkdown('`', '`', 'code') },
    { icon: Link2, label: 'Link', action: () => insertMarkdown('[', '](url)', 'link text') },
    { icon: List, label: 'List', action: () => insertMarkdown('- ', '', 'list item') },
    { icon: AtSign, label: 'Mention', action: () => insertMarkdown('@', '', 'username') },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <Link 
            to="/forum" 
            className="text-gray-500 hover:text-gray-700 mr-4"
          >
            <ArrowLeft className="h-6 w-6" />
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Create New Post</h1>
            <p className="text-gray-600">Share your knowledge or ask a question</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Form */}
        <div className="lg:col-span-2 space-y-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                {error}
              </div>
            )}

            {/* Title */}
            <div className="card p-6">
              <label htmlFor="title" className="block text-lg font-medium text-gray-900 mb-2">
                Post Title {!attachment && '*'}
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="form-input text-lg"
                placeholder={attachment && !title ? "Leave empty to use filename" : "What's your question or topic?"}
              />
              <p className="mt-2 text-sm text-gray-500">
                {attachment && !title
                  ? `Will use filename: "${attachment.originalName.replace(/\.[^/.]+$/, '')}"`
                  : "Be specific and descriptive to help others understand your post"}
              </p>
            </div>

            {/* Content */}
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <label htmlFor="content" className="text-lg font-medium text-gray-900">
                  Content {!attachment && '*'}
                </label>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => setPreviewMode(!previewMode)}
                    className={`
                      flex items-center px-3 py-1 rounded-lg text-sm transition-colors
                      ${previewMode 
                        ? 'bg-primary-100 text-primary-700' 
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }
                    `}
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    Preview
                  </button>
                </div>
              </div>

              {/* Markdown Toolbar */}
              {!previewMode && (
                <div className="flex flex-wrap gap-1 mb-4 p-2 bg-gray-50 rounded-lg">
                  {markdownButtons.map((button) => {
                    const Icon = button.icon;
                    return (
                      <button
                        key={button.label}
                        type="button"
                        onClick={button.action}
                        className="p-2 hover:bg-gray-200 rounded text-gray-600 hover:text-gray-800"
                        title={button.label}
                      >
                        <Icon className="h-4 w-4" />
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Content Input/Preview */}
              {previewMode ? (
                <div className="min-h-96 p-4 border border-gray-300 rounded-lg bg-gray-50">
                  <div className="prose prose-sm max-w-none">
                    <ReactMarkdown
                      components={{
                        a: ({ href, children }) => {
                          const siteHost = useBrandingStore.getState().baseUrl.replace('https://', '').replace('http://', '');
                          const isExternal = href && !href.startsWith('/') && (!siteHost || !href.includes(siteHost));
                          return (
                            <a 
                              href={href} 
                              target={isExternal ? "_blank" : undefined}
                              rel={isExternal ? "noopener noreferrer" : undefined}
                              className="text-primary-600 hover:text-primary-700"
                            >
                              {children}
                            </a>
                          );
                        },
                      }}
                    >
                      {content || '*Write something to see the preview...*'}
                    </ReactMarkdown>
                  </div>
                </div>
              ) : (
                <div className="relative">
                  <textarea
                    ref={textareaRef}
                    id="content"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    rows={16}
                    className="form-input font-mono text-sm"
                    onPaste={handlePaste}
                    onKeyDown={handleKeyDown}
                    placeholder="Write your post content here...

Markdown formatting & keyboard shortcuts:
**bold** (Ctrl+B) | *italic* (Ctrl+I) | `code` (Ctrl+E) | [link](url) (Ctrl+K)
~~strikethrough~~ / > quote selected lines (Ctrl+/) | - list (Ctrl+L) | ```code block``` (Ctrl+Shift+K)
@username to mention someone | Ctrl+Enter to submit

📷 PASTE IMAGES: Just copy and paste images from your clipboard!

Embed videos:
![YouTube](https://www.youtube.com/watch?v=VIDEO_ID)
![Google Drive](https://drive.google.com/file/d/FILE_ID)"
                  />
                  <MentionDropdown textareaRef={textareaRef} onChange={setContent} />
                  {isUploading && (
                    <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center">
                      <div className="flex items-center space-x-2 text-blue-600">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                        <span className="text-sm">Uploading image...</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Tags */}
            <div className="card p-6">
              <label htmlFor="tags" className="block text-lg font-medium text-gray-900 mb-2">
                Tags (Optional)
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                className="form-input"
                placeholder="e.g., javascript, help, feature-request"
              />
              <p className="mt-2 text-sm text-gray-500">
                Separate multiple tags with commas. Use relevant tags to help others find your post.
              </p>
            </div>

            {/* Post Visibility Settings */}
            <div className="card p-6">
              <label className="block text-lg font-medium text-gray-900 mb-4">
                Post Visibility
              </label>
              
              <div className="space-y-4">
                {/* All Members Option */}
                <div className="flex items-start">
                  <input
                    type="radio"
                    id="visibility-all"
                    name="visibility"
                    value="all_members"
                    checked={visibility === 'all_members'}
                    onChange={(e) => setVisibility(e.target.value as any)}
                    className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                  />
                  <div className="ml-3">
                    <label htmlFor="visibility-all" className="flex items-center text-sm font-medium text-gray-900 cursor-pointer">
                      <Globe className="h-4 w-4 mr-2 text-green-500" />
                      All Intranet Members (Default)
                    </label>
                    <p className="text-sm text-gray-500">Everyone on the intranet can see this post</p>
                  </div>
                </div>

                {/* Specific Members Option */}
                <div className="flex items-start">
                  <input
                    type="radio"
                    id="visibility-specific"
                    name="visibility"
                    value="specific_members"
                    checked={visibility === 'specific_members'}
                    onChange={(e) => setVisibility(e.target.value as any)}
                    className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                  />
                  <div className="ml-3 flex-1">
                    <label htmlFor="visibility-specific" className="flex items-center text-sm font-medium text-gray-900 cursor-pointer">
                      <Users className="h-4 w-4 mr-2 text-blue-500" />
                      Specific Members Only
                    </label>
                    <p className="text-sm text-gray-500 mb-3">Choose individual members who can see this post</p>
                    
                    {visibility === 'specific_members' && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium text-gray-700">Select Members:</p>
                        <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-3 bg-gray-50">
                          {users.map((user) => (
                            <label key={user.id} className="flex items-center py-2 hover:bg-gray-100 rounded px-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selectedUsers.includes(user.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedUsers([...selectedUsers, user.id]);
                                  } else {
                                    setSelectedUsers(selectedUsers.filter(id => id !== user.id));
                                  }
                                }}
                                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                              />
                              <div className="ml-3 flex items-center">
                                <img
                                  src={user.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=random`}
                                  alt={user.name}
                                  className="w-6 h-6 rounded-full mr-2"
                                />
                                <span className="text-sm text-gray-900">{user.name}</span>
                                {(user.intranet_username || user.github_username) && (
                                  <span className="text-xs text-gray-500 ml-2">@{user.intranet_username || user.github_username}</span>
                                )}
                                {user.role === 'admin' && (
                                  <span className="ml-2 px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full">Admin</span>
                                )}
                              </div>
                            </label>
                          ))}
                        </div>
                        {selectedUsers.length > 0 && (
                          <p className="text-sm text-green-600">
                            {selectedUsers.length} member{selectedUsers.length !== 1 ? 's' : ''} selected
                          </p>
                        )}
                        {selectedUsers.length === 0 && (
                          <p className="text-sm text-orange-600">
                            Please select at least one member to share with
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Author Only Option */}
                <div className="flex items-start">
                  <input
                    type="radio"
                    id="visibility-author"
                    name="visibility"
                    value="author_only"
                    checked={visibility === 'author_only'}
                    onChange={(e) => setVisibility(e.target.value as any)}
                    className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                  />
                  <div className="ml-3">
                    <label htmlFor="visibility-author" className="flex items-center text-sm font-medium text-gray-900 cursor-pointer">
                      <Lock className="h-4 w-4 mr-2 text-red-500" />
                      Author Only (Private Draft)
                    </label>
                    <p className="text-sm text-gray-500">Only you can see this post - useful for drafts</p>
                  </div>
                </div>
              </div>
            </div>

            {/* File Attachment */}
            <div className="card p-6">
              <label className="block text-lg font-medium text-gray-900 mb-4">
                <Paperclip className="inline h-5 w-5 mr-2" />
                File Attachment (Optional)
              </label>

              {attachment ? (
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex items-center space-x-3">
                    <FileIcon className="h-8 w-8 text-blue-500" />
                    <div>
                      <p className="font-medium text-sm text-gray-900">{attachment.originalName}</p>
                      <p className="text-xs text-gray-500">{formatFileSize(attachment.size)}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={removeAttachment}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Remove attachment"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              ) : (
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        uploadAttachment(file);
                      }
                    }}
                    className="hidden"
                    accept="*/*"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={attachmentUploading}
                    className="flex items-center px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    {attachmentUploading ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Paperclip className="h-4 w-4 mr-2" />
                        Attach File
                      </>
                    )}
                  </button>
                  <p className="mt-2 text-sm text-gray-500">
                    Attach any file up to 50MB. The attachment will be available for download.
                  </p>
                </div>
              )}
            </div>

            {/* Submit */}
            <div className="card p-6">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  <p>✓ Links will automatically open in new tabs</p>
                  <p>✓ @mentions will notify users</p>
                  <p>✓ Markdown formatting supported</p>
                </div>
                <div className="flex space-x-3">
                  <Link to="/forum" className="btn btn-secondary">
                    Cancel
                  </Link>
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="btn btn-primary"
                  >
                    {isLoading ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                        Posting...
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4 mr-2" />
                        Publish Post
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Writing Tips */}
          <div className="card p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <Info className="h-5 w-5 mr-2" />
              Writing Tips
            </h3>
            <div className="space-y-3 text-sm text-gray-600">
              <div>
                <p className="font-medium text-gray-800">Be Specific</p>
                <p>Use descriptive titles and provide context in your content</p>
              </div>
              <div>
                <p className="font-medium text-gray-800">⌨️ Use Keyboard Shortcuts</p>
                <p>Ctrl+B for <strong>bold</strong>, Ctrl+I for <em>italic</em>, Ctrl+K for links, and more!</p>
              </div>
              <div>
                <p className="font-medium text-gray-800">Use Markdown</p>
                <p>Format your post with **bold**, *italic*, and `code` for clarity</p>
              </div>
              <div>
                <p className="font-medium text-gray-800">Tag Appropriately</p>
                <p>Add relevant tags to help others find and filter your post</p>
              </div>
              <div>
                <p className="font-medium text-gray-800">Mention Team Members</p>
                <p>Use @username to notify specific people about your post</p>
              </div>
              <div>
                <p className="font-medium text-gray-800">📷 Paste Images</p>
                <p>Copy any image and paste directly into the editor - it will upload automatically</p>
              </div>
            </div>
          </div>

          {/* Preview Info */}
          {title && (
            <div className="card p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Post Preview</h3>
              <div className="space-y-2 text-sm">
                <div className="flex items-center">
                  <span className="text-gray-600">Title:</span>
                  <span className="ml-2 font-medium">{title}</span>
                </div>
                <div className="flex items-center">
                  <span className="text-gray-600">Length:</span>
                  <span className="ml-2">{content.length} characters</span>
                </div>
                <div className="flex items-center">
                  <span className="text-gray-600">Estimated read:</span>
                  <span className="ml-2">{Math.max(1, Math.ceil(content.split(' ').length / 200))} min</span>
                </div>
              </div>
            </div>
          )}

          {/* Keyboard Shortcuts & Markdown Guide */}
          <div className="card p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">⌨️ Shortcuts & Markdown</h3>
            <div className="space-y-2 text-xs text-gray-600">
              <div className="flex justify-between items-center">
                <div className="flex items-center space-x-2">
                  <kbd className="px-1 py-0.5 bg-gray-200 rounded text-xs">Ctrl+B</kbd>
                  <code>**bold**</code>
                </div>
                <span className="font-bold">bold</span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center space-x-2">
                  <kbd className="px-1 py-0.5 bg-gray-200 rounded text-xs">Ctrl+I</kbd>
                  <code>*italic*</code>
                </div>
                <span className="italic">italic</span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center space-x-2">
                  <kbd className="px-1 py-0.5 bg-gray-200 rounded text-xs">Ctrl+E</kbd>
                  <code>`code`</code>
                </div>
                <code className="bg-gray-100 px-1 rounded">code</code>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center space-x-2">
                  <kbd className="px-1 py-0.5 bg-gray-200 rounded text-xs">Ctrl+K</kbd>
                  <code>[link](url)</code>
                </div>
                <span className="text-primary-600">link</span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center space-x-2">
                  <kbd className="px-1 py-0.5 bg-gray-200 rounded text-xs">Ctrl+L</kbd>
                  <code>- list</code>
                </div>
                <span>• list</span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center space-x-2">
                  <kbd className="px-1 py-0.5 bg-gray-200 rounded text-xs">Ctrl+/</kbd>
                  <code>~~strike~~</code>
                </div>
                <span className="line-through">strike</span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center space-x-2">
                  <kbd className="px-1 py-0.5 bg-gray-200 rounded text-xs text-[10px]">Ctrl+⇧+K</kbd>
                  <code>```code```</code>
                </div>
                <span className="bg-gray-100 px-1 rounded">block</span>
              </div>
              <div className="flex justify-between">
                <code>@username</code>
                <span className="text-blue-600">@mention</span>
              </div>
              <div className="flex justify-between">
                <code># Heading</code>
                <span className="font-bold text-lg">Heading</span>
              </div>
              <div className="flex justify-between">
                <code>![alt](image.jpg)</code>
                <span className="text-blue-600">📷 image</span>
              </div>
              <div className="pt-2 border-t border-gray-200">
                <div className="flex justify-between items-center mb-2">
                  <kbd className="px-1 py-0.5 bg-green-200 rounded text-xs">Ctrl+↵</kbd>
                  <span className="text-green-600 font-medium">Submit Post</span>
                </div>
                <p className="text-gray-500 text-xs">
                  📷 Images: Copy and paste from your clipboard to upload instantly!
                </p>
                <p className="text-gray-500 mt-1 text-xs">
                  YouTube and Google Drive videos are automatically embedded when you paste their URLs.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreatePostPage;