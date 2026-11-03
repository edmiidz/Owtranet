import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Edit2,
  Trash2,
  Calendar,
  Clock,
  MessageCircle,
  Send,
  CheckCircle2,
  Circle,
  Loader2,
  AlertTriangle,
  Activity
} from 'lucide-react';
import { tasksApi } from '../utils/api';
import { useAuthStore } from '../stores/authStore';
import type { Task, TaskComment, TaskActivity } from '../types';
import MentionDropdown from '../components/MentionDropdown';

const priorityConfig = {
  low: { label: 'Low', color: 'bg-gray-100 text-gray-700' },
  normal: { label: 'Normal', color: 'bg-blue-100 text-blue-700' },
  high: { label: 'High', color: 'bg-orange-100 text-orange-700' },
  urgent: { label: 'Urgent', color: 'bg-red-100 text-red-700' },
};

const statusConfig = {
  pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-700', icon: Circle },
  in_progress: { label: 'In Progress', color: 'bg-blue-100 text-blue-700', icon: Loader2 },
  completed: { label: 'Completed', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
};

const TaskDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [task, setTask] = useState<Task | null>(null);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [activityLog, setActivityLog] = useState<TaskActivity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [newComment, setNewComment] = useState('');
  const commentTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);

  useEffect(() => {
    if (id) loadTask();
  }, [id]);

  const loadTask = async () => {
    try {
      setIsLoading(true);
      const taskId = parseInt(id!);
      const [taskData, commentsData, activityData] = await Promise.all([
        tasksApi.getTask(taskId),
        tasksApi.getComments(taskId),
        tasksApi.getActivity(taskId),
      ]);
      setTask(taskData);
      setComments(commentsData.comments || []);
      setActivityLog(activityData.activity || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load task');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStatusChange = async (newStatus: Task['status']) => {
    if (!task || statusUpdating) return;
    try {
      setStatusUpdating(true);
      await tasksApi.updateTask(task.id, { status: newStatus });
      setTask({ ...task, status: newStatus });
      // Reload activity
      const activityData = await tasksApi.getActivity(task.id);
      setActivityLog(activityData.activity || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update status');
    } finally {
      setStatusUpdating(false);
    }
  };

  const handleDelete = async () => {
    if (!task) return;
    try {
      await tasksApi.deleteTask(task.id);
      navigate('/tasks');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete task');
    }
  };

  const handleCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || !task) return;

    try {
      setIsSubmittingComment(true);
      const response = await tasksApi.createComment(task.id, newComment);
      setComments([...comments, response.comment]);
      setNewComment('');
      // Reload activity
      const activityData = await tasksApi.getActivity(task.id);
      setActivityLog(activityData.activity || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to post comment');
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleDeleteComment = async (commentId: number) => {
    try {
      await tasksApi.deleteComment(commentId);
      setComments(comments.filter(c => c.id !== commentId));
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete comment');
    }
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

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Not set';
    return new Date(dateString + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
    });
  };

  const getActivityDescription = (item: TaskActivity) => {
    switch (item.action) {
      case 'created': return 'created this task';
      case 'status_changed': return `changed status from "${item.old_value}" to "${item.new_value}"`;
      case 'assigned': return `reassigned from ${item.old_value} to ${item.new_value}`;
      case 'priority_changed': return `changed priority from "${item.old_value}" to "${item.new_value}"`;
      case 'due_date_changed': return `changed due date from ${item.old_value} to ${item.new_value}`;
      case 'commented': return 'added a comment';
      case 'edited': return 'edited the task';
      default: return item.action;
    }
  };

  const Avatar: React.FC<{ name?: string; avatar?: string; size?: string }> = ({ name, avatar, size = 'h-8 w-8' }) => {
    if (avatar) {
      return <img src={avatar} alt={name} className={`${size} rounded-full object-cover`} />;
    }
    return (
      <div className={`${size} rounded-full bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center`}>
        <span className="text-xs font-medium text-white">{name?.charAt(0)?.toUpperCase()}</span>
      </div>
    );
  };

  const canEdit = task && (task.created_by === user?.id || user?.role === 'admin');

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 bg-gray-300 rounded w-1/4" />
        <div className="card p-6 space-y-4">
          <div className="h-6 bg-gray-300 rounded w-2/3" />
          <div className="h-4 bg-gray-300 rounded w-1/3" />
          <div className="h-24 bg-gray-300 rounded" />
        </div>
      </div>
    );
  }

  if (error && !task) {
    return (
      <div className="card p-12 text-center">
        <AlertTriangle className="h-12 w-12 text-red-400 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">Error</h3>
        <p className="text-gray-500 mb-4">{error}</p>
        <Link to="/tasks" className="btn btn-primary">Back to Tasks</Link>
      </div>
    );
  }

  if (!task) return null;

  const statusCfg = statusConfig[task.status];
  const priorityCfg = priorityConfig[task.priority];

  return (
    <div className="space-y-6">
      {/* Back button */}
      <Link to="/tasks" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to Tasks
      </Link>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm">
          {error}
        </div>
      )}

      {/* Task Header */}
      <div className="card p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-900 mb-3">{task.title}</h1>
            <div className="flex items-center flex-wrap gap-2 mb-4">
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusCfg.color}`}>
                {statusCfg.label}
              </span>
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${priorityCfg.color}`}>
                {priorityCfg.label} Priority
              </span>
            </div>
          </div>
          {canEdit && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <Link
                to={`/tasks/edit/${task.id}`}
                className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                <Edit2 className="h-4 w-4 mr-1" />
                Edit
              </Link>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="inline-flex items-center px-3 py-2 border border-red-300 rounded-md text-sm font-medium text-red-700 bg-white hover:bg-red-50"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Delete
              </button>
            </div>
          )}
        </div>

        {/* Meta info */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 py-4 border-t border-gray-100">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Created by</p>
            <div className="flex items-center gap-2">
              <Avatar name={task.creator_name} avatar={task.creator_avatar} size="h-6 w-6" />
              <span className="text-sm font-medium text-gray-900">{task.creator_name}</span>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Assigned to</p>
            {task.assignee_name ? (
              <div className="flex items-center gap-2">
                <Avatar name={task.assignee_name} avatar={task.assignee_avatar} size="h-6 w-6" />
                <span className="text-sm font-medium text-gray-900">{task.assignee_name}</span>
              </div>
            ) : (
              <span className="text-sm text-gray-400">Unassigned</span>
            )}
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Due Date</p>
            <div className="flex items-center gap-1 text-sm">
              <Calendar className="h-4 w-4 text-gray-400" />
              <span className="text-gray-900">{formatDate(task.due_date)}</span>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Created</p>
            <div className="flex items-center gap-1 text-sm">
              <Clock className="h-4 w-4 text-gray-400" />
              <span className="text-gray-900">{formatTimeAgo(task.created_at)}</span>
            </div>
          </div>
        </div>

        {/* Quick status change */}
        <div className="pt-4 border-t border-gray-100">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Change Status</p>
          <div className="flex gap-2">
            {(['pending', 'in_progress', 'completed'] as const).map((s) => {
              const cfg = statusConfig[s];
              const Icon = cfg.icon;
              return (
                <button
                  key={s}
                  onClick={() => handleStatusChange(s)}
                  disabled={task.status === s || statusUpdating}
                  className={`inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                    task.status === s
                      ? `${cfg.color} border-current cursor-default`
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  } disabled:opacity-50`}
                >
                  <Icon className="h-3.5 w-3.5 mr-1.5" />
                  {cfg.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Description */}
        {task.description_html && (
          <div className="pt-4 border-t border-gray-100 mt-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-2">Description</h2>
            <div
              className="prose prose-sm max-w-none text-gray-700"
              dangerouslySetInnerHTML={{ __html: task.description_html }}
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Comments Section */}
        <div className="lg:col-span-2">
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <MessageCircle className="h-5 w-5 mr-2" />
              Comments ({comments.length})
            </h2>

            {comments.length === 0 ? (
              <p className="text-gray-500 text-sm py-4">No comments yet. Be the first to comment!</p>
            ) : (
              <div className="space-y-4 mb-6">
                {comments.map((comment) => (
                  <div key={comment.id} className="flex gap-3">
                    <Avatar name={comment.author_name} avatar={comment.author_avatar} />
                    <div className="flex-1 min-w-0">
                      <div className="bg-gray-50 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-gray-900">{comment.author_name}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">{formatTimeAgo(comment.created_at)}</span>
                            {(comment.user_id === user?.id || user?.role === 'admin') && (
                              <button
                                onClick={() => handleDeleteComment(comment.id)}
                                className="text-xs text-red-500 hover:text-red-700"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                        <div
                          className="prose prose-sm max-w-none text-gray-700"
                          dangerouslySetInnerHTML={{ __html: comment.content_html }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Comment form */}
            <form onSubmit={handleCommentSubmit} className="border-t border-gray-100 pt-4">
              <textarea
                ref={commentTextareaRef}
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Write a comment... (Markdown supported, type @ to mention someone)"
                rows={3}
                className="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm focus:ring-primary-500 focus:border-primary-500 resize-none"
              />
              {/* AI agents answer in forum threads only, so tasks offer people. */}
              <MentionDropdown textareaRef={commentTextareaRef} onChange={setNewComment} includeAgents={false} />
              <div className="flex justify-end mt-2">
                <button
                  type="submit"
                  disabled={!newComment.trim() || isSubmittingComment}
                  className="btn btn-primary inline-flex items-center text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmittingComment ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 mr-1" />
                  )}
                  Post Comment
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Activity Timeline */}
        <div>
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <Activity className="h-5 w-5 mr-2" />
              Activity
            </h2>
            {activityLog.length === 0 ? (
              <p className="text-gray-500 text-sm">No activity recorded</p>
            ) : (
              <div className="relative">
                <div className="absolute top-0 bottom-0 left-4 w-px bg-gray-200" />
                <div className="space-y-4">
                  {activityLog.map((item) => (
                    <div key={item.id} className="relative flex gap-3 pl-0">
                      <div className="relative z-10 flex-shrink-0">
                        <Avatar name={item.user_name} avatar={item.user_avatar} size="h-8 w-8" />
                      </div>
                      <div className="flex-1 min-w-0 pt-0.5">
                        <p className="text-sm text-gray-700">
                          <span className="font-medium">{item.user_name}</span>{' '}
                          {getActivityDescription(item)}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">{formatTimeAgo(item.created_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Task</h3>
            <p className="text-gray-600 mb-4">
              Are you sure you want to delete "{task.title}"? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TaskDetailPage;
