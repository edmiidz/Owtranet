export type EmailProvider = 'self_hosted' | 'microsoft_365' | 'google_workspace';

export interface EmailProviderOption {
  value: EmailProvider;
  label: string;
  webmail: boolean;
}

export interface User {
  id: number;
  email: string;
  other_emails?: string;
  email_verified?: boolean;
  name: string;
  github_username?: string;
  intranet_username?: string;
  avatar_url?: string;
  bio?: string;
  department?: string;
  position?: string;
  company?: string;
  telephone?: string;
  calendar_link?: string;
  role: 'admin' | 'moderator' | 'user' | 'pending' | 'pending_agreement' | 'deactivated' | 'system';
  /** 'ai_agent' for the intranet AI agents; profile then carries ai_agent */
  account_type?: 'human' | 'ai_agent';
  ai_agent?: AiAgentProfile | null;
  hourly_rate?: number;
  created_at: string;
  last_login?: string;
  company_email?: string;
  company_email_created_at?: string;
  company_email_last_reset?: string;
  email_notification_preference?: 'personal' | 'company' | 'both';
  /** Mail + calendar provider; null/undefined = instance default (branding.defaultEmailProvider) */
  email_provider?: EmailProvider | null;
  agent_embed_code?: string;
  total_investment?: number;
  activity_status?: 'active' | 'inactive' | 'pending';
}

// An intranet AI agent's profile block.
export interface AiAgentProfile {
  handle: string;
  kind: 'role' | 'voice' | 'system';
  tagline?: string | null;
  description?: string | null;
  elevenlabs_agent_id?: string | null;
  skill_command?: string | null;
  skill_url?: string | null;
  responds_to_mentions?: number | boolean;
}

// An AI agent as returned by /api/search (type 'agents').
export interface AiAgentSearchResult extends AiAgentProfile {
  id: number;
  name: string;
  intranet_username?: string;
  avatar_url?: string;
  bio?: string;
}

// An agent brought into a thread by a new post/comment (reply is on its way).
export interface SummonedAgent {
  handle: string;
  name: string;
}

// A row of the @mention dropdown: a person or an AI agent.
export interface MentionCandidate {
  id: number;
  name: string;
  github_username?: string | null;
  intranet_username?: string | null;
  avatar_url?: string | null;
  account_type: 'human' | 'ai_agent';
  /** Exactly what to insert after "@" */
  mention_handle: string;
  agent_tagline?: string | null;
}

export interface Post {
  id: number;
  user_id: number;
  title: string;
  content: string;
  content_html: string;
  slug: string;
  view_count: number;
  is_pinned: boolean;
  is_locked: boolean;
  created_at: string;
  updated_at: string;
  author_name: string;
  author_account_type?: 'human' | 'ai_agent';
  github_username?: string;
  intranet_username?: string;
  avatar_url?: string;
  tags?: Tag[];
  comments?: Comment[];
  score?: number;
  comment_count?: number;
  visibility?: 'all_members' | 'specific_members' | 'author_only';
  visible_to_users?: number[];
  visible_to_users_details?: Array<{id: number; name: string; github_username?: string}>;
  access_count?: number;
  editor_users?: number[];
  editor_users_details?: Array<{id: number; name: string; github_username?: string}>;
  can_edit?: boolean;
  attachment_filename?: string;
  attachment_original_name?: string;
  attachment_mime_type?: string;
  attachment_size?: number;
}

export interface Comment {
  id: number;
  post_id: number;
  user_id: number;
  parent_id?: number;
  content: string;
  content_html: string;
  is_accepted: boolean;
  score: number;
  created_at: string;
  updated_at: string;
  author_name: string;
  author_account_type?: 'human' | 'ai_agent';
  github_username?: string;
  intranet_username?: string;
  avatar_url?: string;
}

export interface Tag {
  id: number;
  name: string;
  slug: string;
  created_at: string;
}

export interface Deliverable {
  id: number;
  user_id: number;
  type: 'expense' | 'customer' | 'referral' | 'contribution' | 'other';
  title: string;
  description: string;
  amount?: number;
  status: 'pending_valuation' | 'pending_approval' | 'approved' | 'rejected' | 'paid';
  approved_by?: number;
  approved_at?: string;
  rejection_reason?: string;
  payment_date?: string;
  created_at: string;
  updated_at: string;
  user_name?: string;
  github_username?: string;
  approver_name?: string;
  attachments?: DeliverableAttachment[];
}

