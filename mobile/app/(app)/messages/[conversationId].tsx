import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { messagesApi } from '@/api';
import type { DirectMessage } from '@/api/types';
import { errorMessage } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useBadges } from '@/stores/badges';
import { timeAgo } from '@/lib/format';
import { showMessageActions } from '@/lib/messageActions';
import { useBackFallback } from '@/lib/useBackFallback';
import { useKeyboardInset } from '@/lib/useKeyboardInset';
import { Button, ErrorBox, Input, Loading, Screen } from '@/components/ui';
import { Markdown } from '@/components/Markdown';
import { useTheme } from '@/theme';

export default function ConversationScreen() {
  const t = useTheme();
  const nav = useNavigation();
  const kb = useKeyboardInset();
  useBackFallback('/(app)/(tabs)/messages');
  const { conversationId, agentTyping: typingParam } = useLocalSearchParams<{ conversationId: string; agentTyping?: string }>();
  const id = Number(conversationId);
  const me = useAuthStore(s => s.user);
  const refreshBadges = useBadges(s => s.refresh);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<DirectMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const other = useRef<{ id: number; name: string } | null>(null);
  // An AI agent answers a DM a few seconds after it's sent: show "<Agent> is
  // typing…" and poll quickly until its reply lands (or two minutes pass).
  const [agentTyping, setAgentTyping] = useState<{ name: string; count: number | null } | null>(typingParam ? { name: typingParam, count: null } : null);
  const messageCount = useRef(0);

  const load = useCallback(async () => {
    try {
      const list = await messagesApi.messages(id);
      setMessages(list);
      messageCount.current = list.length;
      setAgentTyping(cur => {
        if (!cur) return cur;
        // Opened from a first message: done if the thread already ends with their reply.
        if (cur.count === null) return list.length && list[list.length - 1].sender_id !== me?.id ? null : { ...cur, count: list.length };
        return list.length > cur.count ? null : cur;
      });
      // The other participant is whichever side of any message is not me. Only
      // fall back to the conversation list when I have not sent anything yet
      // and my own id is unknown (TestFlight: "Cannot send message to yourself").
      const myId = me?.id;
      let o: { id: number; name: string } | null = null;
      if (myId) {
        const fromThem = list.find(m => m.sender_id !== myId);
        const fromMe = list.find(m => m.sender_id === myId && m.recipient_id !== myId);
        if (fromThem) o = { id: fromThem.sender_id, name: fromThem.sender_name };
        else if (fromMe) o = { id: fromMe.recipient_id, name: other.current?.name || 'Conversation' };
      }
      if (!o || o.name === 'Conversation') {
        const c = await messagesApi.conversations().then(cs => cs.find(x => x.conversation_id === id)).catch(() => undefined);
        if (c) o = { id: c.other_user_id, name: c.other_user_name };
      }
      if (o) { other.current = o; nav.setOptions({ title: o.name }); }
      await messagesApi.markRead(id).catch(() => {});
      refreshBadges();
      setError(null);
    } catch (e) { setError(errorMessage(e)); }
    finally { setLoading(false); }
  }, [id, me?.id, nav, refreshBadges]);

  useEffect(() => { load(); const timer = setInterval(load, 15000); return () => clearInterval(timer); }, [load]);
  const typing = !!agentTyping;
  useEffect(() => {
    if (!typing) return;
    const fast = setInterval(load, 3000);
    const giveUp = setTimeout(() => setAgentTyping(null), 120000);
    return () => { clearInterval(fast); clearTimeout(giveUp); };
  }, [typing, load]);

  async function like(m: DirectMessage) {
    // Optimistic toggle, then reconcile with the server's count.
    setMessages(list => list.map(x => x.id === m.id ? { ...x, user_vote: x.user_vote ? 0 : 1, total_likes: Number(x.total_likes || 0) + (x.user_vote ? -1 : 1) } : x));
    try {
      const r = await messagesApi.like(m.id);
      setMessages(list => list.map(x => x.id === m.id ? { ...x, user_vote: r.user_vote, total_likes: r.total_likes } : x));
    } catch { load(); }
  }

  async function send() {
    const recipient = other.current?.id;
    if (!text.trim() || !recipient) return;
    setBusy(true);
    try {
      const r = await messagesApi.send(recipient, text.trim(), replyTo?.id);
      setText(''); setReplyTo(null);
      if (r.agent_replying) setAgentTyping({ name: other.current?.name || 'The agent', count: messageCount.current + 1 });
      await load();
    }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }

  return (
    <Screen scroll={false} padded={false} edges={['bottom', 'left', 'right']}>
      <View style={{ flex: 1, paddingBottom: kb }}>
        {error ? <View style={{ padding: 12 }}><ErrorBox message={error} onRetry={load} /></View> : null}
        {loading ? <Loading /> : (
          <FlatList data={[...messages].reverse()} inverted keyExtractor={m => String(m.id)} contentContainerStyle={{ padding: 12 }}
            renderItem={({ item }) => {
              const mine = item.sender_id === me?.id;
              return (
                <Pressable onLongPress={() => showMessageActions({ content: item.deleted_at ? '' : item.content, onReply: () => setReplyTo(item) })} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', marginBottom: 8 }}>
                  <View style={{ backgroundColor: mine ? t.primary : t.card, borderRadius: 16, padding: 10, borderWidth: mine ? 0 : 1, borderColor: t.border }}>
                    {item.reply_to_content ? <Text style={{ color: mine ? '#dbeafe' : t.muted, fontSize: 12, fontStyle: 'italic', marginBottom: 4 }} numberOfLines={2}>↪ {item.reply_to_sender_name}: {item.reply_to_content}</Text> : null}
                    {item.deleted_at
                      ? <Text style={{ color: mine ? '#fff' : t.muted, fontSize: 15.5, lineHeight: 21, fontStyle: 'italic' }}>(deleted)</Text>
                      : <Markdown color={mine ? '#fff' : undefined}>{item.content}</Markdown>}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 2, alignSelf: mine ? 'flex-end' : 'flex-start' }}>
                    <Text style={{ color: t.muted, fontSize: 11 }}>{timeAgo(item.created_at)}{mine && item.is_read ? ' · read' : ''}</Text>
                    {!item.deleted_at ? (
                      <Pressable onPress={() => like(item)} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                        <Ionicons name={item.user_vote ? 'heart' : 'heart-outline'} size={13} color={item.user_vote ? t.danger : t.muted} />
                        {Number(item.total_likes) ? <Text style={{ color: t.muted, fontSize: 11 }}>{Number(item.total_likes)}</Text> : null}
                      </Pressable>
                    ) : null}
                  </View>
                </Pressable>
              );
            }} />
        )}
        {agentTyping ? <Text style={{ color: t.muted, fontSize: 13, fontStyle: 'italic', paddingHorizontal: 14, paddingBottom: 6 }}>{agentTyping.name} is typing…</Text> : null}
        <View style={{ borderTopWidth: 1, borderTopColor: t.border, backgroundColor: t.card }}>
          {replyTo ? <Pressable onPress={() => setReplyTo(null)} style={{ paddingHorizontal: 12, paddingTop: 8 }}><Text style={{ color: t.muted, fontSize: 12 }} numberOfLines={1}>Replying to {replyTo.sender_name}: {replyTo.content}  ✕</Text></Pressable> : null}
          <View style={{ flexDirection: 'row', gap: 8, padding: 10, alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}><Input placeholder="Message…" value={text} onChangeText={setText} multiline style={{ minHeight: 40, maxHeight: 120 }} /></View>
            <Button title="Send" icon="send" onPress={send} loading={busy} disabled={!text.trim()} style={{ marginBottom: 12 }} />
          </View>
        </View>
      </View>
    </Screen>
  );
}
