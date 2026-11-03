/**
 * Pages that change an unread count (reading a chat, marking a notification)
 * fire this so the sidebar badges refresh right away instead of waiting for
 * the next poll.
 */
export const BADGES_CHANGED_EVENT = 'intranet:badges-changed';

export const notifyBadgesChanged = (): void => {
  window.dispatchEvent(new Event(BADGES_CHANGED_EVENT));
};
