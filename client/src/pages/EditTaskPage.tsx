import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Save,
  Eye,
  Loader2,
  AlertTriangle
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { tasksApi } from '../utils/api';
import { useAuthStore } from '../stores/authStore';

const EditTaskPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [previewMode, setPreviewMode] = useState(false);
  const [users, setUsers] = useState<Array<{ id: number; name: string; intranet_username?: string; avatar_url?: string }>>([]);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('normal');
  const [status, setStatus] = useState('pending');
  const [dueDate, setDueDate] = useState('');
  const [assignedTo, setAssignedTo] = useState<string>('');

  useEffect(() => {
    if (id) {
      loadTask();
      loadUsers();
    }
  }, [id]);

  const loadTask = async () => {
    try {
      setIsLoading(true);
      const task = await tasksApi.getTask(parseInt(id!));

      // Check permissions
      if (task.created_by !== user?.id && user?.role !== 'admin') {
        setError('You are not authorized to edit this task');
        return;
      }

      setTitle(task.title);
      setDescription(task.description || '');
      setPriority(task.priority);
      setStatus(task.status);
      setDueDate(task.due_date ? task.due_date.split('T')[0] : '');
      setAssignedTo(task.assigned_to ? String(task.assigned_to) : '');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load task');
    } finally {
      setIsLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      const response = await tasksApi.getUsers();
      setUsers(response.users || []);
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!title.trim() || title.trim().length < 3) {
      setError('Title must be at least 3 characters');
      return;
    }

    try {
      setIsSaving(true);
      await tasksApi.updateTask(parseInt(id!), {
        title: title.trim(),
        description: description.trim(),
        priority,
        status,
        due_date: dueDate || null,
        assigned_to: assignedTo ? parseInt(assignedTo) : null,
      });
      navigate(`/tasks/${id}`);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update task');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto space-y-6 animate-pulse">
        <div className="h-8 bg-gray-300 rounded w-1/4" />
        <div className="card p-6 space-y-4">
          <div className="h-10 bg-gray-300 rounded" />
          <div className="h-32 bg-gray-300 rounded" />
          <div className="grid grid-cols-2 gap-4">
            <div className="h-10 bg-gray-300 rounded" />
            <div className="h-10 bg-gray-300 rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (error && !title) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="card p-12 text-center">
          <AlertTriangle className="h-12 w-12 text-red-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Error</h3>
          <p className="text-gray-500 mb-4">{error}</p>
          <Link to="/tasks" className="btn btn-primary">Back to Tasks</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-3">
        <Link to={`/tasks/${id}`} className="text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Edit Task</h1>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="card p-6 space-y-6">
        {/* Title */}
        <div>
          <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter task title"
            className="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm focus:ring-primary-500 focus:border-primary-500"
            required
          />
        </div>

        {/* Description */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="description" className="block text-sm font-medium text-gray-700">
              Description
            </label>
            <button
              type="button"
              onClick={() => setPreviewMode(!previewMode)}
              className="text-sm text-primary-600 hover:text-primary-700 flex items-center"
            >
              <Eye className="h-3.5 w-3.5 mr-1" />
              {previewMode ? 'Edit' : 'Preview'}
            </button>
          </div>
          {previewMode ? (
            <div className="border border-gray-300 rounded-md p-3 min-h-[150px] prose prose-sm max-w-none bg-gray-50">
              {description ? (
                <ReactMarkdown>{description}</ReactMarkdown>
              ) : (
                <p className="text-gray-400 italic">Nothing to preview</p>
              )}
            </div>
          ) : (
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the task... (Markdown supported)"
              rows={6}
              className="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm focus:ring-primary-500 focus:border-primary-500 resize-none"
            />
          )}
          <p className="mt-1 text-xs text-gray-500">Supports Markdown formatting and @mentions</p>
        </div>

        {/* Grid: Priority, Status, Due Date, Assignee */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="priority" className="block text-sm font-medium text-gray-700 mb-1">
              Priority
            </label>
            <select
              id="priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>

          <div>
            <label htmlFor="status" className="block text-sm font-medium text-gray-700 mb-1">
              Status
            </label>
            <select
              id="status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
            </select>
          </div>

          <div>
            <label htmlFor="due_date" className="block text-sm font-medium text-gray-700 mb-1">
              Due Date
            </label>
            <input
              id="due_date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          <div>
            <label htmlFor="assigned_to" className="block text-sm font-medium text-gray-700 mb-1">
              Assign To
            </label>
            <select
              id="assigned_to"
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              className="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 text-sm focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}{u.intranet_username ? ` (@${u.intranet_username})` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Submit */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
          <Link
            to={`/tasks/${id}`}
            className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isSaving}
            className="btn btn-primary inline-flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Changes
          </button>
        </div>
      </form>
    </div>
  );
};

export default EditTaskPage;