export interface DeliverableAttachment {
  id: number;
  deliverable_id: number;
  file_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
  uploaded_at: string;
}

export interface EmailRequest {
  id: number;
  user_id: number;
  requested_email: string;
  justification: string;
  status: 'pending' | 'approved' | 'rejected';
  approved_by?: number;
  approved_at?: string;
  rejection_reason?: string;
  created_at: string;
  requester_name?: string;
  requester_email?: string;
  /** Requester's effective mail provider (their choice or the instance default). */
  provider?: EmailProvider;
  approver_name?: string;
}

/** PUT /api/email-requests/:id response. External providers return the console to create the mailbox in. */
export interface EmailRequestUpdateResult {
  message: string;
  account_created: boolean;
  external_provider?: EmailProvider;
  external_provider_name?: string;
  admin_console_url?: string;
  requested_email?: string;
}

export interface Notification {
  id: number;
  user_id: number;
  type: string;
  title: string;
  message: string;
  data?: any;
  is_read: boolean;
  created_at: string;
}

export interface GitHubIssue {
  id: number;
  issue_number: number;
  title: string;
  state: string;
  assignee_github_username?: string;
  labels: any;
  html_url: string;
  created_at: string;
  updated_at: string;
  synced_at: string;
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  posts?: T[];
  data?: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Investment {
  id: number;
  title: string;
  content: string;
  amount?: number;
  original_amount?: number;
  original_currency?: string;
  exchange_rate?: number;
  risk_multiplier?: number;
  theoretical_value_usd?: number;
  status: string;
  investment_category?: string;
  deliverable_date: string;
  created_at: string;
  user_name: string;
  nominee_name?: string;
  github_username?: string;
}

export interface LedgerSearchResult {
  id: number;
  user_id: number;
  payee_user_id: number | null;
  title: string;
  description: string | null;
  vendor_name: string | null;
  receipt_number: string | null;
  expense_category: string;
  status: string;
  is_draft: number;
  project_code: string | null;
  expense_date: string;
  amount: number | null;
  total_with_tax: number | null;
  original_amount: number | null;
  original_currency: string;
  created_at: string;
  user_name: string;
  payee_name: string | null;
}

// A document that lives in GitHub (or on the public help site), surfaced in
// intranet search as a stub. The intranet never renders the document itself —
// `access_url` is where the "Access now" button sends you. `body` is indexed
// server-side for matching and is deliberately never sent to the client.
export interface GithubDoc {
  id: number;
  repo: string;
  path: string;
  collection: 'internal' | 'help' | 'guide' | 'exec';
  visibility?: 'member' | 'admin';
  title: string;
  summary?: string | null;
  access_url: string;
  github_url: string;
  word_count?: number | null;
  doc_updated_at?: string | null;
  last_seen_at?: string;
  updated_at?: string;
}

// One path rule inside a Search Adapter: which files to index, what to call
// them, and — critically — who can see them. `visibility` is written straight
// into github_docs.visibility on the next sweep, so changing it re-classifies
// every document the rule matches.
export interface SearchAdapterRule {
  id?: number;
  adapter_id?: number;
  path_prefix: string;
  collection: 'internal' | 'help' | 'guide' | 'exec';
  visibility: 'member' | 'admin';
  access_url_mode: 'github' | 'site_path';
  url_path?: string | null;
  sort_order?: number;
}

// A GitHub repo the doc sweep indexes. `token_env_var` is the NAME of a .env
// variable on the server; the token itself is never sent to or from the client.
// `token_present` is the server telling us whether that variable is set.
export interface SearchAdapter {
  id: number;
  repo: string;
  branch: string;
  label?: string | null;
  token_env_var: string;
  token_present?: boolean;
  site_base?: string | null;
  enabled: number | boolean;
  last_swept_at?: string | null;
  last_status: 'ok' | 'failed' | 'never';
  last_error?: string | null;
  last_doc_count?: number | null;
  updated_by_name?: string | null;
  updated_at?: string;
  rules: SearchAdapterRule[];
}

export interface SearchResults {
  posts?: Post[];
  comments?: Comment[];
  users?: User[];
  investments?: Investment[];
  tasks?: Task[];
  ledger?: LedgerSearchResult[];
  docs?: GithubDoc[];
  agents?: AiAgentSearchResult[];
}

export interface Quicklink {
  id: number;
  title: string;
  url: string;
  description?: string;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AgreementConfirmation {
  key: string;
  label: string;
}

export interface AgreementVersion {
  id: number;
  version: string;
  agreement_type?: 'team' | 'employment' | 'custom';
  title: string;
  content: string;
  quiz_question: string | null;
  quiz_correct_answer: string | null;
  is_active: boolean;
  created_at: string;
  created_by: number;
  required_fields?: string[] | null;
  confirmations?: AgreementConfirmation[] | null;
  pending_assignments?: number;
  signed_assignments?: number;
}

export interface AgreementAssignment {
  id: number;
  status: 'pending' | 'signed' | 'cancelled';
  requested_at: string;
  signed_at: string | null;
  user_agreement_id: number | null;
  agreement_version_id: number;
  version: string;
  title: string;
  agreement_type: 'team' | 'employment' | 'custom';
}

export interface AssignmentDetail extends AgreementAssignment {
  user_id: number;
  content: string;
  quiz_question: string | null;
  required_fields: string[];
  confirmations: AgreementConfirmation[];
}

export interface PayrollFormData {
  sin?: string;
  bank_institution?: string;
  bank_transit?: string;
  bank_account?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  province?: string;
  postal_code?: string;
  date_of_birth?: string;
}

export interface MaskedPayrollDetails {
  has_sin: boolean;
  sin_masked: string | null;
  has_bank: boolean;
  bank_account_masked: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  date_of_birth: string | null;
  updated_at: string;
}

export interface RevealedPayrollDetails {
  sin: string | null;
  bank_institution: string | null;
  bank_transit: string | null;
  bank_account: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  date_of_birth: string | null;
  updated_at: string;
}

export interface UserAgreement {
  id: number;
  user_id: number;
  agreement_version_id: number;
  full_name: string;
  email: string;
  ip_address?: string;
  quiz_answer: string;
  digital_signature: string;
  signed_at: string;
  status: 'signed' | 'voided';
  version?: string;
  title?: string;
  content?: string;
  version_created_at?: string;
  user_name?: string;
  user_email?: string;
  agreement_type?: 'team' | 'employment' | 'custom';
  confirmations?: string[] | string | null;
  version_confirmations?: AgreementConfirmation[] | string | null;
  payroll_on_file?: boolean | number;
}

export interface GroupChatMessage {
  id: number;
  group_id: number;
  sender_id: number;
  content: string;
  content_html?: string;
  message_type: 'text' | 'file' | 'system';
  reply_to_id?: number;
  is_edited: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  sender_name: string;
  sender_github_username?: string;
  sender_avatar_url?: string;
  reply_to_content?: string;
  reply_to_sender_name?: string;
  total_likes?: number;
  user_liked?: boolean;
}

export interface Group {
  id: number;
  name: string;
  display_name: string;
  description?: string;
  email_alias?: string;
  type: 'email' | 'forum' | 'both';
  is_active: boolean;
  created_by: number;
  created_at: string;
  updated_at: string;
  unread_count?: number;
  last_message?: string;
  last_message_at?: string;
  last_sender_name?: string;
}

export interface DirectMessage {
  id: number;
  conversation_id: number;
  sender_id: number;
  recipient_id: number;
  content: string;
  content_html?: string;
  message_type?: 'text' | 'image' | 'file';
  reply_to_id?: number;
  file_url?: string;
  file_name?: string;
  file_size?: number;
  is_read: boolean;
  read_at?: string | null;
  deleted_at?: string | null;
  deleted_by?: number | null;
  created_at: string;
  updated_at: string;
  sender_name: string;
  sender_github: string;
  sender_avatar?: string | null;
  reply_to_content?: string;
  reply_to_sender_name?: string;
  total_likes?: number;
  user_vote?: number;
}

export interface Task {
  id: number;
  title: string;
  description: string;
  description_html: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  due_date: string | null;
  created_by: number;
  assigned_to: number | null;
  created_at: string;
  updated_at: string;
  creator_name: string;
  creator_username?: string;
  creator_avatar?: string;
  assignee_name?: string;
  assignee_username?: string;
  assignee_avatar?: string;
  comment_count?: number;
}

export interface TaskComment {
  id: number;
  task_id: number;
  user_id: number;
  content: string;
  content_html: string;
  created_at: string;
  updated_at: string;
  author_name: string;
  author_username?: string;
  author_avatar?: string;
}

export interface TaskActivity {
  id: number;
  task_id: number;
  user_id: number;
  action: string;
  old_value?: string;
  new_value?: string;
  details?: any;
  created_at: string;
  user_name: string;
  user_username?: string;
  user_avatar?: string;
  task_title?: string;
}