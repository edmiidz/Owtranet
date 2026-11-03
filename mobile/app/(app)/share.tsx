import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { messagesApi, postsApi, usersApi } from '@/api';
import type { User } from '@/api/types';
import { errorMessage } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { Avatar, Button, Card, Input, P, Screen, Small } from '@/components/ui';
import { useTheme } from '@/theme';
import { cleanSharedText, formatSharedNote } from '@/lib/shareText';

type Mode = 'post' | 'dm';

/**
 * Receives content from the iOS share sheet / Android "Share to…" (via
 * expo-share-intent in the root layout), a deep link
 * intranet://share?url=&title=&text=, or the clipboard. The mobile counterpart
 * of the Chrome "post creator" extension — with a second choice: send it as a
 * direct message to a teammate instead of posting to the forum.
 */
export default function QuickShareScreen() {
  const t = useTheme();
  const router = useRouter();
  const me = useAuthStore(s => s.user);
  const params = useLocalSearchParams<{ url?: string; title?: string; text?: string }>();
  const [mode, setMode] = useState<Mode | null>(null);
  const [url, setUrl] = useState(params.url || '');
  const [title, setTitle] = useState(params.title || '');
  const [note, setNote] = useState(params.text || '');
  const [members, setMembers] = useState<User[]>([]);
  const [memberQuery, setMemberQuery] = useState('');
  const [recipient, setRecipient] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setUrl(params.url || ''); setTitle(params.title || ''); setNote(params.text || ''); }, [params.url, params.title, params.text]);

  useEffect(() => {
    if (url) return;
    Clipboard.getStringAsync().then(s => { if (/^https?:\/\/\S+$/i.test((s || '').trim())) setUrl(s.trim()); }).catch(() => {});
  }, [url]);

  useEffect(() => {
    if (mode === 'dm' && members.length === 0) usersApi.list().then(setMembers).catch(() => {});
  }, [mode, members.length]);

  const memberList = useMemo(() => members
    .filter(u => u.id !== me?.id && !['pending', 'deactivated', 'system'].includes(u.role))
    .filter(u => !memberQuery || u.name.toLowerCase().includes(memberQuery.toLowerCase())), [members, memberQuery, me?.id]);

  const shared = url.trim() || note.trim();
  const displayTitle = title.trim() || url.replace(/^https?:\/\//, '').slice(0, 120);

  async function postToForum() {
    if (!shared) { Alert.alert('Nothing to share', 'Paste a link or some text first.'); return; }
    setBusy(true);
    try {
      const body = [formatSharedNote(note), url.trim() ? `🔗 [${displayTitle}](${url.trim()})` : ''].filter(Boolean).join('\n\n') + '\n\n_Shared from mobile_';
      const heading = displayTitle || cleanSharedText(note).text.slice(0, 80);
      const r = await postsApi.create({ title: heading.length < 5 ? `Shared: ${heading}` : heading, content: body, tags: ['shared-link'] });
      // Land on the Forum tab first so the post has a screen beneath it (back button works).
      router.replace('/(app)/(tabs)/forum' as any);
      router.push(`/forum/${r.slug}` as any);
    } catch (e) { Alert.alert('Could not post', errorMessage(e)); }
    finally { setBusy(false); }
  }

  async function sendDm() {
    if (!recipient) { Alert.alert('Pick a recipient'); return; }
    if (!shared) { Alert.alert('Nothing to share'); return; }
    setBusy(true);
    try {
      const content = [cleanSharedText(note).text, url.trim()].filter(Boolean).join('\n');
      const r = await messagesApi.send(recipient.id, content);
      router.replace('/(app)/(tabs)/messages' as any);
      router.push(`/messages/${r.conversation_id}` as any);
    } catch (e) { Alert.alert('Could not send', errorMessage(e)); }
    finally { setBusy(false); }
  }

  const Choice = ({ icon, label, hint, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; hint: string; onPress: () => void }) => (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 14, backgroundColor: pressed ? t.chip : t.card, borderWidth: 1, borderColor: t.border, marginBottom: 10 })}>
      <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icon} size={22} color="#fff" /></View>
      <View style={{ flex: 1 }}><Text style={{ color: t.text, fontWeight: '700', fontSize: 16 }}>{label}</Text><Small>{hint}</Small></View>
      <Ionicons name="chevron-forward" size={18} color={t.muted} />
    </Pressable>
  );

  return (
    <Screen>
      {/* What is being shared */}
      <Card>
        <Small style={{ fontWeight: '600', marginBottom: 6 }}>Sharing</Small>
        {url ? <Text style={{ color: t.primary, fontWeight: '600' }} numberOfLines={2}>{url}</Text> : null}
        {title ? <Text style={{ color: t.text, marginTop: 4 }} numberOfLines={2}>{title}</Text> : null}
        {!url && !note ? <P muted>Nothing yet. Use the iOS share sheet from any app and pick Intranet, or paste a link below.</P> : null}
        {!url ? <Button title="Paste link from clipboard" variant="ghost" icon="clipboard-outline" onPress={async () => setUrl((await Clipboard.getStringAsync()).trim())} style={{ marginTop: 6, alignSelf: 'flex-start' }} /> : null}
      </Card>

      {mode === null ? (
        <>
          <P muted style={{ marginBottom: 10 }}>Where should this go?</P>
          <Choice icon="chatbubbles-outline" label="Post to the forum" hint="Everyone can see it, and it goes on the radio." onPress={() => setMode('post')} />
          <Choice icon="mail-outline" label="Send as a direct message" hint="Privately to one teammate." onPress={() => setMode('dm')} />
        </>
      ) : mode === 'post' ? (
        <Card>
          <Input label="Link" value={url} onChangeText={setUrl} autoCapitalize="none" keyboardType="url" placeholder="https://…" />
          <Input label="Title" value={title} onChangeText={setTitle} placeholder="What is it?" />
          <Input label="Why it matters (optional)" value={note} onChangeText={setNote} multiline />
          <Button title="Post to forum" icon="chatbubbles-outline" onPress={postToForum} loading={busy} />
          <Button title="Send as a message instead" variant="ghost" onPress={() => setMode('dm')} style={{ marginTop: 6 }} />
        </Card>
      ) : (
        <Card>
          {recipient ? (
            <Pressable onPress={() => setRecipient(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <Avatar uri={recipient.avatar_url} name={recipient.name} /><View style={{ flex: 1 }}><Text style={{ color: t.text, fontWeight: '700' }}>{recipient.name}</Text><Small>Tap to change</Small></View>
            </Pressable>
          ) : (
            <>
              <Input label="To" placeholder="Find a teammate…" value={memberQuery} onChangeText={setMemberQuery} autoFocus />
              <View style={{ maxHeight: 260, marginBottom: 12 }}>
                {members.length === 0 ? <Small>Loading members…</Small> : memberList.slice(0, 30).map(u => (
                  <Pressable key={u.id} onPress={() => setRecipient(u)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 }}>
                    <Avatar uri={u.avatar_url} name={u.name} size={30} /><View style={{ flex: 1 }}><Text style={{ color: t.text, fontWeight: '600' }}>{u.name}</Text><Small>{u.position || u.email}</Small></View>
                  </Pressable>
                ))}
              </View>
            </>
          )}
          {recipient ? (
            <>
              <Input label="Message" value={note} onChangeText={setNote} multiline placeholder="Add a note (the link is sent with it)" />
              {url ? <Small style={{ marginBottom: 10 }}>Link: {url}</Small> : null}
              <Button title={`Send to ${recipient.name.split(' ')[0]}`} icon="send" onPress={sendDm} loading={busy} />
            </>
          ) : null}
          <Button title="Post to the forum instead" variant="ghost" onPress={() => setMode('post')} style={{ marginTop: 6 }} />
        </Card>
      )}
    </Screen>
  );
}
