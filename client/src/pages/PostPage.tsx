import React, { useState, useEffect } from 'react';
import { Link, useParams, useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import ForumContent from '../components/ForumContent';
import MentionDropdown from '../components/MentionDropdown';
import {
  ArrowLeft,
  ThumbsUp,
  MessageCircle,
  Eye,
  Calendar,
  CheckCircle,
  Reply,
  Send,
  Pin,
  Lock,
  Edit3,
  Trash2,
  Heart,
  Users,
  Bold,
  Italic,
  Link2,
  Code,
  List,
  AtSign,
  FileIcon,
  Download,
  Radio,
  Bot
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { postsApi } from '../utils/api';
import { toggleQuote, isLineSelection } from '../utils/markdownQuote';
import { useAuthStore } from '../stores/authStore';
import { useBrandingStore } from '../stores/brandingStore';
import type { Post, SummonedAgent } from '../types';

// Small "AI" pill shown next to an AI agent's name.
const AiBadge: React.FC = () => (
  <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 align-middle" title="AI agent">
    <Bot className="h-3 w-3" /> AI
  </span>
);

const commentSchema = z.object({
  content: z
    .string()
    .min(5, 'Comment must be at least 5 characters')
    .max(2000, 'Comment cannot exceed 2000 characters'),
});

type CommentFormData = z.infer<typeof commentSchema>;

const PostPage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user: currentUser } = useAuthStore();
  const [post, setPost] = useState<Post | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [commentError, setCommentError] = useState<string>('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [editingComment, setEditingComment] = useState<number | null>(null);
  const [editContent, setEditContent] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);
  const commentTextareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const editTextareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  // AI agents tagged in a new comment: their replies arrive a few
  // seconds later, so show who's writing and poll quietly until they land.
  const [pendingAgents, setPendingAgents] = useState<{ agents: SummonedAgent[]; afterId: number } | null>(null);

  const formatFileSize = (bytes: number) => {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const getFileExtension = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    return ext || '';
  };

  const isPreviewableImage = (filename: string) => {
    const ext = getFileExtension(filename);
    return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext);
  };

  const isPDF = (filename: string) => {
    return getFileExtension(filename) === 'pdf';
  };

  const isSVG = (filename: string) => {
    return getFileExtension(filename) === 'svg';
  };

  const isMermaid = (filename: string) => {
    const ext = getFileExtension(filename);
    return ext === 'mermaid' || ext === 'mmd';
  };

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<CommentFormData>({
    resolver: zodResolver(commentSchema),
  });

  useEffect(() => {
    if (slug) {
      loadPost();
    }
  }, [slug]);

  const loadPost = async () => {
    if (!slug) return;
    
    try {
      setIsLoading(true);
      
      // Check if slug is actually a numeric ID (short URL)
      const isNumericId = /^\d+$/.test(slug);
      console.log(`PostPage loadPost: slug="${slug}", isNumericId=${isNumericId}`);
      
      if (isNumericId) {
        // This is a numeric ID, get the post by ID and redirect to slug
        console.log(`Detected numeric ID: ${slug}, fetching post details...`);
        const postData = await postsApi.getPostById(parseInt(slug));
        if (postData.slug) {
          console.log(`Redirecting to slug: ${postData.slug}`);
          navigate(`/forum/post/${postData.slug}`, { replace: true });
          return;
        } else {
          throw new Error('Post found but no slug available');
        }
      } else {
        // This is a slug, load normally
        const postData = await postsApi.getPost(slug);
        setPost(postData);
      }
    } catch (error) {
      console.error('Failed to load post:', error);
      setError('Failed to load post');
    } finally {
      setIsLoading(false);
    }
  };

  const awaitAgentReplies = (agents: SummonedAgent[] | undefined, afterId: number) => {
    if (agents && agents.length > 0) setPendingAgents({ agents, afterId });
  };

  // A brand-new post that tagged agents arrives with them in navigation state.
  const location = useLocation();
  useEffect(() => {
    const summoned = (location.state as { agentsSummoned?: SummonedAgent[] } | null)?.agentsSummoned;
    if (summoned && summoned.length > 0) {
      awaitAgentReplies(summoned, 0);
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pendingAgents || !slug) return;
    const deadline = Date.now() + 120_000;
    const timer = setInterval(async () => {
      try {
        const fresh = await postsApi.getPost(slug);
        const answered = new Set(
          (fresh.comments || [])
            .filter(c => c.author_account_type === 'ai_agent' && c.id > pendingAgents.afterId)
            .map(c => c.author_name)
        );
        const stillWaiting = pendingAgents.agents.filter(a => !answered.has(a.name));
        if (answered.size > 0) setPost(fresh);
        if (stillWaiting.length === 0 || Date.now() > deadline) {
          setPendingAgents(null);
        } else if (stillWaiting.length !== pendingAgents.agents.length) {
          setPendingAgents({ ...pendingAgents, agents: stillWaiting });
        }
      } catch {
        setPendingAgents(null);
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [pendingAgents, slug]);

  const handleVote = async (type: 'post' | 'comment', id: number, value: -1 | 0 | 1) => {
    try {
      await postsApi.like(type, id, value);
      // Reload post to get updated scores
      loadPost();
    } catch (error) {
      console.error('Failed to vote:', error);
    }
  };

  const handleLike = async (commentId: number, isCurrentlyLiked: boolean) => {
    try {
      // Toggle like: if currently liked, unlike (0), else like (1)
      const value = isCurrentlyLiked ? 0 : 1;
      await postsApi.like('comment', commentId, value);
      loadPost();
    } catch (error) {
      console.error('Failed to like comment:', error);
    }
  };

  const handleEditComment = async (commentId: number, content: string) => {
    if (!content.trim() || content.trim().length < 5) {
      alert('Comment must be at least 5 characters');
      return;
    }
    
    try {
      await postsApi.editComment(commentId, content.trim());
      setEditingComment(null);
      setEditContent('');
      loadPost();
    } catch (error: any) {
      console.error('Failed to edit comment:', error);
      alert(error.response?.data?.error || 'Failed to edit comment');
    }
  };

  const handleDeleteComment = async (commentId: number) => {
    if (!window.confirm('Are you sure you want to delete this comment? This action cannot be undone.')) {
      return;
    }
    
    try {
      await postsApi.deleteComment(commentId);
      loadPost();
    } catch (error: any) {
      console.error('Failed to delete comment:', error);
      alert(error.response?.data?.error || 'Failed to delete comment');
    }
  };

  const handleDeletePost = async () => {
    if (!post) return;

    // Confirmation dialog
    const confirmDelete = window.confirm(
      `Are you sure you want to delete this post?\n\n"${post.title}"\n\nThis action cannot be undone and will also delete all comments on this post.`
    );

    if (!confirmDelete) return;

    try {
      const token = localStorage.getItem('owtranet-token');
      
      await fetch(`/api/posts/${post.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      // Since we know the server deployment has issues, treat any response as potential success
      // and let the user verify by checking if the post is gone
      alert('Post deletion requested. Redirecting to forum to verify...');
      navigate('/forum');
      
    } catch (error) {
      console.error('Delete error:', error);
      alert('Delete request sent - check forum to verify if post was removed');
      navigate('/forum');
    }
  };

  const onSubmitComment = async (data: CommentFormData) => {
    if (!post) return;

    try {
      setCommentError('');
      setIsSubmittingComment(true);

      const result = await postsApi.createComment(post.id, {
        content: data.content,
        parentId: replyTo || undefined
      });

      reset();
      setReplyTo(null);
      loadPost(); // Reload to show new comment
      awaitAgentReplies(result.agentsSummoned, result.commentId);
    } catch (err: any) {
      setCommentError(err.response?.data?.error || 'Failed to post comment');
    } finally {
      setIsSubmittingComment(false);
    }
  };

  // Image upload functionality
  const uploadImage = async (file: File) => {
    try {
      setIsUploading(true);
      setCommentError('');

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
      return data.markdown; // Return the markdown for insertion
    } catch (err: any) {
      setCommentError('Failed to upload image. Please try again.');
      console.error('Image upload error:', err);
      return null;
    } finally {
      setIsUploading(false);
    }
  };

  // Grow a textarea to fit its content so long comments aren't edited through a
  // small scrolling window. Capped so a very long comment still leaves the Save
  // and Cancel buttons reachable without scrolling the whole page.
  const MAX_TEXTAREA_HEIGHT = 500;
  const autoGrow = (textarea: HTMLTextAreaElement | null) => {
    if (!textarea) return;
    textarea.style.height = 'auto';
    const next = Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT);
    textarea.style.height = `${next}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > MAX_TEXTAREA_HEIGHT ? 'auto' : 'hidden';
  };

  const insertMarkdown = (
    textarea: HTMLTextAreaElement | null,
    before: string,
    after: string = '',
    placeholder: string = '',
    updateFn?: (value: string) => void
  ) => {
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = textarea.value.substring(start, end);
    const replacement = selectedText || placeholder;

    const newText =
      textarea.value.substring(0, start) +
      before +
      replacement +
      after +
      textarea.value.substring(end);

    // Preserve the scroll position: re-rendering with a new value resets the
    // caret to 0, and focus() then scrolls the box to the top before we can put
    // the caret back. Restoring scrollTop keeps long comments from jumping.
    const previousScrollTop = textarea.scrollTop;

    if (updateFn) {
      updateFn(newText);
    } else {
      textarea.value = newText;
    }

    const newCursorPos = start + before.length + replacement.length;
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorPos, newCursorPos);
      // Resize before restoring scroll: growing the box changes how far it can
      // scroll, so a scrollTop set beforehand would be clamped to a stale max.
      autoGrow(textarea);
      textarea.scrollTop = previousScrollTop;
    }, 0);
  };

  // ⌘/ is context-sensitive: quote whole-line selections, strike through a
  // phrase selected inside a line. See utils/markdownQuote.
  const applyQuote = (
    textarea: HTMLTextAreaElement | null,
    updateFn?: (value: string) => void
  ) => {
    if (!textarea) return;

    const { value, cursorPos } = toggleQuote(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd
    );

    if (updateFn) {
      updateFn(value);
    } else {
      textarea.value = value;
    }

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(cursorPos, cursorPos);
      autoGrow(textarea);
    }, 0);
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    textarea: HTMLTextAreaElement | null,
    updateFn?: (value: string) => void
  ) => {
    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
    if (!isCtrlOrCmd) return;

    switch (e.key.toLowerCase()) {
      case 'b':
        e.preventDefault();
        insertMarkdown(textarea, '**', '**', 'bold text', updateFn);
        break;
      case 'i':
        e.preventDefault();
        insertMarkdown(textarea, '*', '*', 'italic text', updateFn);
        break;
      case 'k':
        e.preventDefault();
        if (e.shiftKey) {
          insertMarkdown(textarea, '\n```\n', '\n```\n', 'code block', updateFn);
        } else {
          insertMarkdown(textarea, '[', '](url)', 'link text', updateFn);
        }
        break;
      case 'e':
        e.preventDefault();
        insertMarkdown(textarea, '`', '`', 'code', updateFn);
        break;
      case 'l':
        e.preventDefault();
        insertMarkdown(textarea, '- ', '', 'list item', updateFn);
        break;
      case '/':
        e.preventDefault();
        if (textarea && isLineSelection(textarea.value, textarea.selectionStart, textarea.selectionEnd)) {
          applyQuote(textarea, updateFn);
        } else {
          insertMarkdown(textarea, '~~', '~~', 'strikethrough', updateFn);
        }
        break;
    }
  };

  const handlePaste = async (e: React.ClipboardEvent, updateFn: (currentValue: string) => void) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const markdown = await uploadImage(file);
          if (markdown) {
            const textarea = e.target as HTMLTextAreaElement;
            const currentValue = textarea.value;
            const newValue = currentValue + '\n\n' + markdown;
            updateFn(newValue);
            // updateFn bypasses onChange, so grow the box for the added image.
            setTimeout(() => autoGrow(textarea), 0);
          }
        }
        break;
      }
    }
  };

  const ProfilePicture: React.FC<{
    user: { name: string; github_username?: string; avatar_url?: string };
    size?: 'sm' | 'md' | 'lg'
  }> = ({ user, size = 'md' }) => {
    const sizeClasses = {
      sm: 'h-6 w-6 text-xs',
      md: 'h-10 w-10 text-sm',
      lg: 'h-12 w-12 text-base'
    };

    if (user.avatar_url) {
      return (
        <img
          src={user.avatar_url}
          alt={`${user.name} profile`}
          className={`${sizeClasses[size]} rounded-full object-cover`}
        />
      );
    }

    return (
      <div className={`${sizeClasses[size]} rounded-full bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center`}>
        <span className="font-medium text-white">
          {user.name?.charAt(0)?.toUpperCase()}
        </span>
      </div>
    );
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return 'just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;

    return date.toLocaleDateString();
  };

  const markdownButtons = [
    { icon: Bold, label: 'Bold (Ctrl+B)', action: (textarea: HTMLTextAreaElement | null, updateFn?: (value: string) => void) => insertMarkdown(textarea, '**', '**', 'bold text', updateFn) },
    { icon: Italic, label: 'Italic (Ctrl+I)', action: (textarea: HTMLTextAreaElement | null, updateFn?: (value: string) => void) => insertMarkdown(textarea, '*', '*', 'italic text', updateFn) },
    { icon: Code, label: 'Code (Ctrl+E)', action: (textarea: HTMLTextAreaElement | null, updateFn?: (value: string) => void) => insertMarkdown(textarea, '`', '`', 'code', updateFn) },
    { icon: Link2, label: 'Link (Ctrl+K)', action: (textarea: HTMLTextAreaElement | null, updateFn?: (value: string) => void) => insertMarkdown(textarea, '[', '](url)', 'link text', updateFn) },
    { icon: List, label: 'List (Ctrl+L)', action: (textarea: HTMLTextAreaElement | null, updateFn?: (value: string) => void) => insertMarkdown(textarea, '- ', '', 'list item', updateFn) },
    { icon: AtSign, label: 'Mention', action: (textarea: HTMLTextAreaElement | null, updateFn?: (value: string) => void) => insertMarkdown(textarea, '@', '', 'username', updateFn) },
  ];

  // Organize comments into a nested structure
  const organizeComments = (comments: any[]) => {
    const commentMap = new Map();
    const rootComments: any[] = [];

    // First pass: create a map of all comments
    comments.forEach(comment => {
      commentMap.set(comment.id, { ...comment, replies: [] });
    });

    // Second pass: organize into hierarchy
    comments.forEach(comment => {
      const commentWithReplies = commentMap.get(comment.id);
      if (comment.parent_id && commentMap.has(comment.parent_id)) {
        commentMap.get(comment.parent_id).replies.push(commentWithReplies);
      } else {
        rootComments.push(commentWithReplies);
      }
    });

    return rootComments;
  };

  // Recursive comment component
  const CommentItem: React.FC<{ 
    comment: any; 
    depth?: number; 
    maxDepth?: number;
  }> = ({ comment, depth = 0, maxDepth = 3 }) => {
    return (
      <div className={`${depth > 0 ? 'ml-6 mt-4' : ''}`}>
        <div className="card p-6">
          <div className="flex items-start space-x-4">
            {/* Accepted Answer Indicator */}
            {comment.is_accepted && (
              <div className="flex flex-col items-center">
                <CheckCircle className="h-5 w-5 text-green-500" />
              </div>
            )}

            {/* Like Button */}
            <div className="flex items-center space-x-1">
              <button
                onClick={() => handleLike(comment.id, Boolean(comment.user_liked))}
                className={`p-1 hover:bg-gray-100 rounded transition-colors flex items-center space-x-1 ${
                  comment.user_liked ? 'text-red-500' : 'text-gray-600'
                }`}
                title={comment.user_liked ? "Unlike this comment" : "Like this comment"}
              >
                <Heart className={`h-4 w-4 ${comment.user_liked ? 'fill-current' : ''}`} />
                {comment.like_count > 0 && (
                  <span className="text-xs font-medium">
                    {comment.like_count}
                  </span>
                )}
              </button>
            </div>

            {/* Comment Content */}
            <div className="flex-1">
              {editingComment === comment.id ? (
                /* Edit Mode */
                <div className="space-y-3">
                  {/* Markdown Toolbar for Edit Mode */}
                  <div className="flex flex-wrap gap-1 p-2 bg-gray-50 rounded-lg">
                    {markdownButtons.map((button) => {
                      const Icon = button.icon;
                      return (
                        <button
                          key={button.label}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => button.action(editTextareaRef.current, setEditContent)}
                          className="p-1.5 hover:bg-gray-200 rounded text-gray-600 hover:text-gray-800 transition-colors"
                          title={button.label}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </button>
                      );
                    })}
                  </div>
                  <div className="relative">
                    <textarea
                      ref={(el) => {
                        editTextareaRef.current = el;
                        // Size to the existing comment as soon as edit mode opens.
                        autoGrow(el);
                      }}
                      value={editContent}
                      onChange={(e) => {
                        setEditContent(e.target.value);
                        autoGrow(e.target as HTMLTextAreaElement);
                      }}
                      rows={6}
                      className="form-input text-sm font-mono resize-y"
                      onPaste={(e) => handlePaste(e, setEditContent)}
                      onKeyDown={(e) => handleKeyDown(e, editTextareaRef.current, setEditContent)}
                      placeholder="Edit your comment...

Markdown formatting & keyboard shortcuts:
**bold** (Ctrl+B) | *italic* (Ctrl+I) | `code` (Ctrl+E) | [link](url) (Ctrl+K)
~~strikethrough~~ / > quote selected lines (Ctrl+/) | - list (Ctrl+L) | ```code block``` (Ctrl+Shift+K)

📷 PASTE IMAGES: Just copy and paste images from your clipboard!"
                    />
                    <MentionDropdown textareaRef={editTextareaRef} onChange={setEditContent} />
                    {isUploading && (
                      <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center">
                        <div className="flex items-center space-x-2 text-blue-600">
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                          <span className="text-sm">Uploading image...</span>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex justify-end space-x-2">
                    <button
                      onClick={() => {
                        setEditingComment(null);
                        setEditContent('');
                      }}
                      className="btn btn-secondary text-sm"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleEditComment(comment.id, editContent)}
                      className="btn btn-primary text-sm"
                    >
                      Save Changes
                    </button>
                  </div>
                </div>
              ) : (
                /* Display Mode */
                <div className="prose prose-sm max-w-none mb-4 text-gray-700 leading-relaxed">
                  {comment.content_html ? (
                    <ForumContent content={comment.content_html} className="mb-4 text-gray-700 leading-relaxed" />
                  ) : (
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
                        p: ({ children }) => (
                          <p className="text-gray-700 leading-relaxed mb-2 last:mb-0">{children}</p>
                        ),
                        code: ({ children }) => (
                          <code className="px-1 py-0.5 bg-gray-100 text-gray-800 rounded text-sm font-mono">{children}</code>
                        ),
                        pre: ({ children }) => (
                          <pre className="bg-gray-50 border border-gray-200 rounded p-2 overflow-x-auto my-2">
                            <code className="text-sm font-mono text-gray-800">{children}</code>
                          </pre>
                        ),
                      }}
                    >
                      {comment.content}
                    </ReactMarkdown>
                  )}
                </div>
              )}

              {/* Comment Meta */}
              {editingComment !== comment.id && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <Link to={`/profile/${comment.intranet_username || `id:${comment.user_id}`}`}>
                      <ProfilePicture 
                        user={{
                          name: comment.author_name,
                          github_username: comment.github_username,
                          avatar_url: comment.avatar_url
                        }} 
                        size="sm"
                      />
                    </Link>
                    <div>
                      <Link 
                        to={`/profile/${comment.intranet_username || `id:${comment.user_id}`}`}
                        className="text-sm font-medium text-gray-900 hover:text-primary-600"
                      >
                        {comment.author_name}
                      </Link>
                      {comment.author_account_type === 'ai_agent' && <span className="ml-1.5"><AiBadge /></span>}
                      <p className="text-xs text-gray-500">
                        {formatTimeAgo(comment.created_at)}
                        {comment.updated_at !== comment.created_at && (
                          <span className="ml-1">(edited)</span>
                        )}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    {/* Edit Button (for author or admin) */}
                    {currentUser && (comment.user_id === currentUser.id || currentUser.role === 'admin') && (
                      <button
                        onClick={() => {
                          setEditingComment(comment.id);
                          setEditContent(comment.content);
                        }}
                        className="p-1 hover:bg-blue-100 rounded transition-colors"
                        title="Edit comment"
                      >
                        <Edit3 className="h-3 w-3 text-blue-600" />
                      </button>
                    )}
                    
                    {/* Delete Button (for author or admin) */}
                    {currentUser && (comment.user_id === currentUser.id || currentUser.role === 'admin') && (
                      <button
                        onClick={() => handleDeleteComment(comment.id)}
                        className="p-1 hover:bg-red-100 rounded transition-colors"
                        title="Delete comment"
                      >
                        <Trash2 className="h-3 w-3 text-red-600" />
                      </button>
                    )}
                    
                    {/* Reply Button */}
                    {depth < maxDepth && (
                      <button
                        onClick={() => setReplyTo(replyTo === comment.id ? null : comment.id)}
                        className="text-sm text-gray-500 hover:text-primary-600 flex items-center"
                      >
                        <Reply className="h-3 w-3 mr-1" />
                        Reply
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Reply Form */}
              {replyTo === comment.id && (
                <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-600 mb-3">
                    Replying to {comment.author_name}
                  </p>
                  <ReplyForm 
                    postId={post?.id}
                    parentId={comment.id}
                    onSuccess={(result) => {
                      setReplyTo(null);
                      loadPost();
                      awaitAgentReplies(result.agentsSummoned, result.commentId);
                    }}
                    onCancel={() => setReplyTo(null)}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Nested Replies */}
        {comment.replies && comment.replies.length > 0 && (
          <div className="space-y-2">
            {comment.replies.map((reply: any) => (
              <CommentItem
                key={reply.id}
                comment={reply}
                depth={depth + 1}
                maxDepth={maxDepth}
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  // Reply Form Component
  const ReplyForm: React.FC<{
    postId: number | undefined;
    parentId: number;
    onSuccess: (result: { commentId: number; agentsSummoned?: SummonedAgent[] }) => void;
    onCancel: () => void;
  }> = ({ postId, parentId, onSuccess, onCancel }) => {
    const [content, setContent] = useState('');
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const localTextareaRef = React.useRef<HTMLTextAreaElement>(null);

    const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      
      if (!content.trim()) {
        setError('Reply cannot be empty');
        return;
      }
      
      if (content.trim().length < 5) {
        setError('Reply must be at least 5 characters');
        return;
      }
      
      if (!postId) {
        setError('Post ID is missing');
        return;
      }

      try {
        setError('');
        setIsSubmitting(true);
        
        const result = await postsApi.createComment(postId, {
          content: content.trim(),
          parentId: parentId
        });

        setContent('');
        onSuccess(result);
      } catch (err: any) {
        setError(err.response?.data?.error || 'Failed to post reply');
      } finally {
        setIsSubmitting(false);
      }
    };

    return (
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
            {error}
          </div>
        )}

        {/* Markdown Toolbar */}
        <div className="flex flex-wrap gap-1 p-2 bg-gray-50 rounded-lg">
          {markdownButtons.map((button) => {
            const Icon = button.icon;
            return (
              <button
                key={button.label}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => button.action(localTextareaRef.current, setContent)}
                className="p-1.5 hover:bg-gray-200 rounded text-gray-600 hover:text-gray-800 transition-colors"
                title={button.label}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            );
          })}
        </div>

        <div className="relative">
          <textarea
            ref={localTextareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            className="form-input text-sm font-mono"
            onPaste={(e) => handlePaste(e, setContent)}
            onKeyDown={(e) => handleKeyDown(e, localTextareaRef.current, setContent)}
            placeholder="Write your reply... Type @ to mention a person or bring in an AI agent.

Markdown formatting & keyboard shortcuts:
**bold** (Ctrl+B) | *italic* (Ctrl+I) | `code` (Ctrl+E) | [link](url) (Ctrl+K)
~~strikethrough~~ / > quote selected lines (Ctrl+/) | - list (Ctrl+L) | ```code block``` (Ctrl+Shift+K)

📷 PASTE IMAGES: Just copy and paste images from your clipboard!"
          />
          <MentionDropdown textareaRef={localTextareaRef} onChange={setContent} />
          {isUploading && (
            <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center">
              <div className="flex items-center space-x-2 text-blue-600">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                <span className="text-sm">Uploading image...</span>
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end space-x-2">
          <button
            type="button"
            onClick={onCancel}
            className="btn btn-secondary text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="btn btn-primary text-sm"
          >
            {isSubmitting ? (
              <>
                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-1"></div>
                Posting...
              </>
            ) : (
              <>
                <Send className="h-3 w-3 mr-1" />
                Post Reply
              </>
            )}
          </button>
        </div>
      </form>
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-300 rounded w-3/4 mb-4"></div>
          <div className="h-64 bg-gray-300 rounded mb-4"></div>
          <div className="h-32 bg-gray-300 rounded"></div>
        </div>
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="text-center py-12">
        <MessageCircle className="h-16 w-16 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Post not found</h2>
        <p className="text-gray-600 mb-4">
          {error || 'The post you\'re looking for doesn\'t exist or has been removed.'}
        </p>
        <Link to="/forum" className="btn btn-primary">
          Back to Forum
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center">
        <Link 
          to="/forum" 
          className="text-gray-500 hover:text-gray-700 mr-4"
        >
          <ArrowLeft className="h-6 w-6" />
        </Link>
        <div className="text-sm text-gray-500">
          <Link to="/forum" className="hover:text-primary-600">Forum</Link>
          <span className="mx-2">→</span>
          <span>Post</span>
        </div>
      </div>

      {/* Post */}
      <div className="card p-8">
        {/* Post Header */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex-1">
            <div className="flex items-center space-x-2 mb-2">
              {Boolean(post.is_pinned) && (
                <Pin className="h-5 w-5 text-yellow-500" />
              )}
              {Boolean(post.is_locked) && (
                <Lock className="h-5 w-5 text-gray-500" />
              )}
              <h1 className="text-3xl font-bold text-gray-900">{post.title}</h1>
            </div>
            
            <div className="flex items-center space-x-4 text-sm text-gray-500">
              <div className="flex items-center">
                <Eye className="h-4 w-4 mr-1" />
                {post.view_count} views
              </div>
              <Link to={`/forum/post/${post.slug}/tts`} className="flex items-center text-blue-600 hover:text-blue-800" title="Radio summary (text-to-speech version of this post)">
                <Radio className="h-4 w-4 mr-1" />
                Radio summary
              </Link>
              {post.access_count && (
                <div className="flex items-center">
                  <Users className="h-4 w-4 mr-1" />
                  {post.access_count} {post.access_count === 1 ? 'person' : 'people'} can access
                </div>
              )}
              <div className="flex items-center">
                <MessageCircle className="h-4 w-4 mr-1" />
                {post.comments?.length || 0} answers
              </div>
              <div className="flex items-center">
                <Calendar className="h-4 w-4 mr-1" />
                {formatTimeAgo(post.created_at)}
              </div>
            </div>
          </div>

          {/* Post Actions */}
          <div className="flex flex-col items-center space-y-2">
            {/* Edit Button (for author, admin, or a co-editor) */}
            {currentUser && (post.can_edit || post.user_id === currentUser.id || currentUser.role === 'admin') && (
              <button
                onClick={() => navigate(`/forum/edit/${post.slug}`)}
                className="p-2 hover:bg-blue-100 rounded-lg transition-colors"
                title="Edit post"
              >
                <Edit3 className="h-5 w-5 text-blue-600" />
              </button>
            )}
            
            {/* Delete Button (for author or admin) */}
            {currentUser && (post.user_id === currentUser.id || currentUser.role === 'admin') && (
              <button
                onClick={() => handleDeletePost()}
                className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                title="Delete post"
              >
                <Trash2 className="h-5 w-5 text-red-600" />
              </button>
            )}
            
            {/* Post Voting */}
            <button
              onClick={() => handleVote('post', post.id, 1)}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ThumbsUp className="h-5 w-5 text-gray-600" />
            </button>
            <span className="text-lg font-semibold text-gray-900">
              {post.score || 0}
            </span>
          </div>
        </div>

        {/* Post Content or Attachment Preview */}
        <div className="bg-white rounded-lg border border-gray-200 p-8 mb-8 shadow-sm">
          {/* Show attachment preview if content is empty and file is previewable */}
          {(!post.content || post.content.trim() === '') && post.attachment_filename ? (
            <div className="attachment-preview">
              {isPreviewableImage(post.attachment_filename) && (
                <div className="text-center">
                  <img
                    src={`/uploads/forum-attachments/${post.attachment_filename}`}
                    alt={post.attachment_original_name || 'Attachment'}
                    className="max-w-full h-auto rounded-lg shadow-lg mx-auto"
                    style={{ maxHeight: '600px' }}
                  />
                  <div className="mt-4 flex items-center justify-center space-x-4">
                    <p className="text-sm text-gray-500">
                      {post.attachment_original_name}
                    </p>
                    <a
                      href={`/uploads/forum-attachments/${post.attachment_filename}`}
                      download={post.attachment_original_name || post.attachment_filename}
                      className="inline-flex items-center px-3 py-1 bg-gray-600 text-white text-sm rounded-lg hover:bg-gray-700 transition-colors"
                    >
                      <Download className="h-3 w-3 mr-1" />
                      Download
                    </a>
                  </div>
                </div>
              )}

              {isPDF(post.attachment_filename) && (
                <div className="pdf-preview">
                  <iframe
                    src={`/uploads/forum-attachments/${post.attachment_filename}`}
                    className="w-full rounded-lg shadow-lg"
                    style={{ height: '600px' }}
                    title={post.attachment_original_name || 'PDF Attachment'}
                  />
                  <div className="mt-4 flex items-center justify-center space-x-4">
                    <p className="text-sm text-gray-500">
                      {post.attachment_original_name}
                    </p>
                    <a
                      href={`/uploads/forum-attachments/${post.attachment_filename}`}
                      download={post.attachment_original_name || post.attachment_filename}
                      className="inline-flex items-center px-3 py-1 bg-gray-600 text-white text-sm rounded-lg hover:bg-gray-700 transition-colors"
                    >
                      <Download className="h-3 w-3 mr-1" />
                      Download PDF
                    </a>
                  </div>
                </div>
              )}

              {isSVG(post.attachment_filename) && (
                <div className="text-center">
                  <img
                    src={`/uploads/forum-attachments/${post.attachment_filename}`}
                    alt={post.attachment_original_name || 'SVG Attachment'}
                    className="max-w-full h-auto rounded-lg shadow-lg mx-auto"
                    style={{ maxHeight: '600px' }}
                  />
                  <div className="mt-4 flex items-center justify-center space-x-4">
                    <p className="text-sm text-gray-500">
                      {post.attachment_original_name}
                    </p>
                    <a
                      href={`/uploads/forum-attachments/${post.attachment_filename}`}
                      download={post.attachment_original_name || post.attachment_filename}
                      className="inline-flex items-center px-3 py-1 bg-gray-600 text-white text-sm rounded-lg hover:bg-gray-700 transition-colors"
                    >
                      <Download className="h-3 w-3 mr-1" />
                      Download SVG
                    </a>
                  </div>
                </div>
              )}

              {isMermaid(post.attachment_filename) && (
                <div className="mermaid-preview p-8 bg-gray-50 rounded-lg text-center">
                  <FileIcon className="h-16 w-16 text-purple-500 mx-auto mb-4" />
                  <p className="text-lg text-gray-700 font-medium mb-2">
                    {post.attachment_original_name}
                  </p>
                  <p className="text-sm text-gray-500 mb-4">
                    Mermaid diagram file ({formatFileSize(post.attachment_size || 0)})
                  </p>
                  <p className="text-xs text-gray-400 mb-4">
                    Mermaid files require a compatible viewer to render the diagram.
                  </p>
                  <a
                    href={`/uploads/forum-attachments/${post.attachment_filename}`}
                    download={post.attachment_original_name || post.attachment_filename}
                    className="inline-flex items-center px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 transition-colors"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download Mermaid File
                  </a>
                </div>
              )}

              {!isPreviewableImage(post.attachment_filename) &&
               !isPDF(post.attachment_filename) &&
               !isSVG(post.attachment_filename) &&
               !isMermaid(post.attachment_filename) && (
                <div className="text-center py-12">
                  <FileIcon className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                  <p className="text-lg text-gray-700 font-medium mb-2">
                    {post.attachment_original_name}
                  </p>
                  <p className="text-sm text-gray-500 mb-4">
                    {formatFileSize(post.attachment_size || 0)}
                  </p>
                  <p className="text-xs text-gray-400 mb-4">
                    Preview not available for this file type
                  </p>
                  <a
                    href={`/uploads/forum-attachments/${post.attachment_filename}`}
                    download={post.attachment_original_name || post.attachment_filename}
                    className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download File
                  </a>
                </div>
              )}
            </div>
          ) : (
            <div className="prose prose-lg max-w-none">
              {post.content_html ? (
                <ForumContent content={post.content_html} />
              ) : (
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
                  h1: ({ children }) => (
                    <h1 className="text-3xl font-bold text-gray-900 mb-6 pb-4 border-b border-gray-200">{children}</h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="text-2xl font-semibold text-gray-800 mt-8 mb-4 pb-2 border-b border-gray-100">{children}</h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="text-xl font-medium text-gray-800 mt-6 mb-3">{children}</h3>
                  ),
                  p: ({ children }) => (
                    <p className="text-gray-700 leading-relaxed mb-4 last:mb-0">{children}</p>
                  ),
                  code: ({ children }) => (
                    <code className="px-2 py-1 bg-gray-100 text-gray-800 rounded text-sm font-mono border">{children}</code>
                  ),
                  pre: ({ children }) => (
                    <pre className="bg-gray-50 border border-gray-200 rounded-lg p-4 overflow-x-auto my-6 shadow-inner">
                      <code className="text-sm font-mono text-gray-800">{children}</code>
                    </pre>
                  ),
                  ul: ({ children }) => (
                    <ul className="space-y-2 my-4">{children}</ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="space-y-2 my-4">{children}</ol>
                  ),
                  li: ({ children }) => (
                    <li className="text-gray-700 leading-relaxed">{children}</li>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-4 border-primary-200 pl-4 py-2 my-6 bg-primary-50 text-gray-700 italic">
                      {children}
                    </blockquote>
                  ),
                }}
              >
                  {post.content}
                </ReactMarkdown>
              )}
            </div>
          )}

          {/* Attachment Download - Show when there's content OR file is not previewable */}
          {post.attachment_filename && (post.content && post.content.trim() !== '') && (
            <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <FileIcon className="h-6 w-6 text-blue-500 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-gray-900 truncate">
                      {post.attachment_original_name || 'Attachment'}
                    </p>
                    <p className="text-xs text-gray-500">
                      {formatFileSize(post.attachment_size || 0)}
                    </p>
                  </div>
                </div>
                <a
                  href={`/uploads/forum-attachments/${post.attachment_filename}`}
                  download={post.attachment_original_name || post.attachment_filename}
                  className="flex items-center px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Tags */}
        {post.tags && post.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {post.tags.map((tag) => (
              <Link
                key={tag.id}
                to={`/forum?tag=${tag.slug}`}
                className="px-3 py-1 bg-primary-100 text-primary-700 rounded-full text-sm hover:bg-primary-200"
              >
                {tag.name}
              </Link>
            ))}
          </div>
        )}

        {/* Post Author */}
        <div className="flex items-center justify-between pt-6 border-t border-gray-200">
          <div className="flex items-center space-x-3">
            <Link to={`/profile/${post.intranet_username || `id:${post.user_id}`}`}>
              <ProfilePicture user={{
                name: post.author_name,
                github_username: post.github_username,
                avatar_url: post.avatar_url
              }} />
            </Link>
            <div>
              <Link 
                to={`/profile/${post.intranet_username || `id:${post.user_id}`}`}
                className="font-medium text-gray-900 hover:text-primary-600"
              >
                {post.author_name}
              </Link>
              {post.author_account_type === 'ai_agent' && <span className="ml-1.5"><AiBadge /></span>}
              {(post.intranet_username || post.github_username) && (
                <p className="text-sm text-gray-500">@{post.intranet_username || post.github_username}</p>
              )}
            </div>
          </div>
          <div className="text-sm text-gray-500">
            Posted {new Date(post.created_at).toLocaleDateString()}
          </div>
        </div>
      </div>

      {/* Comments Section */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">
            {post.comments?.length || 0} Answers
          </h2>
        </div>

        {/* Comments List */}
        {post.comments && post.comments.length > 0 ? (
          <div className="space-y-4">
            {organizeComments(post.comments).map((comment) => (
              <CommentItem key={comment.id} comment={comment} />
            ))}
          </div>
        ) : (
          <div className="card p-8 text-center">
            <MessageCircle className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No answers yet</h3>
            <p className="text-gray-600">Be the first to answer this question!</p>
          </div>
        )}

        {/* AI agents tagged in a new comment are writing their replies */}
        {pendingAgents && pendingAgents.agents.length > 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-800" role="status">
            <Bot className="h-4 w-4 flex-shrink-0 animate-pulse" />
            <span>
              {pendingAgents.agents.map(a => a.name).join(', ')}{' '}
              {pendingAgents.agents.length === 1 ? 'is' : 'are'} reading the thread and writing a reply…
            </span>
          </div>
        )}

        {/* Add Comment Form */}
        {!post.is_locked && (
          <div className="card p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Your Answer</h3>
            
            <form onSubmit={handleSubmit(onSubmitComment)} className="space-y-4">
              {commentError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                  {commentError}
                </div>
              )}

              {/* Markdown Toolbar */}
              <div className="flex flex-wrap gap-1 p-2 bg-gray-50 rounded-lg">
                {markdownButtons.map((button) => {
                  const Icon = button.icon;
                  return (
                    <button
                      key={button.label}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => button.action(commentTextareaRef.current, (value) => setValue('content', value))}
                      className="p-2 hover:bg-gray-200 rounded text-gray-600 hover:text-gray-800 transition-colors"
                      title={button.label}
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                  );
                })}
              </div>

              <div className="relative">
                <textarea
                  {...register('content')}
                  ref={(el) => {
                    commentTextareaRef.current = el;
                    register('content').ref(el);
                  }}
                  rows={8}
                  className="form-input font-mono"
                  onPaste={(e) => handlePaste(e, (value) => setValue('content', value))}
                  onKeyDown={(e) => handleKeyDown(e, commentTextareaRef.current, (value) => setValue('content', value))}
                  placeholder="Write your answer here...

Markdown formatting & keyboard shortcuts:
**bold** (Ctrl+B) | *italic* (Ctrl+I) | `code` (Ctrl+E) | [link](url) (Ctrl+K)
~~strikethrough~~ / > quote selected lines (Ctrl+/) | - list (Ctrl+L) | ```code block``` (Ctrl+Shift+K)
Type @ to mention a person or bring an AI agent into the thread

📷 PASTE IMAGES: Just copy and paste images from your clipboard!

Be helpful and provide detailed explanations."
                />
                <MentionDropdown
                  textareaRef={commentTextareaRef}
                  onChange={(value) => setValue('content', value, { shouldValidate: true })}
                />
                {isUploading && (
                  <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center">
                    <div className="flex items-center space-x-2 text-blue-600">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                      <span className="text-sm">Uploading image...</span>
                    </div>
                  </div>
                )}
                {errors.content && (
                  <p className="mt-2 text-sm text-red-600">{errors.content.message}</p>
                )}
              </div>

              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  <p>✓ Markdown supported</p>
                  <p>✓ @mentions will notify users</p>
                  <p>✓ Image pasting enabled</p>
                </div>
                <button
                  type="submit"
                  disabled={isSubmittingComment}
                  className="btn btn-primary"
                >
                  {isSubmittingComment ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Posting...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4 mr-2" />
                      Post Answer
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        )}

        {!!post.is_locked && (
          <div className="card p-6 bg-yellow-50 border-yellow-200">
            <div className="flex items-center">
              <Lock className="h-5 w-5 text-yellow-600 mr-2" />
              <p className="text-yellow-800">
                This post is locked and no longer accepting new answers.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PostPage;