import { hrefForWebPath } from '@/lib/deepLinks';

type Data = Record<string, any> | null;

function parseData(raw: unknown): Data {
  if (!raw) return null;
  if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { return null; } }
  return typeof raw === 'object' ? (raw as Record<string, any>) : null;
}

const seg = (s: unknown) => encodeURIComponent(String(s));

/** Forum post screen: the app loads posts by slug only, so no slug → forum list. */
function postHref(d: Data): string {
  const slug = d?.slug ?? d?.post_slug;
  if (slug) return `/forum/${seg(slug)}`;
  if (typeof d?.url === 'string' && d.url.startsWith('/forum/post/')) return hrefForWebPath(d.url) ?? '/forum';
  return '/forum';
}

const taskHref = (d: Data) => (d?.taskId ? `/tasks/${seg(d.taskId)}` : '/tasks');

/**
 * Where a notification (an in-app list row, or the data of a tapped push)
 * should open, as an expo-router href; null when the app has no screen for it.
 *
 * Mirrors client/src/utils/notifications.ts — keep the two in step with the
 * payloads server.js writes into notifications.data (e.g. new_comment stores
 * `{postId, commentId, slug}`, mentions store `slug` / `groupName` / `taskId`).
 */
export function hrefForNotification(type: string | null | undefined, rawData: unknown): string | null {
  const d = parseData(rawData);
  const explicit: string | undefined = typeof d?.link === 'string' ? d.link : typeof d?.url === 'string' ? d.url : undefined;
  const explicitHref = explicit ? hrefForWebPath(explicit) : null;

  switch (type) {
    case 'new_comment':
    case 'new_post':
    case 'post_reply':
      return postHref(d);

    case 'mention':
      if (d?.entityType === 'group_message') {
        if (d.groupId) return `/groups/${seg(d.groupId)}`;
        return d.groupName ? `/groups/${seg(d.groupName)}` : '/groups';
      }
      if (d?.entityType === 'task' || d?.entityType === 'task_comment') return taskHref(d);
      return postHref(d);

    case 'direct_message':
      return d?.conversation_id ? `/messages/${seg(d.conversation_id)}` : '/messages';

    case 'task_assigned':
    case 'task_comment':
      return taskHref(d);

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
      return d?.deliverable_id ? `/investments/${seg(d.deliverable_id)}` : '/investments';

    case 'ledger_pending':
    case 'ledger_created':
      return explicitHref ?? (d?.ledgerId ? `/ledger/${seg(d.ledgerId)}` : '/ledger');

    default:
      // Unknown / older types: fall back to whatever ids the payload carries.
      if (d?.conversation_id) return `/messages/${seg(d.conversation_id)}`;
      if (d?.slug || d?.post_slug) return postHref(d);
      if (d?.deliverable_id) return `/investments/${seg(d.deliverable_id)}`;
      if (d?.assignment_id) return `/agreements/${seg(d.assignment_id)}`;
      if (d?.taskId) return taskHref(d);
      return explicitHref;
  }
}
