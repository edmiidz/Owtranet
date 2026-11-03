import React, { useState, useEffect, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Globe, Users, Lock, Tag, X, Paperclip, FileIcon, Download, Pencil } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { usersApi, postsApi } from '../utils/api';
import { toggleQuote, isLineSelection } from '../utils/markdownQuote';

const EditPostPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user: currentUser } = useAuthStore();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [originalPost, setOriginalPost] = useState<any>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<number[]>([]);
  const [editorUsers, setEditorUsers] = useState<number[]>([]);
  const [visibility, setVisibility] = useState<'all_members' | 'specific_members' | 'author_only'>('all_members');
  const [isUploading, setIsUploading] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<any[]>([]);
  const [newTag, setNewTag] = useState('');
  const [attachment, setAttachment] = useState<{
    filename: string;
    originalName: string;
    mimeType: string;
    size: number;
    url: string;
  } | null>(null);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [removeCurrentAttachment, setRemoveCurrentAttachment] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load users for visibility selection and tags
  useEffect(() => {
    const loadUsersAndTags = async () => {
      try {
        // Load users
        const userData = await usersApi.getUsers();
        setUsers(userData.filter((user: any) => user.role !== 'deactivated'));

        // Load available tags
        const token = localStorage.getItem('owtranet-token');
        const tagsResponse = await fetch('/api/tags', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        const tagsData = await tagsResponse.json();
        setAvailableTags(tagsData.tags || []);
      } catch (err) {
        console.error('Failed to load users or tags:', err);
      }
    };

    loadUsersAndTags();
  }, []);

  // Only the author (or an admin) controls who can see and who can edit the post
  const isOwner = !!currentUser && !!originalPost &&
    (originalPost.user_id === currentUser.id || currentUser.role === 'admin');

  // Load post data
  useEffect(() => {
    const loadData = async () => {
      try {
        const post = await postsApi.getPost(slug!);
        setOriginalPost(post);
        setTitle(post.title || '');
        setContent(post.content || '');

        // Load post's current tags
        if (post.tags && Array.isArray(post.tags)) {
          setTags(post.tags.map((t: any) => t.name));
        }

        // Set visibility state based on post data
        if (post.visibility) {
          setVisibility(post.visibility);
          if (post.visibility === 'specific_members' && post.visible_to_users) {
            setSelectedUsers(post.visible_to_users);
          }
        }

        if (Array.isArray(post.editor_users)) {
          setEditorUsers(post.editor_users);
        }

        // Set attachment if present
        if (post.attachment_filename) {
          setAttachment({
            filename: post.attachment_filename,
            originalName: post.attachment_original_name || 'Attachment',
            mimeType: post.attachment_mime_type || 'application/octet-stream',
            size: post.attachment_size || 0,
            url: `/uploads/forum-attachments/${post.attachment_filename}`
          });
        }
        
        setError('');
      } catch (err: any) {
        console.error('Failed to load post:', err);
        setError(err.response?.data?.error || 'Failed to load post');
      }
      
      setIsLoading(false);
    };

    if (slug) {
      loadData();
    } else {
      setError('No post specified');
      setIsLoading(false);
    }
  }, [slug]);

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

      // If there was an old attachment, delete it
      if (attachment && !removeCurrentAttachment) {
        try {
          await fetch(`/api/posts/attachment/${attachment.filename}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });
        } catch (err) {
          console.error('Failed to delete old attachment:', err);
        }
      }

      setAttachment({
        filename: data.filename,
        originalName: data.originalName,
        mimeType: data.mimeType,
        size: data.size,
        url: data.url
      });
      setRemoveCurrentAttachment(false);

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
      // Only delete if it's a new upload (not the original attachment)
      if (!originalPost?.attachment_filename || attachment.filename !== originalPost.attachment_filename) {
        const token = localStorage.getItem('owtranet-token');
        await fetch(`/api/posts/attachment/${attachment.filename}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });
      } else {
        // Mark for removal when saving
        setRemoveCurrentAttachment(true);
      }

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
      const textarea = textareaRef.current;
      if (textarea) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const newContent = content.substring(0, start) + data.markdown + content.substring(end);
        setContent(newContent);
        
        // Set cursor position after the inserted markdown
        setTimeout(() => {
          textarea.focus();
          textarea.setSelectionRange(start + data.markdown.length, start + data.markdown.length);
        }, 0);
      }

    } catch (err: any) {
      setError('Failed to upload image. Please try again.');
      console.error('Image upload error:', err);
    } finally {
      setIsUploading(false);
    }
  };

  const insertMarkdown = (before: string, after: string = '', placeholder: string = '') => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = textarea.value.substring(start, end);
    const replacement = selectedText || placeholder;
    
    const newText = textarea.value.substring(0, start) + 
                   before + replacement + after + 
                   textarea.value.substring(end);
    
    setContent(newText);
    
    // Set cursor position
    const newCursorPos = start + before.length + replacement.length;
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  // ⌘/ is context-sensitive: quote whole-line selections, strike through a
  // phrase selected inside a line. See utils/markdownQuote.
  const applyQuote = () => {
    const textarea = textareaRef.current;
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

    switch (e.key.toLowerCase()) {
      case 'b':
        e.preventDefault();
        insertMarkdown('**', '**', 'bold text');
        break;
      case 'i':
        e.preventDefault();
        insertMarkdown('*', '*', 'italic text');
        break;
      case 'k':
        e.preventDefault();
        if (e.shiftKey) {
          insertMarkdown('\n```\n', '\n```\n', 'code block');
        } else {
          insertMarkdown('[', '](url)', 'link text');
        }
        break;
      case 'e':
        e.preventDefault();
        insertMarkdown('`', '`', 'code');
        break;
      case 'l':
        e.preventDefault();
        insertMarkdown('- ', '', 'list item');
        break;
      case '/': {
        e.preventDefault();
        const ta = textareaRef.current;
        if (ta && isLineSelection(ta.value, ta.selectionStart, ta.selectionEnd)) {
          applyQuote();
        } else {
          insertMarkdown('~~', '~~', 'strikethrough');
        }
        break;
      }
      case 's':
        e.preventDefault();
        handleSave();
        break;
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

  const handleSave = async () => {
    if (!originalPost) return;

    setIsSaving(true);
    setError('');
    setSuccess('');

    // Determine if post will have attachment after save
    const willHaveAttachment = (attachment && !removeCurrentAttachment) ||
                               (originalPost.attachment_filename && !removeCurrentAttachment && !attachment);

    // Use attachment filename as title if title is empty
    let finalTitle = title;
    if ((!title || title.trim().length === 0) && attachment && !removeCurrentAttachment) {
      // Remove file extension for title
      finalTitle = attachment.originalName.replace(/\.[^/.]+$/, '');
    } else if ((!title || title.trim().length === 0) && originalPost.attachment_original_name && !removeCurrentAttachment) {
      // Use existing attachment name if no new attachment and title is empty
      finalTitle = originalPost.attachment_original_name.replace(/\.[^/.]+$/, '');
    }

    // Validate content - optional if there's an attachment
    if (!willHaveAttachment && (!content || content.trim().length < 10)) {
      setError('Content must be at least 10 characters when no attachment is provided');
      setIsSaving(false);
      return;
    }

    // Validate specific members selection
    if (visibility === 'specific_members' && selectedUsers.length === 0) {
      setError('Please select at least one member for specific visibility');
      setIsSaving(false);
      return;
    }

    try {
      const token = localStorage.getItem('owtranet-token');

      const response = await fetch(`/api/posts/${originalPost.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: finalTitle.trim(),
          content: content.trim(),
          tags: tags,
          visibility,
          visible_to_users: visibility === 'specific_members' ? selectedUsers : [],
          ...(isOwner ? { editor_users: editorUsers } : {}),
          ...(attachment && !removeCurrentAttachment ? {
            attachment_filename: attachment.filename,
            attachment_original_name: attachment.originalName,
            attachment_mime_type: attachment.mimeType,
            attachment_size: attachment.size
          } : {}),
          ...(removeCurrentAttachment ? { remove_attachment: true } : {})
        })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || 'Failed to update post');
        setIsSaving(false);
        return;
      }

      setSuccess('Post updated successfully!');
      setTimeout(() => {
        navigate(`/forum/post/${originalPost.slug}`);
      }, 1500);
      
    } catch (err) {
      setError('Update may have failed');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading post...</p>
        </div>
      </div>
    );
  }

  if (error && !originalPost) {
    return (
      <div className="space-y-6">
        <div className="flex items-center">
          <Link to="/forum" className="p-2 hover:bg-gray-100 rounded-lg transition-colors mr-3">
            <ArrowLeft className="h-6 w-6" />
          </Link>
        </div>
        <div className="card p-8 text-center">
          <p className="text-red-600 text-lg">{error}</p>
          <Link to="/forum" className="btn btn-secondary mt-4">
            Back to Forum
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center">
        <Link to={`/forum/post/${originalPost?.slug}`} className="p-2 hover:bg-gray-100 rounded-lg transition-colors mr-3">
          <ArrowLeft className="h-6 w-6" />
        </Link>
        <div className="text-sm text-gray-500">
          <Link to="/forum" className="hover:text-primary-600">Forum</Link>
          <span className="mx-2">→</span>
          <Link to={`/forum/post/${originalPost?.slug}`} className="hover:text-primary-600">Post</Link>
          <span className="mx-2">→</span>
          <span>Edit</span>
        </div>
      </div>

      {/* Edit Form */}
      <div className="card p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Edit Post</h1>
        
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
            {error}
          </div>
        )}
        
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-4">
            {success}
          </div>
        )}

        <div className="space-y-6">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Post title"
            />
          </div>

          {/* Content */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Content {!(attachment || (originalPost?.attachment_filename && !removeCurrentAttachment)) && '*'}
            </label>
            <div className="relative">
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onPaste={handlePaste}
                onKeyDown={handleKeyDown}
                rows={15}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                placeholder="Post content (Markdown supported)

⌨️ Keyboard shortcuts: Ctrl+B (bold), Ctrl+I (italic), Ctrl+K (link), Ctrl+E (code), Ctrl+L (list), Ctrl+/ (quote selected lines / strikethrough), Ctrl+S (save)
📷 Paste images from clipboard to upload instantly!"
              />
              {isUploading && (
                <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center">
                  <div className="flex items-center space-x-2 text-blue-600">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                    <span className="text-sm">Uploading image...</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <Tag className="h-4 w-4 inline mr-1" />
              Tags
            </label>

            {/* Current tags */}
            <div className="flex flex-wrap gap-2 mb-3">
              {tags.map((tag, index) => (
                <span
                  key={index}
                  className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-primary-100 text-primary-700 border border-primary-200"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => setTags(tags.filter((_, i) => i !== index))}
                    className="ml-2 text-primary-600 hover:text-primary-800"
                    title="Remove tag"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {tags.length === 0 && (
                <span className="text-sm text-gray-500 italic">No tags added yet</span>
              )}
            </div>

            {/* Add tag */}
            <div className="flex gap-2">
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value && !tags.includes(e.target.value)) {
                    setTags([...tags, e.target.value]);
                  }
                }}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select a tag...</option>
                {availableTags
                  .filter(t => !tags.includes(t.name))
                  .map(tag => (
                    <option key={tag.id} value={tag.name}>
                      {tag.name} ({tag.usage_count} posts)
                    </option>
                  ))}
              </select>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  placeholder="Or create new tag"
                  className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && newTag.trim() && !tags.includes(newTag.trim())) {
                      e.preventDefault();
                      setTags([...tags, newTag.trim()]);
                      setNewTag('');
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (newTag.trim() && !tags.includes(newTag.trim())) {
                      setTags([...tags, newTag.trim()]);
                      setNewTag('');
                    }
                  }}
                  disabled={!newTag.trim() || tags.includes(newTag.trim())}
                  className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Tags help organize posts and make them easier to find. You can select existing tags or create new ones.
            </p>
          </div>

          {/* Post Visibility Settings */}
          {isOwner && (
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
                              {user.avatar_url ? (
                                <img
                                  src={user.avatar_url}
                                  alt={user.name}
                                  className="h-6 w-6 rounded-full mr-2"
                                />
                              ) : (
                                <div className="h-6 w-6 rounded-full bg-gray-300 flex items-center justify-center mr-2">
                                  <span className="text-xs font-medium text-gray-600">
                                    {user.name?.charAt(0)}
                                  </span>
                                </div>
                              )}
                              <span className="text-sm font-medium text-gray-900">{user.name}</span>
                              {(user.intranet_username || user.github_username) && (
                                <span className="text-sm text-gray-500 ml-2">(@{user.intranet_username || user.github_username})</span>
                              )}
                            </div>
                          </label>
                        ))}
                      </div>
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
          )}

          {/* Co-Editors (author/admin only) */}
          {isOwner && (
          <div className="card p-6">
            <label className="block text-lg font-medium text-gray-900 mb-2">
              <Pencil className="inline h-5 w-5 mr-2 text-purple-500" />
              Editors
            </label>
            <p className="text-sm text-gray-500 mb-3">
              Members who can edit this post alongside you. Editors cannot delete it or change
              who can see it, and they can always read it regardless of the visibility setting above.
            </p>

            <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-3 bg-gray-50">
              {users.filter((user) => user.id !== originalPost?.user_id).map((user) => (
                <label key={user.id} className="flex items-center py-2 hover:bg-gray-100 rounded px-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editorUsers.includes(user.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setEditorUsers([...editorUsers, user.id]);
                      } else {
                        setEditorUsers(editorUsers.filter(id => id !== user.id));
                      }
                    }}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <div className="ml-3 flex items-center">
                    {user.avatar_url ? (
                      <img src={user.avatar_url} alt={user.name} className="h-6 w-6 rounded-full mr-2" />
                    ) : (
                      <div className="h-6 w-6 rounded-full bg-gray-300 flex items-center justify-center mr-2">
                        <span className="text-xs font-medium text-gray-600">{user.name?.charAt(0)}</span>
                      </div>
                    )}
                    <span className="text-sm font-medium text-gray-900">{user.name}</span>
                    {(user.intranet_username || user.github_username) && (
                      <span className="text-sm text-gray-500 ml-2">(@{user.intranet_username || user.github_username})</span>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>
          )}


          {/* File Attachment */}
          <div className="card p-6">
            <label className="block text-lg font-medium text-gray-900 mb-4">
              <Paperclip className="inline h-5 w-5 mr-2" />
              File Attachment
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
                <div className="flex items-center space-x-2">
                  <a
                    href={attachment.url}
                    download={attachment.originalName}
                    className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    title="Download attachment"
                  >
                    <Download className="h-5 w-5" />
                  </a>
                  <button
                    type="button"
                    onClick={removeAttachment}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Remove attachment"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
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
            {removeCurrentAttachment && originalPost?.attachment_filename && (
              <p className="mt-2 text-sm text-orange-600">
                Original attachment will be removed when you save.
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-between">
            <Link 
              to={`/forum/post/${originalPost?.slug}`} 
              className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
            >
              Cancel
            </Link>
            <button
              onClick={handleSave}
              disabled={
                isSaving ||
                (!content.trim() && !attachment && (!originalPost?.attachment_filename || removeCurrentAttachment))
              }
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center"
            >
              {isSaving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditPostPage;