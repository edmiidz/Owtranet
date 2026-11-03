import { api } from './client';
import type {
  AgreementAssignment, AgreementVersion, AssignmentDetail, Bootstrap, Comment, Conversation, Counts, Deliverable,
  DirectMessage, Group, GroupChatMessage, HomeData, LedgerEntry, Notification, Post, Pagination, RadioFeed, SearchResults,
  User, UserAgreement, AiSession, Task, TaskComment, TaskUser, TaskStatus, TaskPriority
} from './types';

export const authApi = {
  login: (email: string, password: string) => api.post<{ token: string; user: User }>('/auth/login', { email, password }).then(r => r.data),
  requestEmailLogin: (email: string) => api.post<{ message: string; showOtp: boolean }>('/auth/email-login', { email }).then(r => r.data),
  verifyOtp: (otp: string) => api.post<{ token: string; user: User }>('/auth/verify-email-token', { otp }).then(r => r.data),
  forgotPassword: (email: string) => api.post('/auth/forgot-password', { email }).then(r => r.data),
};

export const mobileApi = {
  config: (workspaceUrl: string) => api.get(`${workspaceUrl.replace(/\/$/, '')}/api/mobile/config`).then(r => r.data),
  bootstrap: () => api.get<Bootstrap>('/mobile/bootstrap').then(r => r.data),
  counts: () => api.get<Counts>('/mobile/counts').then(r => r.data),
  home: () => api.get<HomeData>('/mobile/home').then(r => r.data),
  registerDevice: (body: { push_token: string; platform: string; device_name?: string; app_version?: string }) => api.post('/mobile/devices', body).then(r => r.data),
  unregisterDevice: (token: string) => api.delete(`/mobile/devices/${encodeURIComponent(token)}`).then(r => r.data),
};

export const radioApi = {
  feed: (params: { days?: number; limit?: number; unheard?: 0 | 1 }) => api.get<RadioFeed>('/radio/feed', { params }).then(r => r.data),
  listened: (segmentId: number, completed = true) => api.post(`/radio/segments/${segmentId}/listened`, { completed }).then(r => r.data),
  reset: () => api.post('/radio/listens/reset').then(r => r.data),
  status: () => api.get('/radio/status').then(r => r.data),
  regenerate: (postId: number) => api.post(`/radio/posts/${postId}/regenerate`).then(r => r.data),
};

export const postsApi = {
  list: (params: { page?: number; limit?: number; search?: string; tag?: string; sort?: string }) =>
    api.get<{ posts: Post[]; pagination: Pagination }>('/posts', { params }).then(r => r.data),
  get: (slug: string) => api.get<Post>(`/posts/${slug}`).then(r => r.data),
  create: (body: { title: string; content: string; tags?: string[]; visibility?: string; visible_to_users?: number[]; attachment_filename?: string }) =>
    api.post<{ postId: number; slug: string; message: string }>('/posts', body).then(r => r.data),
  update: (id: number, body: { title: string; content: string; tags?: string[]; visibility?: string; visible_to_users?: number[] }) =>
    api.put(`/posts/${id}`, body).then(r => r.data),
  remove: (id: number) => api.delete(`/posts/${id}`).then(r => r.data),
  comment: (postId: number, content: string, parentId?: number) => api.post(`/posts/${postId}/comments`, { content, parentId }).then(r => r.data),
  deleteComment: (id: number) => api.delete(`/comments/${id}`).then(r => r.data),
  like: (type: 'post' | 'comment', id: number, value: -1 | 0 | 1) => api.post('/likes', { type, id, value }).then(r => r.data),
  tags: () => api.get<Array<{ id: number; name: string; slug: string; usage_count?: number }>>('/tags').then(r => r.data),
  uploadAttachment: (form: FormData) => api.post('/posts/attachment', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data),
};

export const usersApi = {
  list: () => api.get<User[]>('/users').then(r => r.data),
  get: (username: string) => api.get<User>(`/users/${username}`).then(r => r.data),
  search: (q: string) => api.get<Array<{ id: number; name: string; github_username?: string; avatar_url?: string }>>('/users/search', { params: { q } }).then(r => r.data),
  update: (id: number, body: Partial<Pick<User, 'bio' | 'department' | 'position' | 'company' | 'telephone' | 'calendar_link'>>) => api.put(`/users/${id}`, body).then(r => r.data),
  uploadAvatar: (id: number, form: FormData) => api.post<{ avatar_url: string }>(`/users/${id}/avatar`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data),
  changePassword: (id: number, currentPassword: string, newPassword: string) => api.put(`/users/${id}/password`, { currentPassword, newPassword }).then(r => r.data),
};

export const notificationsApi = {
  list: () => api.get<Notification[]>('/notifications').then(r => r.data),
  markRead: (id: number) => api.put(`/notifications/${id}/read`).then(r => r.data),
  markAllRead: () => api.put('/notifications/mark-all-read').then(r => r.data),
};

export const tasksApi = {
  list: (params?: { page?: number; limit?: number; status?: TaskStatus; priority?: TaskPriority; assigned_to?: number; search?: string; sort?: 'newest' | 'oldest' | 'due_date' | 'priority'; view?: 'all' | 'mine' }) =>
    api.get<{ tasks: Task[]; pagination: Pagination }>('/tasks', { params }).then(r => r.data),
  get: (id: number) => api.get<Task>(`/tasks/${id}`).then(r => r.data),
  create: (body: { title: string; description?: string; priority?: TaskPriority; status?: TaskStatus; due_date?: string | null; assigned_to?: number | null }) =>
    api.post<{ message: string; taskId: number }>('/tasks', body).then(r => r.data),
  update: (id: number, body: Partial<{ title: string; description: string; priority: TaskPriority; status: TaskStatus; due_date: string | null; assigned_to: number | null }>) =>
    api.put(`/tasks/${id}`, body).then(r => r.data),
  remove: (id: number) => api.delete(`/tasks/${id}`).then(r => r.data),
  users: () => api.get<{ users: TaskUser[] }>('/tasks/users').then(r => r.data.users),
  comments: (id: number) => api.get<{ comments: TaskComment[] }>(`/tasks/${id}/comments`).then(r => r.data.comments),
  comment: (id: number, content: string) => api.post<{ comment: TaskComment }>(`/tasks/${id}/comments`, { content }).then(r => r.data.comment),
  deleteComment: (commentId: number) => api.delete(`/tasks/comments/${commentId}`).then(r => r.data),
};

export const messagesApi = {
  conversations: () => api.get<Conversation[]>('/messages/conversations').then(r => r.data),
  messages: (conversationId: number) => api.get<DirectMessage[]>(`/messages/conversations/${conversationId}`).then(r => r.data),
  send: (recipient_id: number, content: string, reply_to_id?: number) => api.post<{ conversation_id: number; data: DirectMessage; agent_replying?: boolean }>('/messages/send', { recipient_id, content, reply_to_id }).then(r => r.data),
  markRead: (conversationId: number) => api.put(`/messages/conversations/${conversationId}/read`).then(r => r.data),
  unreadCount: () => api.get<{ unread_count: number }>('/messages/unread-count').then(r => r.data),
  remove: (messageId: number) => api.delete(`/messages/${messageId}`).then(r => r.data),
  like: (messageId: number) => api.post<{ liked: boolean; total_likes: number; user_vote: number }>(`/messages/${messageId}/like`).then(r => r.data),
};

export const groupChatApi = {
  groups: () => api.get<Group[]>('/group-chat/groups').then(r => r.data),
  messages: (groupId: number, page = 1) => api.get<GroupChatMessage[]>(`/group-chat/${groupId}/messages`, { params: { page, limit: 50 } }).then(r => r.data),
  send: (groupId: number, content: string, reply_to_id?: number) => api.post(`/group-chat/${groupId}/messages`, { content, reply_to_id }).then(r => r.data),
  markRead: (groupId: number, messageId: number) => api.put(`/group-chat/${groupId}/read`, { messageId }).then(r => r.data),
  like: (groupId: number, messageId: number) => api.post(`/group-chat/${groupId}/messages/${messageId}/like`).then(r => r.data),
};

export const searchApi = {
  search: (q: string, type: string = 'all') => api.get<SearchResults>('/search', { params: { q, type } }).then(r => r.data),
};

export const deliverablesApi = {
  list: (params?: { status?: string; userId?: number }) => api.get<Deliverable[]>('/deliverables', { params }).then(r => r.data),
  get: (id: number) => api.get<Deliverable>(`/deliverables/${id}`).then(r => r.data),
  create: (body: Record<string, any>) => api.post('/deliverables', body).then(r => r.data),
  update: (id: number, body: Record<string, any>) => api.put(`/deliverables/${id}`, body).then(r => r.data),
  analyzeDocument: (form: FormData) => api.post('/deliverables/analyze-document', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 90000 }).then(r => r.data),
};

export const ledgerApi = {
  list: (params?: { status?: string; expense_category?: string; search?: string; project?: string; member?: string }): Promise<LedgerEntry[]> =>
    api.get<LedgerEntry[] | { entries: LedgerEntry[] }>('/ledger', { params }).then(r => (Array.isArray(r.data) ? r.data : (r.data as any).entries || (r.data as any).data || []) as LedgerEntry[]),
  get: (id: number) => api.get<LedgerEntry>(`/ledger/${id}`).then(r => r.data),
  create: (body: Record<string, any>) => api.post(`/ledger`, body).then(r => r.data),
  update: (id: number, body: Record<string, any>) => api.put(`/ledger/${id}`, body).then(r => r.data),
  remove: (id: number) => api.delete(`/ledger/${id}`).then(r => r.data),
  summary: () => api.get('/ledger/stats/summary').then(r => r.data),
  approve: (id: number) => api.post(`/ledger/${id}/approve`).then(r => r.data),
  pay: (id: number, body?: Record<string, any>) => api.post(`/ledger/${id}/pay`, body || {}).then(r => r.data),
};

export const agreementsApi = {
  current: () => api.get<AgreementVersion>('/agreements/current').then(r => r.data),
  status: () => api.get<{ has_signed: boolean; current_version: string; agreement_details: UserAgreement | null }>('/agreements/status').then(r => r.data),
  sign: (body: { full_name: string; email: string; quiz_answer?: string; digital_signature: string }) => api.post<{ message: string; token?: string; user?: User }>('/agreements/sign', body).then(r => r.data),
  mine: () => api.get<AgreementAssignment[]>('/agreements/mine').then(r => r.data),
  assignment: (id: number | string) => api.get<AssignmentDetail>(`/agreements/assignment/${id}`).then(r => r.data),
  signAssignment: (id: number | string, body: { full_name: string; email: string; quiz_answer?: string; digital_signature: string; confirmations: Record<string, boolean>; payroll?: Record<string, string> }) =>
    api.post(`/agreements/assignment/${id}/sign`, body).then(r => r.data),
  userAgreements: (userId: number) => api.get<UserAgreement[]>(`/agreements/user/${userId}`).then(r => r.data),
};

export const aiApi = {
  /** Mint a per-call ElevenLabs WebRTC conversation token for the workspace agent (404 = not configured). */
  session: () => api.post<AiSession>('/mobile/ai/session').then(r => r.data),
};

export const quicklinksApi = { list: () => api.get('/quicklinks').then(r => r.data) };

export type { Comment };
