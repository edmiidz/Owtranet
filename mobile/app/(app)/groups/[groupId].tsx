import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { groupChatApi } from '@/api';
import type { GroupChatMessage } from '@/api/types';
import { errorMessage } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useBadges } from '@/stores/badges';
import { timeAgo } from '@/lib/format';
import { showMessageActions } from '@/lib/messageActions';
import { useKeyboardInset } from '@/lib/useKeyboardInset';
import { Avatar, Button, ErrorBox, Input, Loading, Screen } from '@/components/ui';
import { Markdown } from '@/components/Markdown';
import { useTheme } from '@/theme';

export default function GroupChatScreen() {
  const t = useTheme();
  const nav = useNavigation();
  const kb = useKeyboardInset();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const id = Number(groupId);
  // Web links address a group by name (/group-chat/General), so a deep link lands
  // here as /groups/General. Swap it for the numeric route before loading anything.
  const byName = !/^\d+$/.test(groupId ?? '');
  const router = useRouter();
  const me = useAuthStore(s => s.user);
  const refreshBadges = useBadges(s => s.refresh);
  const [messages, setMessages] = useState<GroupChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<GroupChatMessage | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (byName) return;
    try {
      const list = await groupChatApi.messages(id);
      setMessages(list);
      const last = list[list.length - 1];
      if (last) groupChatApi.markRead(id, last.id).catch(() => {});
      refreshBadges();
      setError(null);
    } catch (e) { setError(errorMessage(e)); }
    finally { setLoading(false); }
  }, [id, byName, refreshBadges]);

  useEffect(() => {
    if (!byName) return;
    groupChatApi.groups()
      .then(gs => { const g = gs.find(x => x.name.toLowerCase() === String(groupId).toLowerCase()); router.replace((g ? `/groups/${g.id}` : '/groups') as any); })
      .catch(e => { setError(errorMessage(e)); setLoading(false); });
  }, [byName, groupId, router]);

  useEffect(() => {
    if (byName) return;
    groupChatApi.groups().then(gs => { const g = gs.find(x => x.id === id); if (g) nav.setOptions({ title: g.display_name }); }).catch(() => {});
    load(); const timer = setInterval(load, 15000); return () => clearInterval(timer);
  }, [load, id, byName, nav]);

  async function send() {
    const content = text.trim();
    if (!content) return;
    setBusy(true);
    try { await groupChatApi.send(id, content, replyTo?.id); setText(''); setReplyTo(null); await load(); }
    catch (e) {
      // The request can fail after the server stored the message (connection
      // dropped mid-response, server restart). Re-read the chat and tell the
      // user what actually happened instead of a generic "cannot reach" error.
      const sent = await groupChatApi.messages(id).then(list => {
        setMessages(list);
        return list.some(m => m.sender_id === me?.id && m.content === content && Date.now() - new Date(m.created_at).getTime() < 2 * 60_000);
      }).catch(() => false);
      if (sent) { setText(''); setReplyTo(null); setError(null); }
      else setError(`Your message was not sent (${errorMessage(e)}). It is still in the box — tap Send to try again.`);
    }
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
              if (item.message_type === 'system') return <Text style={{ color: t.muted, textAlign: 'center', fontSize: 12, marginVertical: 6 }}>{item.content}</Text>;
              return (
                <Pressable onLongPress={() => showMessageActions({ content: item.is_deleted ? '' : item.content, onReply: () => setReplyTo(item) })} style={{ flexDirection: 'row', gap: 8, marginBottom: 10, alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                  {!mine ? <Avatar uri={item.sender_avatar_url} name={item.sender_name} size={28} /> : null}
                  <View>
                    {!mine ? <Text style={{ color: t.muted, fontSize: 12, marginBottom: 2 }}>{item.sender_name}</Text> : null}
                    <View style={{ backgroundColor: mine ? t.primary : t.card, borderRadius: 14, padding: 10, borderWidth: mine ? 0 : 1, borderColor: t.border }}>
                      {item.reply_to_content ? <Text style={{ color: mine ? '#dbeafe' : t.muted, fontSize: 12, fontStyle: 'italic', marginBottom: 4 }} numberOfLines={2}>↪ {item.reply_to_sender_name}: {item.reply_to_content}</Text> : null}
                      {item.is_deleted
                        ? <Text style={{ color: mine ? '#fff' : t.muted, fontSize: 15.5, lineHeight: 21, fontStyle: 'italic' }}>(deleted)</Text>
                        : <Markdown color={mine ? '#fff' : undefined}>{item.content}</Markdown>}
                    </View>
                    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 2, alignSelf: mine ? 'flex-end' : 'flex-start' }}>
                      <Text style={{ color: t.muted, fontSize: 11 }}>{timeAgo(item.created_at)}{item.is_edited ? ' · edited' : ''}</Text>
                      <Pressable onPress={async () => { await groupChatApi.like(id, item.id).catch(() => {}); load(); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                        <Ionicons name={item.user_liked ? 'heart' : 'heart-outline'} size={13} color={item.user_liked ? t.danger : t.muted} />
                        {item.total_likes ? <Text style={{ color: t.muted, fontSize: 11 }}>{item.total_likes}</Text> : null}
                      </Pressable>
                    </View>
                  </View>
                </Pressable>
              );
            }} />
        )}
        <View style={{ borderTopWidth: 1, borderTopColor: t.border, backgroundColor: t.card }}>
          {replyTo ? <Pressable onPress={() => setReplyTo(null)} style={{ paddingHorizontal: 12, paddingTop: 8 }}><Text style={{ color: t.muted, fontSize: 12 }} numberOfLines={1}>Replying to {replyTo.sender_name}: {replyTo.content}  ✕</Text></Pressable> : null}
          <View style={{ flexDirection: 'row', gap: 8, padding: 10, alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}><Input placeholder="Message the group…" value={text} onChangeText={setText} multiline style={{ minHeight: 40, maxHeight: 120 }} /></View>
            <Button title="Send" icon="send" onPress={send} loading={busy} disabled={!text.trim()} style={{ marginBottom: 12 }} />
          </View>
        </View>
      </View>
    </Screen>
  );
}
