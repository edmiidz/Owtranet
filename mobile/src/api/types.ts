// Mirrors client/src/types/index.ts (web app) — keep the shapes identical so the
// mobile app can talk to the same endpoints.
export type Role = 'admin' | 'moderator' | 'user' | 'pending' | 'pending_agreement' | 'deactivated' | 'system';

export interface User {
  id: number; email: string; name: string; role: Role;
  github_username?: string | null; intranet_username?: string | null; avatar_url?: string | null;
  bio?: string | null; department?: string | null; position?: string | null; company?: string | null;
  telephone?: string | null; calendar_link?: string | null; hourly_rate?: number | null;
  created_at?: string; last_login?: string | null; company_email?: string | null;
  account_type?: 'human' | 'ai_agent'; ai_agent?: { handle: string; tagline?: string | null } | null;
}

export interface Tag { id: number; name: string; slug: string }

export interface Comment {
  id: number; post_id: number; user_id: number; parent_id?: number | null; content: string; content_html?: string;
  is_accepted: boolean | number; score: number; created_at: string; author_name: string; avatar_url?: string | null;
  intranet_username?: string | null;
}

export interface Post {
  id: number; user_id: number; title: string; content: string; content_html?: string; slug: string;
  view_count?: number; is_pinned?: boolean | number; is_locked?: boolean | number; created_at: string; updated_at?: string;
  author_name: string; avatar_url?: string | null; intranet_username?: string | null; github_username?: string | null;
  tags?: Tag[]; comments?: Comment[]; score?: number; comment_count?: number; user_vote?: number;
  visibility?: 'all_members' | 'specific_members' | 'author_only';
  attachment_filename?: string | null; attachment_original_name?: string | null; attachment_mime_type?: string | null; attachment_size?: number | null;
}

export interface Pagination { page: number; limit: number; total: number; pages: number }

export interface Notification {
  id: number; user_id: number; type: string; title: string | null; message: string | null; data?: any; is_read: boolean | number; created_at: string;
}

export interface Conversation {
  conversation_id: number; updated_at: string; other_user_id: number; other_user_name: string;
  other_user_github?: string | null; other_user_avatar?: string | null; last_message?: string | null;
  last_sender_id?: number | null; last_message_at?: string | null; unread_count: number;
}

export interface DirectMessage {
  id: number; conversation_id: number; sender_id: number; recipient_id: number; content: string; content_html?: string;
  is_read: boolean | number; created_at: string; sender_name: string; sender_avatar?: string | null; deleted_at?: string | null;
  reply_to_id?: number | null; reply_to_content?: string | null; reply_to_sender_name?: string | null;
  total_likes?: number | string; user_vote?: number;
}

export interface Group {
  id: number; name: string; display_name: string; description?: string | null; type: string; is_active: boolean | number;
  unread_count?: number; last_message?: string | null; last_message_at?: string | null; last_sender_name?: string | null;
}

export interface GroupChatMessage {
  id: number; group_id: number; sender_id: number; content: string; content_html?: string; message_type: 'text' | 'file' | 'system';
  reply_to_id?: number | null; is_edited: boolean | number; is_deleted: boolean | number; created_at: string;
  sender_name: string; sender_avatar_url?: string | null; reply_to_content?: string | null; reply_to_sender_name?: string | null;
  total_likes?: number; user_liked?: boolean | number;
}

export interface Deliverable {
  id: number; user_id: number; nominee_user_id?: number | null; type: string; investment_category?: string; title: string;
  description?: string | null; content?: string | null; content_html?: string | null; amount?: number | null;
  original_amount?: number | null; original_currency?: string | null; exchange_rate?: number | null; risk_multiplier?: number | null;
  theoretical_value_usd?: number | null; status: string; deliverable_date?: string | null; created_at: string;
  user_name?: string; nominee_name?: string | null; approver_name?: string | null; tags?: string | string[] | null;
  attachments?: Array<{ id: number; file_name: string; file_path: string; file_type?: string; file_size?: number }>;
  is_draft?: boolean | number;
}

export interface LedgerEntry {
  id: number; user_id: number; payee_user_id?: number | null; expense_category: string; title: string;
  description?: string | null; amount?: number | null; original_amount?: number | null; original_currency?: string | null;
  total_with_tax?: number | null; tax_total?: number | null; vendor_name?: string | null; receipt_number?: string | null;
  receipt_filename?: string | null; receipt_original_name?: string | null; expense_date: string; status: string;
  is_reimbursable?: boolean | number; project_code?: string | null; source?: string; created_at: string;
  submitter_name?: string; payee_name?: string | null; user_name?: string;
}

