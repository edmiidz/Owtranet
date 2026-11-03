import type { Notification } from '../types';

type NotificationData = Record<string, any> | null;

const parseData = (raw: unknown): NotificationData => {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return typeof raw === 'object' ? (raw as Record<string, any>) : null;
};

const postHref = (data: NotificationData, fallback = '/forum'): string => {
  if (data?.slug) return `/forum/post/${data.slug}`;
  if (data?.postId) return `/forum/post/${data.postId}`;
  return fallback;
};

const taskHref = (data: NotificationData): string =>
  data?.taskId ? `/tasks/${data.taskId}` : '/tasks';

/**
 * Where a notification should take the user when clicked. Every type the
 * server emits is covered; unknown types fall back to an explicit link in the
 * payload, or nowhere.
 */
export function notificationHref(n: Notification): string | null {
  const data = parseData(n.data);
  const explicitLink: string | undefined = data?.link || data?.url;

  switch (n.type) {
    case 'new_comment':
    case 'new_post':
      return postHref(data);

    case 'mention':
      if (data?.entityType === 'group_message') {
        return data.groupName ? `/group-chat/${data.groupName}` : '/group-chat';
      }
      if (data?.entityType === 'task' || data?.entityType === 'task_comment') {
        return taskHref(data);
      }
      return postHref(data);

    case 'direct_message':
      return data?.sender_id ? `/messages?user=id:${data.sender_id}` : '/messages';

    case 'task_assigned':
    case 'task_comment':
      return taskHref(data);

    case 'email_request':
      return '/admin?tab=emailrequests';

    // Setup instructions for a new mailbox arrive as a direct message.
    case 'email_request_approved':
    case 'email_request_rejected':
    case 'email_created':
    case 'company_email_setup':
      return '/messages';

    case 'deliverable_update':
    case 'deliverable_pending':
    case 'deliverable_created':
    case 'investment_update':
    case 'payment_received':
    case 'payment_processed':
      return '/investment-tracker';

    case 'ledger_pending':
    case 'ledger_created':
      return explicitLink || (data?.ledgerId ? `/ledger/${data.ledgerId}` : '/ledger');

    default:
      return explicitLink || null;
  }
}
