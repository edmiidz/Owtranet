import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Home,
  MessageSquare,
  DollarSign,
  Mail,
  Settings,
  Search,
  Bell,
  LogOut,
  Menu,
  X,
  MessageCircle,
  User,
  XCircle,
  Users,
  Receipt,
  CheckSquare
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useBrandingStore } from '../stores/brandingStore';
import { usesSelfHostedMail } from '../utils/emailProvider';
import { notificationsApi, badgesApi, type BadgeCounts } from '../utils/api';
import { BADGES_CHANGED_EVENT } from '../utils/badges';
import { notificationHref } from '../utils/notifications';
import type { Notification } from '../types';

const COUNTS_POLL_MS = 30000;

const EMPTY_COUNTS: BadgeCounts = {
  unread_notifications: 0,
  unread_messages: 0,
  unread_group_messages: 0,
  pending_agreements: 0,
  open_tasks: 0,
  radio_unheard: 0,
};

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
}

const Badge: React.FC<{ count: number; className?: string }> = ({ count, className = '' }) => {
  if (count <= 0) return null;
  return (
    <span
      className={`bg-red-500 text-white text-xs font-semibold rounded-full min-w-[1.25rem] h-5 px-1.5 flex items-center justify-center ${className}`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
};

const formatWhen = (iso: string): string => {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const Layout: React.FC = () => {
  const { baseUrl, defaultEmailProvider } = useBrandingStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [quickSearchQuery, setQuickSearchQuery] = useState('');
  const [counts, setCounts] = useState<BadgeCounts>(EMPTY_COUNTS);
  const [showUsernameNotification, setShowUsernameNotification] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const { user, logout } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const userId = user?.id;
  const lastUnreadRef = useRef<number | null>(null);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleQuickSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (quickSearchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(quickSearchQuery.trim())}`);
      setQuickSearchQuery('');
    }
  };

  // One request refreshes every badge (bell, Messages, Group Chat).
  const refreshCounts = useCallback(async () => {
    if (!userId || document.hidden) return;
    try {
      setCounts(await badgesApi.getCounts());
    } catch {
      // keep the last known counts; the next poll will retry
    }
  }, [userId]);

  const loadNotifications = useCallback(async () => {
    if (!userId) return;
    setNotificationsLoading(true);
    try {
      setNotifications(await notificationsApi.getNotifications());
    } catch (error) {
      console.error('Failed to load notifications:', error);
    } finally {
      setNotificationsLoading(false);
    }
  }, [userId]);

  // Poll counts while the tab is visible; refresh immediately when it becomes
  // visible again or when a page reports it changed something.
  useEffect(() => {
    if (!userId) return;
    refreshCounts();
    const timer = setInterval(refreshCounts, COUNTS_POLL_MS);
    const onWake = () => { if (!document.hidden) refreshCounts(); };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    window.addEventListener(BADGES_CHANGED_EVENT, onWake);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
      window.removeEventListener(BADGES_CHANGED_EVENT, onWake);
    };
  }, [userId, refreshCounts]);

  // Navigating usually means something was read; refresh once per route.
  useEffect(() => {
    refreshCounts();
  }, [location.pathname, refreshCounts]);

  // Reload the list when the unread count moves so the dropdown is never stale.
  useEffect(() => {
    if (lastUnreadRef.current !== null && lastUnreadRef.current !== counts.unread_notifications) {
      loadNotifications();
    }
    lastUnreadRef.current = counts.unread_notifications;
  }, [counts.unread_notifications, loadNotifications]);

  const openNotifications = () => {
    const next = !showNotifications;
    setShowNotifications(next);
    if (next) loadNotifications();
  };

  useEffect(() => {
    if (!showNotifications) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowNotifications(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showNotifications]);

  const markNotificationAsRead = async (id: number) => {
    const target = notifications.find(n => n.id === id);
    if (!target || target.is_read) return;
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    setCounts(prev => ({ ...prev, unread_notifications: Math.max(0, prev.unread_notifications - 1) }));
    try {
      await notificationsApi.markAsRead(id);
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
      refreshCounts();
    }
  };

  const markAllNotificationsAsRead = async () => {
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setCounts(prev => ({ ...prev, unread_notifications: 0 }));
    try {
      await notificationsApi.markAllAsRead();
    } catch (error) {
      console.error('Failed to mark all notifications as read:', error);
      refreshCounts();
    }
  };

  const handleNotificationClick = (notification: Notification) => {
    markNotificationAsRead(notification.id);
    const href = notificationHref(notification);
    setShowNotifications(false);
    if (href) navigate(href);
  };

  // Check if user needs to set intranet username
  useEffect(() => {
    if (user && !user.intranet_username && user.role === 'user') {
      setShowUsernameNotification(true);
    }
  }, [user]);

  const baseNavigation: NavItem[] = [
    { name: 'Dashboard', href: '/dashboard', icon: Home },
    { name: 'Forum', href: '/forum', icon: MessageSquare },
    { name: 'Tasks', href: '/tasks', icon: CheckSquare },
    { name: 'Messages', href: '/messages', icon: MessageCircle, badge: counts.unread_messages },
    { name: 'Group Chat', href: '/group-chat', icon: Users, badge: counts.unread_group_messages },
    { name: 'Investment Tracker', href: '/investment-tracker', icon: DollarSign },
    { name: 'Ledger', href: '/ledger', icon: Receipt },
    { name: 'Email Request', href: '/email-request', icon: Mail },
    { name: 'Search', href: '/search', icon: Search },
  ];

  // Webmail exists only for the self-hosted mail provider; Email Request works for every provider
  const selfHostedMail = usesSelfHostedMail(user, defaultEmailProvider);

  // Hide Email Request once the user has a company address
  const navigation = baseNavigation.filter(item => !(item.name === 'Email Request' && user?.company_email));

  // Add webmail for self-hosted members with a company mailbox
  if (selfHostedMail && user?.company_email) {
    const webmailIndex = navigation.findIndex(item => item.name === 'Search');
    if (webmailIndex > -1) {
      navigation.splice(webmailIndex, 0, { name: 'Webmail', href: '/webmail', icon: Mail });
    }
  }

  const adminNavigation: NavItem[] = [
    { name: 'Admin Panel', href: '/admin', icon: Settings },
  ];

  const isActive = (href: string) => {
    return location.pathname === href || location.pathname.startsWith(href + '/');
  };

  const pageTitle = [...navigation, ...adminNavigation].find(item => isActive(item.href))?.name || '';

  const renderNavLink = (item: NavItem) => {
    const Icon = item.icon;
    return (
      <Link
        key={item.name}
        to={item.href}
        className={`
          group flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-colors
          ${isActive(item.href)
            ? 'bg-primary-100 text-primary-700'
            : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
          }
        `}
        onClick={() => setSidebarOpen(false)}
      >
        <Icon className="mr-3 h-5 w-5" />
        <span className="flex-1">{item.name}</span>
        {item.badge !== undefined && <Badge count={item.badge} className="ml-2" />}
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-gray-600 bg-opacity-75 lg:hidden z-40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-white shadow-lg transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:flex-shrink-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex items-center justify-between h-16 px-6 border-b border-gray-200">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <a 
                href={baseUrl || '/dashboard'} 
                className="text-xl font-bold text-gray-900 hover:text-blue-600 transition-colors"
              >
                The Intranet
              </a>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-gray-500 hover:text-gray-700"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="flex flex-col h-full">
          <nav className="px-4 py-6 space-y-1">
            {navigation.map(renderNavLink)}

            {/* Admin navigation */}
            {user?.role === 'admin' && (
              <div className="pt-2 mt-2 border-t border-gray-200">
                <p className="px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Administration
                </p>
                <div className="mt-2 space-y-1">
                  {adminNavigation.map(renderNavLink)}
                </div>
              </div>
            )}

            {/* User section */}
            <div className="pt-2 mt-2 border-t border-gray-200 px-3">
              <div className="flex items-center">
              <div className="flex-shrink-0">
                {user?.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt={`${user.name} profile`}
                    className="h-8 w-8 rounded-full object-cover"
                  />
                ) : (
                  <div className="h-8 w-8 rounded-full bg-primary-500 flex items-center justify-center">
                    <span className="text-sm font-medium text-white">
                      {user?.name?.charAt(0) || user?.email?.charAt(0)}
                    </span>
                  </div>
                )}
              </div>
              <div className="ml-3 flex-1">
                <Link
                  to={`/profile/${user?.intranet_username || `id:${user?.id}`}`}
                  className="text-sm font-medium text-gray-900 hover:text-primary-600"
                >
                  {user?.name}
                </Link>
                <p className="text-xs text-gray-500">{user?.role}</p>
              </div>
                <button
                  onClick={handleLogout}
                  className="ml-3 text-gray-400 hover:text-gray-600"
                  title="Logout"
                >
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            </div>
          </nav>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 lg:ml-0">
        {/* Top bar */}
        <div className="sticky top-0 z-30 bg-white shadow-sm border-b border-gray-200">
          <div className="flex items-center justify-between h-16 px-4 sm:px-6 lg:px-8">
            <div className="flex items-center">
              {/* Mobile menu button */}
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden relative text-gray-500 hover:text-gray-700"
                title="Open menu"
              >
                <Menu className="h-6 w-6" />
                {(counts.unread_messages + counts.unread_group_messages) > 0 && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full" />
                )}
              </button>
              
              {/* Desktop title area */}
              <div className="hidden lg:block">
                <h1 className="text-lg font-semibold text-gray-900">{pageTitle}</h1>
              </div>
            </div>

            <div className="flex items-center space-x-4">
              {/* Quick Search */}
              <form onSubmit={handleQuickSearch} className="hidden md:flex items-center no-print">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-gray-400" />
                  </div>
                  <input
                    type="text"
                    value={quickSearchQuery}
                    onChange={(e) => setQuickSearchQuery(e.target.value)}
                    placeholder="Quick search..."
                    className="block w-64 pl-9 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-sm"
                  />
                </div>
              </form>
              
              {/* Username Setup Notification */}
              {showUsernameNotification && (
                <div className="relative flex items-center space-x-1">
                  <Link
                    to={`/profile/id:${user?.id}`}
                    className="relative text-orange-500 hover:text-orange-600 z-10" 
                    title="Set your Intranet username"
                  >
                    <User className="h-6 w-6" />
                    <span className="absolute -top-1 -right-1 bg-orange-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                      !
                    </span>
                  </Link>
                  <button
                    onClick={() => setShowUsernameNotification(false)}
                    className="text-gray-400 hover:text-gray-600 ml-1"
                    title="Dismiss notification"
                  >
                    <XCircle className="h-3 w-3" />
                  </button>
                </div>
              )}

              {/* Notifications (bell) */}
              <div className="relative">
                <button 
                  onClick={openNotifications}
                  className="relative text-gray-400 hover:text-gray-600" 
                  title={`Notifications${counts.unread_notifications > 0 ? ` (${counts.unread_notifications} unread)` : ''}`}
                  aria-haspopup="true"
                  aria-expanded={showNotifications}
                >
                  <Bell className="h-6 w-6" />
                  <Badge count={counts.unread_notifications} className="absolute -top-1.5 -right-1.5" />
                </button>

                {showNotifications && (
                  <>
                    <div 
                      className="fixed inset-0 z-10" 
                      onClick={() => setShowNotifications(false)}
                    />
                    
                    <div className="absolute right-0 mt-2 w-[22rem] sm:w-96 bg-white rounded-lg shadow-lg border border-gray-200 z-20 max-h-[70vh] overflow-y-auto">
                      <div className="p-4 border-b border-gray-100 flex justify-between items-center sticky top-0 bg-white">
                        <h3 className="text-lg font-medium text-gray-900">Notifications</h3>
                        {counts.unread_notifications > 0 && (
                          <button
                            onClick={markAllNotificationsAsRead}
                            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                          >
                            Mark all read
                          </button>
                        )}
                      </div>
                      
                      {notifications.length === 0 ? (
                        <div className="p-6 text-center text-gray-500">
                          {notificationsLoading ? 'Loading…' : 'No notifications'}
                        </div>
                      ) : (
                        <div className="divide-y divide-gray-100">
                          {notifications.slice(0, 20).map((notification) => {
                            const href = notificationHref(notification);
                            return (
                              <button
                                type="button"
                                key={notification.id}
                                className={`w-full text-left p-4 hover:bg-gray-50 ${!notification.is_read ? 'bg-blue-50' : ''} ${href ? 'cursor-pointer' : 'cursor-default'}`}
                                onClick={() => handleNotificationClick(notification)}
                              >
                                <div className="flex items-start">
                                  <div className="flex-1 min-w-0">
                                    <p className={`text-sm ${!notification.is_read ? 'font-semibold text-gray-900' : 'text-gray-900'}`}>
                                      {notification.title}
                                    </p>
                                    {notification.message && (
                                      <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                                        {notification.message}
                                      </p>
                                    )}
                                    <p className="text-xs text-gray-400 mt-2">
                                      {formatWhen(notification.created_at)}
                                    </p>
                                  </div>
                                  {!notification.is_read && (
                                    <div className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0 ml-2 mt-1" />
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Page content */}
        <main className="flex-1">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};

export default Layout;