export interface AgreementVersion {
  id: number; version: string; title: string; content: string; agreement_type?: 'team' | 'employment' | 'custom';
  quiz_question: string | null; is_active?: boolean | number; required_fields?: string[] | null;
  confirmations?: Array<{ key: string; label: string }> | null;
}

export interface AgreementAssignment {
  id: number; status: 'pending' | 'signed' | 'cancelled'; requested_at: string; signed_at: string | null;
  user_agreement_id: number | null; agreement_version_id: number; version: string; title: string; agreement_type: string;
}
export interface AssignmentDetail extends AgreementAssignment {
  user_id: number; content: string; quiz_question: string | null; required_fields: string[]; confirmations: Array<{ key: string; label: string }>;
}

export interface UserAgreement {
  id: number; full_name: string; email: string; signed_at: string; status: string; version?: string; title?: string; agreement_type?: string;
}

export interface RadioSegment {
  segment_id: number; post_id: number; slug: string; headline: string; title: string; tts_text: string;
  word_count: number | null; est_duration_secs: number | null;
  author: { id: number; name: string; avatar_url?: string | null };
  tags: string[]; comment_count: number; is_pinned: boolean; posted_at: string; generated_at: string;
  heard: boolean; listened_at?: string | null;
}
export interface RadioFeed {
  station: { name: string; intro_text: string; outro_text: string; generated_at: string; since: string; total: number; unheard: number; est_total_secs: number };
  segments: RadioSegment[];
}

export interface Branding { companyName: string; companyShortName: string; companyEmailDomain: string; baseUrl: string; baseCurrency: string }
export interface Counts { unread_notifications: number; unread_messages: number; pending_agreements: number; open_tasks: number; radio_unheard: number }
export interface AiAgentInfo { name: string }
export interface Bootstrap {
  user: User; branding: Branding; counts: Counts; min_app_version: string; server_time: string;
  features: Record<string, boolean>;
  ai_agent?: AiAgentInfo | null;
}
export interface AiSession {
  token: string; agent_id: string; agent_name: string;
  dynamic_variables: { user_id: string; user_name: string; user_email: string; user_username: string; user_role: string; user_department: string; user_position: string; company_name: string; platform: string };
}
export interface HomeData {
  counts: Counts;
  recent_posts: Array<{ id: number; title: string; slug: string; created_at: string; is_pinned: number; author_name: string; avatar_url?: string | null; comment_count: number }>;
  pending_agreements: Array<{ id: number; status: string; requested_at: string; title: string; version: string; agreement_type: string }>;
  quicklinks: Array<{ id: number; title: string; url: string; description?: string | null }>;
  recent_conversations: Array<{ conversation_id: number; other_user_name: string; other_user_avatar?: string | null; unread: number }>;
}

// An AI agent as returned by /api/search (type 'agents'). Mirrors web's AiAgentSearchResult.
export interface AgentSearchResult {
  id: number; name: string; intranet_username?: string | null; avatar_url?: string | null; bio?: string | null;
  handle: string; kind: 'role' | 'voice' | 'system'; tagline?: string | null;
  elevenlabs_agent_id?: string | null; skill_command?: string | null; skill_url?: string | null;
}

export interface SearchResults { posts?: Post[]; comments?: Comment[]; users?: User[]; agents?: AgentSearchResult[]; investments?: Deliverable[] }

export type TaskStatus = 'pending' | 'in_progress' | 'completed';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export interface Task {
  id: number; title: string; description?: string | null; description_html?: string | null;
  status: TaskStatus; priority: TaskPriority; due_date?: string | null;
  created_by: number; assigned_to?: number | null; created_at: string; updated_at?: string;
  creator_name?: string | null; creator_username?: string | null; creator_avatar?: string | null;
  assignee_name?: string | null; assignee_username?: string | null; assignee_avatar?: string | null;
  comment_count?: number;
}
export interface TaskComment {
  id: number; task_id: number; user_id: number; content: string; content_html?: string | null;
  created_at: string; author_name?: string | null; author_username?: string | null; author_avatar?: string | null;
}
export interface TaskUser { id: number; name: string; intranet_username?: string | null; avatar_url?: string | null }
