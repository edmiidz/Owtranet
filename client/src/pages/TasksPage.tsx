import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus,
  Calendar,
  MessageCircle,
  CheckCircle2,
  Circle,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Search,
  Activity,
  User as UserIcon,
  CalendarDays
} from 'lucide-react';
import { tasksApi } from '../utils/api';
import type { Task, TaskActivity } from '../types';

const priorityConfig = {
  low: { label: 'Low', color: 'bg-gray-100 text-gray-700', dot: 'bg-gray-400' },
  normal: { label: 'Normal', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-400' },
  high: { label: 'High', color: 'bg-orange-100 text-orange-700', dot: 'bg-orange-400' },
  urgent: { label: 'Urgent', color: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
};

const statusConfig = {
  pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-700', icon: Circle },
  in_progress: { label: 'In Progress', color: 'bg-blue-100 text-blue-700', icon: Loader2 },
  completed: { label: 'Completed', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
};

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const TasksPage: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'my' | 'all' | 'calendar' | 'activity'>('my');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 0 });
  const [activity, setActivity] = useState<TaskActivity[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  // Calendar state
  const now = new Date();
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calTasks, setCalTasks] = useState<Task[]>([]);
  const [calLoading, setCalLoading] = useState(false);
  const [calView, setCalView] = useState<'due' | 'created'>('due');

  useEffect(() => {
    if (activeTab === 'activity') {
      loadActivity();
    } else if (activeTab === 'calendar') {
      loadCalendarTasks();
    } else {
      loadTasks();
    }
  }, [currentPage, activeTab, statusFilter, priorityFilter, sortBy]);

  useEffect(() => {
    if (activeTab === 'calendar') {
      loadCalendarTasks();
    }
  }, [calMonth, calYear, calView]);

  const loadTasks = async () => {
    try {
      setIsLoading(true);
      const response = await tasksApi.getTasks({
        page: currentPage,
        limit: 20,
        status: statusFilter || undefined,
        priority: priorityFilter || undefined,
        sort: sortBy,
        search: searchQuery || undefined,
        view: activeTab === 'my' ? 'mine' : 'all',
      });
      setTasks(response.tasks || []);
      setPagination(response.pagination);
    } catch (error) {
      console.error('Failed to load tasks:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadCalendarTasks = async () => {
    try {
      setCalLoading(true);
      // Load all tasks (no pagination) for the calendar — we need a large enough limit
      const response = await tasksApi.getTasks({ page: 1, limit: 200, sort: 'due_date' });
      setCalTasks(response.tasks || []);
    } catch (error) {
      console.error('Failed to load calendar tasks:', error);
    } finally {
      setCalLoading(false);
    }
  };

  const loadActivity = async () => {
    try {
      setActivityLoading(true);
      const response = await tasksApi.getActivityFeed({ page: 1, limit: 50 });
      setActivity(response.activity || []);
    } catch (error) {
      console.error('Failed to load activity:', error);
    } finally {
      setActivityLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentPage(1);
    loadTasks();
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

  const formatDueDate = (dateString: string | null) => {
    if (!dateString) return null;
    const date = new Date(dateString + 'T00:00:00');
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const diff = date.getTime() - now.getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

    if (days < 0) return { text: `${Math.abs(days)}d overdue`, className: 'text-red-600 font-medium' };
    if (days === 0) return { text: 'Due today', className: 'text-orange-600 font-medium' };
    if (days === 1) return { text: 'Due tomorrow', className: 'text-yellow-600' };
    if (days <= 7) return { text: `Due in ${days}d`, className: 'text-gray-600' };
    return { text: date.toLocaleDateString(), className: 'text-gray-500' };
  };

  const getActivityDescription = (item: TaskActivity) => {
    switch (item.action) {
      case 'created': return 'created this task';
      case 'status_changed': return `changed status from ${item.old_value} to ${item.new_value}`;
      case 'assigned': return `reassigned from ${item.old_value} to ${item.new_value}`;
      case 'priority_changed': return `changed priority from ${item.old_value} to ${item.new_value}`;
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

  // Calendar helpers
  const getCalendarDays = () => {
    const firstDay = new Date(calYear, calMonth, 1);
    const lastDay = new Date(calYear, calMonth + 1, 0);
    const startPad = firstDay.getDay(); // 0=Sun
    const totalDays = lastDay.getDate();

    const days: Array<{ date: number; month: number; year: number; isCurrentMonth: boolean }> = [];

    // Previous month padding
    const prevMonthLast = new Date(calYear, calMonth, 0).getDate();
    for (let i = startPad - 1; i >= 0; i--) {
      const d = prevMonthLast - i;
      const m = calMonth === 0 ? 11 : calMonth - 1;
      const y = calMonth === 0 ? calYear - 1 : calYear;
      days.push({ date: d, month: m, year: y, isCurrentMonth: false });
    }

    // Current month
    for (let d = 1; d <= totalDays; d++) {
      days.push({ date: d, month: calMonth, year: calYear, isCurrentMonth: true });
    }

    // Next month padding to fill 6 rows
    const remaining = 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      const m = calMonth === 11 ? 0 : calMonth + 1;
      const y = calMonth === 11 ? calYear + 1 : calYear;
      days.push({ date: d, month: m, year: y, isCurrentMonth: false });
    }

    return days;
  };

  const getTasksForDate = (date: number, month: number, year: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
    return calTasks.filter((task) => {
      if (calView === 'due') {
        return task.due_date && task.due_date.startsWith(dateStr);
      } else {
        return task.created_at && task.created_at.startsWith(dateStr);
      }
    });
  };

  const isToday = (date: number, month: number, year: number) => {
    const t = new Date();
    return date === t.getDate() && month === t.getMonth() && year === t.getFullYear();
  };

  const navigateMonth = (dir: -1 | 1) => {
    let m = calMonth + dir;
    let y = calYear;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    setCalMonth(m);
    setCalYear(y);
  };

  const goToToday = () => {
    const t = new Date();
    setCalMonth(t.getMonth());
    setCalYear(t.getFullYear());
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Tasks</h1>
          <p className="mt-2 text-gray-600">
            Track and manage team tasks
          </p>
        </div>
        <Link
          to="/tasks/create"
          className="btn btn-primary mt-4 sm:mt-0 inline-flex items-center"
        >
          <Plus className="h-4 w-4 mr-2" />
          New Task
        </Link>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {[
            { key: 'my' as const, label: 'My Tasks', icon: UserIcon },
            { key: 'all' as const, label: 'All Tasks', icon: CheckCircle2 },
            { key: 'calendar' as const, label: 'Calendar', icon: CalendarDays },
            { key: 'activity' as const, label: 'Activity', icon: Activity },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => { setActiveTab(tab.key); setCurrentPage(1); }}
                className={`flex items-center py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab.key
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Icon className="h-4 w-4 mr-2" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Calendar Tab */}
      {activeTab === 'calendar' ? (
        <div className="space-y-4">
          {/* Calendar controls */}
          <div className="card p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => navigateMonth(-1)}
                  className="p-1.5 rounded-md border border-gray-300 text-gray-500 hover:bg-gray-50"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <h2 className="text-lg font-semibold text-gray-900 min-w-[180px] text-center">
                  {MONTH_NAMES[calMonth]} {calYear}
                </h2>
                <button
                  onClick={() => navigateMonth(1)}
                  className="p-1.5 rounded-md border border-gray-300 text-gray-500 hover:bg-gray-50"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <button
                  onClick={goToToday}
                  className="px-3 py-1.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Today
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">Show by:</span>
                <select
                  value={calView}
                  onChange={(e) => setCalView(e.target.value as 'due' | 'created')}
                  className="border border-gray-300 rounded-md text-sm py-1.5 px-3 focus:ring-primary-500 focus:border-primary-500"
                >
                  <option value="due">Due Date</option>
                  <option value="created">Created Date</option>
                </select>
              </div>
            </div>
          </div>

          {/* Calendar grid */}
          {calLoading ? (
            <div className="card p-8 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400 mx-auto" />
              <p className="text-sm text-gray-500 mt-2">Loading calendar...</p>
            </div>
          ) : (
            <div className="card overflow-hidden">
              {/* Day headers */}
              <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
                {DAYS_OF_WEEK.map((day) => (
                  <div key={day} className="py-2 px-2 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {day}
                  </div>
                ))}
              </div>

              {/* Day cells */}
              <div className="grid grid-cols-7">
                {getCalendarDays().map((day, idx) => {
                  const dayTasks = getTasksForDate(day.date, day.month, day.year);
                  const today = isToday(day.date, day.month, day.year);

                  return (
                    <div
                      key={idx}
                      className={`min-h-[100px] border-b border-r border-gray-100 p-1.5 ${
                        !day.isCurrentMonth ? 'bg-gray-50' : 'bg-white'
                      } ${idx % 7 === 0 ? 'border-l-0' : ''}`}
                    >
                      <div className={`text-xs font-medium mb-1 ${
                        today
                          ? 'bg-primary-600 text-white w-6 h-6 rounded-full flex items-center justify-center'
                          : day.isCurrentMonth ? 'text-gray-900' : 'text-gray-400'
                      }`}>
                        {today ? (
                          <span>{day.date}</span>
                        ) : (
                          <span className="pl-1">{day.date}</span>
                        )}
                      </div>
                      <div className="space-y-0.5">
                        {dayTasks.slice(0, 3).map((task) => {
                          const pCfg = priorityConfig[task.priority];
                          return (
                            <Link
                              key={task.id}
                              to={`/tasks/${task.id}`}
                              className={`block px-1.5 py-0.5 rounded text-xs truncate hover:opacity-80 transition-opacity ${
                                task.status === 'completed'
                                  ? 'bg-green-50 text-green-700 line-through'
                                  : `${pCfg.color}`
                              }`}
                              title={`${task.title} (${priorityConfig[task.priority].label} / ${statusConfig[task.status].label})`}
                            >
                              {task.title}
                            </Link>
                          );
                        })}
                        {dayTasks.length > 3 && (
                          <p className="text-xs text-gray-400 pl-1.5">+{dayTasks.length - 3} more</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Legend */}
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span className="font-medium">Priority:</span>
            {Object.entries(priorityConfig).map(([key, cfg]) => (
              <span key={key} className="flex items-center gap-1">
                <span className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
                {cfg.label}
              </span>
            ))}
            <span className="ml-2 flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-green-400" />
              Completed
            </span>
          </div>
        </div>
      ) : activeTab === 'activity' ? (
        /* Activity Tab */
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h2>
          {activityLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="animate-pulse flex items-start space-x-3">
                  <div className="h-8 w-8 bg-gray-300 rounded-full" />
                  <div className="flex-1 space-y-1">
                    <div className="h-4 bg-gray-300 rounded w-3/4" />
                    <div className="h-3 bg-gray-300 rounded w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : activity.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No activity yet</p>
          ) : (
            <div className="space-y-4">
              {activity.map((item) => (
                <div key={item.id} className="flex items-start space-x-3">
                  <Avatar name={item.user_name} avatar={item.user_avatar} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900">
                      <span className="font-medium">{item.user_name}</span>{' '}
                      {getActivityDescription(item)}
                      {item.task_title && (
                        <>
                          {' on '}
                          <Link to={`/tasks/${item.task_id}`} className="font-medium text-primary-600 hover:text-primary-700">
                            {item.task_title}
                          </Link>
                        </>
                      )}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">{formatTimeAgo(item.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Filters */}
          <div className="card p-4">
            <div className="flex flex-col lg:flex-row gap-3 items-start lg:items-center">
              {/* Search */}
              <form onSubmit={handleSearch} className="flex-1 w-full lg:max-w-xs">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search tasks..."
                    className="block w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>
              </form>

              {/* Status filter */}
              <select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}
                className="border border-gray-300 rounded-md text-sm py-2 px-3 focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
              </select>

              {/* Priority filter */}
              <select
                value={priorityFilter}
                onChange={(e) => { setPriorityFilter(e.target.value); setCurrentPage(1); }}
                className="border border-gray-300 rounded-md text-sm py-2 px-3 focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="">All Priorities</option>
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>

              {/* Sort */}
              <select
                value={sortBy}
                onChange={(e) => { setSortBy(e.target.value); setCurrentPage(1); }}
                className="border border-gray-300 rounded-md text-sm py-2 px-3 focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="due_date">Due Date</option>
                <option value="priority">Priority</option>
              </select>
            </div>
          </div>

          {/* Task List */}
          <div className="space-y-3">
            {isLoading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="card p-5 animate-pulse">
                    <div className="flex items-center space-x-4">
                      <div className="h-5 w-5 bg-gray-300 rounded" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-gray-300 rounded w-2/3" />
                        <div className="h-3 bg-gray-300 rounded w-1/3" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : tasks.length === 0 ? (
              <div className="card p-12 text-center">
                <CheckCircle2 className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No tasks found</h3>
                <p className="text-gray-500 mb-4">
                  {activeTab === 'my' ? "You don't have any tasks yet." : 'No tasks match your filters.'}
                </p>
                <Link to="/tasks/create" className="btn btn-primary inline-flex items-center">
                  <Plus className="h-4 w-4 mr-2" />
                  Create a Task
                </Link>
              </div>
            ) : (
              tasks.map((task) => {
                const statusCfg = statusConfig[task.status];
                const priorityCfg = priorityConfig[task.priority];
                const StatusIcon = statusCfg.icon;
                const dueInfo = formatDueDate(task.due_date);

                return (
                  <Link key={task.id} to={`/tasks/${task.id}`} className="card p-5 hover:shadow-md transition-shadow block">
                    <div className="flex items-start gap-4">
                      {/* Status Icon */}
                      <StatusIcon className={`h-5 w-5 mt-0.5 flex-shrink-0 ${
                        task.status === 'completed' ? 'text-green-500' :
                        task.status === 'in_progress' ? 'text-blue-500' : 'text-gray-400'
                      }`} />

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <h3 className={`text-base font-semibold ${
                            task.status === 'completed' ? 'text-gray-400 line-through' : 'text-gray-900'
                          }`}>
                            {task.title}
                          </h3>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${priorityCfg.color}`}>
                              {priorityCfg.label}
                            </span>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusCfg.color}`}>
                              {statusCfg.label}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-gray-500">
                          <span>{task.creator_name}</span>
                          <span>{formatTimeAgo(task.created_at)}</span>
                          {task.assignee_name && (
                            <span className="flex items-center">
                              <UserIcon className="h-3 w-3 mr-1" />
                              {task.assignee_name}
                            </span>
                          )}
                          {dueInfo && (
                            <span className={`flex items-center ${dueInfo.className}`}>
                              <Calendar className="h-3 w-3 mr-1" />
                              {dueInfo.text}
                            </span>
                          )}
                          {(task.comment_count || 0) > 0 && (
                            <span className="flex items-center">
                              <MessageCircle className="h-3 w-3 mr-1" />
                              {task.comment_count}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })
            )}
          </div>

          {/* Pagination */}
          {pagination.pages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-700">
                Showing {((currentPage - 1) * pagination.limit) + 1} to {Math.min(currentPage * pagination.limit, pagination.total)} of {pagination.total} tasks
              </p>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-2 rounded-md border border-gray-300 text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm text-gray-700">
                  Page {currentPage} of {pagination.pages}
                </span>
                <button
                  onClick={() => setCurrentPage(p => Math.min(pagination.pages, p + 1))}
                  disabled={currentPage === pagination.pages}
                  className="p-2 rounded-md border border-gray-300 text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default TasksPage;
