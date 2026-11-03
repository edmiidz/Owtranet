import axios from 'axios';
import { useAuthStore } from '../stores/authStore';
import type {
  MentionCandidate,
  SummonedAgent, 
  AuthResponse, 
  ApiResponse, 
  PaginatedResponse, 
  Post, 
  User, 
  Deliverable,
  EmailRequest,
  EmailRequestUpdateResult,
  Notification,
  GitHubIssue,
  SearchResults,
  GithubDoc,
  SearchAdapter,
  SearchAdapterRule,
  Quicklink,
  AgreementVersion,
  AgreementAssignment,
  AssignmentDetail,
  PayrollFormData,
  MaskedPayrollDetails,
  RevealedPayrollDetails,
  UserAgreement,
  Group,
  GroupChatMessage,
  Task,
  TaskComment,
  TaskActivity
} from '../types';

const API_BASE_URL = '/api';

// Create axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor to handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Check if this is an agreement requirement error
    if (error.response?.status === 403 && error.response?.data?.requiresAgreement) {
      // Don't logout for agreement requirement errors
      // The AgreementPage component will handle this
      return Promise.reject(error);
    }

    // Don't redirect if we're already on the login page or if this is a login attempt
    const isLoginPage = window.location.pathname === '/login';
    const isLoginEndpoint = error.config?.url?.includes('/auth/login');
    const isAuthEndpoint = error.config?.url?.startsWith('/auth/');

    // Handle other auth errors - but not for login attempts or when already on login page
    if (error.response?.status === 401 || error.response?.status === 403) {
      // Only logout and redirect if we're not on the login page and it's not a login/auth attempt
      if (!isLoginPage && !isLoginEndpoint && !isAuthEndpoint) {
        useAuthStore.getState().logout();
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authApi = {
  login: async (email: string, password: string): Promise<AuthResponse> => {
    const response = await api.post('/auth/login', { email, password });
    return response.data;
  },

  register: async (userData: {
    email: string;
    password: string;
    name: string;
    github_username?: string;
    company?: string;
    telephone?: string;
    invite_code?: string;
    invite_link?: string;
  }): Promise<ApiResponse<{ userId: number }>> => {
    const response = await api.post('/auth/register', userData);
    return response.data;
  },

  forgotPassword: async (email: string): Promise<ApiResponse<void>> => {
    const response = await api.post('/auth/forgot-password', { email });
    return response.data;
  },

  resetPassword: async (token: string, password: string): Promise<ApiResponse<void>> => {
    const response = await api.post('/auth/reset-password', { token, password });
    return response.data;
  },

  requestEmailLogin: async (email: string): Promise<{ message: string; showOtp: boolean; expiresIn: number }> => {
    const response = await api.post('/auth/email-login', { email });
    return response.data;
  },

  verifyEmailToken: async (tokenOrOtp: { token?: string; otp?: string }): Promise<AuthResponse> => {
    const response = await api.post('/auth/verify-email-token', tokenOrOtp);
    return response.data;
  },
};

// Posts API
export const postsApi = {
  getPosts: async (params?: {
    page?: number;
    limit?: number;
    search?: string;
    tag?: string;
    sort?: string;
    feed?: boolean;
  }): Promise<PaginatedResponse<Post>> => {
    const response = await api.get('/posts', { params });
    return response.data;
  },

  getPost: async (slug: string): Promise<Post> => {
    const response = await api.get(`/posts/${slug}`);
    return response.data;
  },

  getPostById: async (id: number): Promise<Post> => {
    const response = await api.get(`/posts/id/${id}`);
    return response.data;
  },

  createPost: async (postData: {
    title: string;
    content: string;
    tags?: string[];
    visibility?: 'all_members' | 'specific_members' | 'author_only';
    visible_to_users?: number[];
  }): Promise<{ postId: number; slug: string; message: string; visibility?: string; agentsSummoned?: SummonedAgent[] }> => {
    const response = await api.post('/posts', postData);
    return response.data;
  },

  updatePost: async (postId: number, postData: {
    title: string;
    content: string;
    tags?: string[];
    visibility?: 'all_members' | 'specific_members' | 'author_only';
    visible_to_users?: number[];
  }): Promise<{ message: string; postId: number; visibility?: string }> => {
    const response = await api.put(`/posts/${postId}`, postData);
    return response.data;
  },

  deletePost: async (postId: number): Promise<{ message: string; postId: number }> => {
    const response = await api.delete(`/posts/${postId}`);
    return response.data;
  },

  createComment: async (postId: number, commentData: {
    content: string;
    parentId?: number;
  }): Promise<{ commentId: number; message?: string; agentsSummoned?: SummonedAgent[] }> => {
    const response = await api.post(`/posts/${postId}/comments`, commentData);
    return response.data;
  },

  editComment: async (commentId: number, content: string): Promise<ApiResponse<void>> => {
    const response = await api.put(`/comments/${commentId}`, { content });
    return response.data;
  },

  deleteComment: async (commentId: number): Promise<ApiResponse<void>> => {
    const response = await api.delete(`/comments/${commentId}`);
    return response.data;
  },

  like: async (type: 'post' | 'comment', id: number, value: -1 | 0 | 1): Promise<ApiResponse<void>> => {
    const response = await api.post('/likes', { type, id, value });
    return response.data;
  },
};

// Deliverables API
export const deliverablesApi = {
  getDeliverables: async (params?: {
    status?: string;
    userId?: number;
  }): Promise<Deliverable[]> => {
    const response = await api.get('/deliverables', { params });
    return response.data;
  },

  createDeliverable: async (formData: FormData): Promise<ApiResponse<{ deliverableId: number }>> => {
    const response = await api.post('/deliverables', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  updateDeliverable: async (id: number, data: {
    status?: string;
    amount?: number;
    rejection_reason?: string;
  }): Promise<ApiResponse<void>> => {
    const response = await api.put(`/deliverables/${id}`, data);
    return response.data;
  },
};

// Email Requests API
export const emailRequestsApi = {
  getEmailRequests: async (): Promise<EmailRequest[]> => {
    const response = await api.get('/email-requests');
    return response.data;
  },

  createEmailRequest: async (data: {
    requested_email: string;
    justification: string;
  }): Promise<ApiResponse<{ requestId: number }>> => {
    const response = await api.post('/email-requests', data);
    return response.data;
  },

  updateEmailRequest: async (id: number, data: {
    status: 'approved' | 'rejected';
    rejection_reason?: string;
  }): Promise<EmailRequestUpdateResult> => {
    const response = await api.put(`/email-requests/${id}`, data);
    return response.data;
  },
};

// Users API
export const usersApi = {
  getUser: async (username: string): Promise<User> => {
    const response = await api.get(`/users/${username}`);
    return response.data;
  },

  updateUser: async (userId: number, data: {
    bio?: string;
    department?: string;
    position?: string;
    company?: string;
    other_emails?: string;
  }): Promise<ApiResponse<void>> => {
    const response = await api.put(`/users/${userId}`, data);
    return response.data;
  },

  uploadAvatar: async (userId: number, file: File): Promise<{ avatar_url: string; message: string }> => {
    const formData = new FormData();
    formData.append('avatar', file);
    const response = await api.post(`/users/${userId}/avatar`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  getUsers: async (): Promise<User[]> => {
    const response = await api.get('/users');
    return response.data;
  },

  getAllUsers: async (): Promise<User[]> => {
    // Admin-only endpoint with full user details
    const response = await api.get('/admin/users');
    return response.data;
  },

  // @mention dropdown: people + AI agents. An empty query lists the agents
  // and the most recently active people.
  searchUsers: async (query: string): Promise<MentionCandidate[]> => {
    const response = await api.get('/users/search', { params: { q: query } });
    return response.data;
  },

  updateUserRole: async (userId: number, role: string): Promise<ApiResponse<void>> => {
    const response = await api.put(`/admin/users/${userId}/role`, { role });
    return response.data;
  },

  updateUserHourlyRate: async (userId: number, hourlyRate: number | null): Promise<ApiResponse<void>> => {
    const response = await api.put(`/admin/users/${userId}/hourly-rate`, { hourly_rate: hourlyRate });
    return response.data;
  },

  requestAgreement: async (userId: number): Promise<{
    message: string;
    agreement_version: string;
    user_name: string;
  }> => {
    const response = await api.post(`/admin/users/${userId}/request-agreement`);
    return response.data;
  },
};

// GitHub API
export const githubApi = {
  syncIssues: async (): Promise<ApiResponse<void>> => {
    const response = await api.post('/github/sync');
    return response.data;
  },

  getUserIssues: async (username: string): Promise<GitHubIssue[]> => {
    const response = await api.get(`/github/issues/${username}`);
    return response.data;
  },
};

// Notifications API
export const notificationsApi = {
  getNotifications: async (): Promise<Notification[]> => {
    const response = await api.get('/notifications');
    return response.data;
  },

  markAsRead: async (id: number): Promise<ApiResponse<void>> => {
    const response = await api.put(`/notifications/${id}/read`);
    return response.data;
  },

  markAllAsRead: async (): Promise<ApiResponse<{ updated_count: number }>> => {
    const response = await api.put('/notifications/mark-all-read');
    return response.data;
  },
};

// Group Chat API
export const groupChatApi = {
  getUserGroups: async (): Promise<Group[]> => {
    const response = await api.get('/group-chat/groups');
    return response.data;
  },

  getMessages: async (groupId: number, page = 1): Promise<GroupChatMessage[]> => {
    const response = await api.get(`/group-chat/${groupId}/messages`, {
      params: { page, limit: 50 }
    });
    return response.data;
  },

  sendMessage: async (groupId: number, content: string, replyToId?: number): Promise<ApiResponse<{ messageId: number }>> => {
    const response = await api.post(`/group-chat/${groupId}/messages`, {
      content,
      reply_to_id: replyToId
    });
    return response.data;
  },

  markAsRead: async (groupId: number, messageId: number): Promise<ApiResponse<void>> => {
    const response = await api.put(`/group-chat/${groupId}/read`, { messageId });
    return response.data;
  },

  likeMessage: async (groupId: number, messageId: number): Promise<{ liked: boolean; total_likes: number; user_liked: boolean }> => {
    const response = await api.post(`/group-chat/${groupId}/messages/${messageId}/like`);
    return response.data;
  },
};

// Search API
export const searchApi = {
  search: async (query: string, type?: string): Promise<SearchResults> => {
    const response = await api.get('/search', { params: { q: query, type } });
    return response.data;
  },
};

// GitHub-hosted docs surfaced in search. Only the container-page metadata is
// ever fetched; the document itself is read at the doc's access_url.
// Search Adapters (admin only). Note there is deliberately no token field
// anywhere in this API — adapters reference a .env variable by name.
export const searchAdaptersApi = {
  list: async (): Promise<SearchAdapter[]> => {
    const response = await api.get('/search-adapters');
    return response.data;
  },
  create: async (data: Partial<SearchAdapter> & { rules: SearchAdapterRule[] }): Promise<{ id: number }> => {
    const response = await api.post('/search-adapters', data);
    return response.data;
  },
  update: async (id: number, data: Partial<SearchAdapter> & { rules?: SearchAdapterRule[] }): Promise<void> => {
    await api.put(`/search-adapters/${id}`, data);
  },
  remove: async (id: number): Promise<{ documents_removed: number }> => {
    const response = await api.delete(`/search-adapters/${id}`);
    return response.data;
  },
  check: async (id: number): Promise<{ ok: boolean; reason: string }> => {
    const response = await api.post(`/search-adapters/${id}/check`);
    return response.data;
  },
};

export const githubDocsApi = {
  get: async (id: number | string): Promise<GithubDoc> => {
    const response = await api.get(`/github-docs/${id}`);
    return response.data;
  },
};

// Invites API
export const invitesApi = {
  createInvite: async (data: {
    email?: string;
    name?: string;
    expires_days?: number;
  }): Promise<{ inviteId: number; code: string; url: string; expires_at: string }> => {
    const response = await api.post('/invites', data);
    return response.data;
  },

  getInvites: async (): Promise<any[]> => {
    const response = await api.get('/invites');
    return response.data;
  },

  validateInvite: async (code: string): Promise<{
    valid: boolean;
    email?: string;
    name?: string;
    expires_at: string;
  }> => {
    const response = await api.get(`/invites/${code}/validate`);
    return response.data;
  },

  resendInvite: async (id: number): Promise<{ message: string }> => {
    const response = await api.post(`/invites/${id}/resend`);
    return response.data;
  },

  deleteInvite: async (id: number): Promise<{ message: string }> => {
    const response = await api.delete(`/invites/${id}`);
    return response.data;
  },
};

// Messages API
export const messagesApi = {
  getConversations: async (): Promise<any[]> => {
    const response = await api.get('/messages/conversations');
    return response.data;
  },

  getMessages: async (conversationId: number): Promise<any[]> => {
    const response = await api.get(`/messages/conversations/${conversationId}`);
    return response.data;
  },

  sendMessage: async (data: {
    recipient_id: number;
    content: string;
    reply_to_id?: number;
  }): Promise<{
    message: string;
    conversation_id: number;
    data: any;
    agent_replying?: boolean;
  }> => {
    const response = await api.post('/messages/send', data);
    return response.data;
  },

  markAsRead: async (conversationId: number): Promise<{ message: string }> => {
    const response = await api.put(`/messages/conversations/${conversationId}/read`);
    return response.data;
  },

  getUnreadCount: async (): Promise<{ unread_count: number }> => {
    const response = await api.get('/messages/unread-count');
    return response.data;
  },
};

// Quicklinks API
export const quicklinksApi = {
  getQuicklinks: async (): Promise<Quicklink[]> => {
    const response = await api.get('/quicklinks');
    return response.data;
  },

  getAdminQuicklinks: async (): Promise<Quicklink[]> => {
    const response = await api.get('/admin/quicklinks');
    return response.data;
  },

  createQuicklink: async (data: {
    title: string;
    url: string;
    description?: string;
    display_order?: number;
  }): Promise<Quicklink> => {
    const response = await api.post('/admin/quicklinks', data);
    return response.data;
  },

  updateQuicklink: async (id: number, data: {
    title: string;
    url: string;
    description?: string;
    display_order?: number;
    is_active?: boolean;
  }): Promise<Quicklink> => {
    const response = await api.put(`/admin/quicklinks/${id}`, data);
    return response.data;
  },

  deleteQuicklink: async (id: number): Promise<void> => {
    await api.delete(`/admin/quicklinks/${id}`);
  },
};

// Agreements API
export const agreementsApi = {
  getCurrentAgreement: async (): Promise<AgreementVersion> => {
    // Use fetch directly since this endpoint doesn't require authentication
    const response = await fetch('/api/agreements/current');
    if (!response.ok) {
      throw new Error('Failed to fetch current agreement');
    }
    return response.json();
  },

  getAgreementStatus: async (): Promise<{
    has_signed: boolean;
    current_version: string;
    agreement_details: UserAgreement | null;
  }> => {
    const response = await api.get('/agreements/status');
    return response.data;
  },

  signAgreement: async (data: {
    full_name: string;
    email: string;
    quiz_answer: string;
    digital_signature: string;
    confirmations?: Record<string, boolean>;
  }): Promise<{ message: string; version: string; token?: string; user?: User }> => {
    const response = await api.post('/agreements/sign', data);
    return response.data;
  },

  getUserAgreements: async (userId: number): Promise<UserAgreement[]> => {
    const response = await api.get(`/agreements/user/${userId}`);
    return response.data;
  },

  getAgreementVersions: async (): Promise<AgreementVersion[]> => {
    const response = await api.get('/admin/agreements/versions');
    return response.data;
  },

  createAgreementVersion: async (data: {
    version: string;
    title: string;
    content: string;
    agreement_type?: 'team' | 'employment' | 'custom';
    quiz_question?: string;
    quiz_correct_answer?: string;
    required_fields?: string[];
    confirmations?: { key: string; label: string }[];
    assign_to_user_ids?: number[];
  }): Promise<AgreementVersion> => {
    const response = await api.post('/admin/agreements/versions', data);
    return response.data;
  },

  // Per-user assignments (custom/employment agreements)
  getMyAssignments: async (): Promise<AgreementAssignment[]> => {
    const response = await api.get('/agreements/mine');
    return response.data;
  },

  getAssignment: async (assignmentId: number | string): Promise<AssignmentDetail> => {
    const response = await api.get(`/agreements/assignment/${assignmentId}`);
    return response.data;
  },

  signAssignment: async (assignmentId: number | string, data: {
    full_name: string;
    email: string;
    quiz_answer?: string;
    digital_signature: string;
    confirmations: Record<string, boolean>;
    payroll?: PayrollFormData;
  }): Promise<{ message: string; version: string; title: string; payroll_details_saved: boolean }> => {
    const response = await api.post(`/agreements/assignment/${assignmentId}/sign`, data);
    return response.data;
  },

  assignVersionToUsers: async (versionId: number, userIds: number[]): Promise<{ results: any[] }> => {
    const response = await api.post(`/admin/agreements/versions/${versionId}/assign`, { user_ids: userIds });
    return response.data;
  },

  cancelAssignment: async (versionId: number, userId: number): Promise<{ message: string }> => {
    const response = await api.delete(`/admin/agreements/versions/${versionId}/assign/${userId}`);
    return response.data;
  },

  getVersionAssignments: async (versionId: number): Promise<any[]> => {
    const response = await api.get(`/admin/agreements/versions/${versionId}/assignments`);
    return response.data;
  },
};

// Payroll details API (SIN/banking — encrypted server-side, masked on read)
export const payrollApi = {
  getMine: async (): Promise<{ payroll: MaskedPayrollDetails | null }> => {
    const response = await api.get('/users/me/payroll-details');
    return response.data;
  },

  updateMine: async (payroll: PayrollFormData): Promise<{ message: string; payroll: MaskedPayrollDetails }> => {
    const response = await api.put('/users/me/payroll-details', { payroll });
    return response.data;
  },

  // Admin only; every call is written to the payroll access log
  adminReveal: async (userId: number): Promise<{ payroll: RevealedPayrollDetails; access_logged: boolean }> => {
    const response = await api.get(`/admin/users/${userId}/payroll-details`);
    return response.data;
  },
};

// Corporate Radio — TTS summaries of posts
export interface RadioSegmentInfo {
  segment_id: number; headline: string; tts_text: string; word_count: number | null; est_duration_secs: number | null;
  model: string | null; status: 'ready' | 'failed'; error?: string | null; generated_at: string; updated_at: string; heard: boolean; listened_at?: string | null;
  is_manual?: boolean; edited_by?: number | null; edited_by_name?: string | null;
  comment_count?: number; current_comment_count?: number;
}
export interface RadioPostInfo {
  id: number; slug: string; title: string; created_at: string; updated_at: string;
  author: { id: number; name: string; avatar_url?: string | null; username?: string | null }; can_regenerate: boolean;
}
export const radioApi = {
  getForPost: async (slug: string): Promise<{ post: RadioPostInfo; station: string; segment: RadioSegmentInfo }> => {
    const response = await api.get(`/radio/posts/by-slug/${encodeURIComponent(slug)}`);
    return response.data;
  },
  regenerate: async (postId: number): Promise<RadioSegmentInfo & { ok: boolean; post_id: number }> => {
    const response = await api.post(`/radio/posts/${postId}/regenerate`);
    return response.data;
  },
  saveSegment: async (postId: number, data: { headline: string; tts_text: string }): Promise<RadioSegmentInfo & { ok: boolean }> => {
    const response = await api.put(`/radio/posts/${postId}/segment`, data);
    return response.data;
  },
  status: async (): Promise<any> => (await api.get('/radio/status')).data,
};

// Test API
export const testApi = {
  test: async (): Promise<{ status: string; userCount: number; message: string }> => {
    const response = await api.get('/test');
    return response.data;
  },
};

export const tasksApi = {
  getTasks: async (params?: {
    page?: number;
    limit?: number;
    status?: string;
    priority?: string;
    assigned_to?: number;
    search?: string;
    sort?: string;
    view?: string;
  }): Promise<{ tasks: Task[]; pagination: { page: number; limit: number; total: number; pages: number } }> => {
    const response = await api.get('/tasks', { params });
    return response.data;
  },

  getTask: async (id: number): Promise<Task> => {
    const response = await api.get(`/tasks/${id}`);
    return response.data;
  },

  createTask: async (data: {
    title: string;
    description?: string;
    priority?: string;
    status?: string;
    due_date?: string | null;
    assigned_to?: number | null;
  }): Promise<{ message: string; taskId: number }> => {
    const response = await api.post('/tasks', data);
    return response.data;
  },

  updateTask: async (id: number, data: {
    title?: string;
    description?: string;
    priority?: string;
    status?: string;
    due_date?: string | null;
    assigned_to?: number | null;
  }): Promise<{ message: string; taskId: number }> => {
    const response = await api.put(`/tasks/${id}`, data);
    return response.data;
  },

  deleteTask: async (id: number): Promise<{ message: string }> => {
    const response = await api.delete(`/tasks/${id}`);
    return response.data;
  },

  getComments: async (taskId: number): Promise<{ comments: TaskComment[] }> => {
    const response = await api.get(`/tasks/${taskId}/comments`);
    return response.data;
  },

  createComment: async (taskId: number, content: string): Promise<{ message: string; comment: TaskComment }> => {
    const response = await api.post(`/tasks/${taskId}/comments`, { content });
    return response.data;
  },

  deleteComment: async (commentId: number): Promise<{ message: string }> => {
    const response = await api.delete(`/tasks/comments/${commentId}`);
    return response.data;
  },

  getActivity: async (taskId: number): Promise<{ activity: TaskActivity[] }> => {
    const response = await api.get(`/tasks/${taskId}/activity`);
    return response.data;
  },

  getActivityFeed: async (params?: { page?: number; limit?: number }): Promise<{ activity: TaskActivity[] }> => {
    const response = await api.get('/tasks/activity', { params });
    return response.data;
  },

  getUsers: async (): Promise<{ users: Array<{ id: number; name: string; intranet_username?: string; avatar_url?: string }> }> => {
    const response = await api.get('/tasks/users');
    return response.data;
  },
};

export default api;
// Badge counts (shared with the mobile app's tab badges)
export interface BadgeCounts {
  unread_notifications: number;
  unread_messages: number;
  unread_group_messages: number;
  pending_agreements: number;
  open_tasks: number;
  radio_unheard: number;
}

export const badgesApi = {
  getCounts: async (): Promise<BadgeCounts> => {
    const response = await api.get('/mobile/counts');
    return response.data;
  },
};
