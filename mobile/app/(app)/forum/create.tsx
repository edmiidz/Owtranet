import React, { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { postsApi, usersApi } from '@/api';
import { errorMessage } from '@/api/client';
import { Button, Card, Chip, Input, P, Screen, Small } from '@/components/ui';
import { useTheme } from '@/theme';

type Vis = 'all_members' | 'specific_members' | 'author_only';

export default function CreatePostScreen() {
  const t = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ title?: string; content?: string; tags?: string }>();
  const [title, setTitle] = useState(params.title || '');
  const [content, setContent] = useState(params.content || '');
  const [tags, setTags] = useState(params.tags || '');
  const [visibility, setVisibility] = useState<Vis>('all_members');
  const [members, setMembers] = useState<Array<{ id: number; name: string }>>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [attachment, setAttachment] = useState<{ filename: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (visibility === 'specific_members' && members.length === 0) usersApi.list().then(u => setMembers(u.map(x => ({ id: x.id, name: x.name })))).catch(() => {}); }, [visibility, members.length]);

  async function pickAttachment() {
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    const form = new FormData();
    form.append('attachment', { uri: a.uri, name: a.name, type: a.mimeType || 'application/octet-stream' } as any);
    try {
      const r = await postsApi.uploadAttachment(form);
      setAttachment({ filename: r.filename || r.attachment_filename || r.file?.filename, name: a.name });
    } catch (e) { Alert.alert('Upload failed', errorMessage(e)); }
  }

  async function submit() {
    if (title.trim().length < 5) { Alert.alert('Title must be at least 5 characters'); return; }
    if (content.trim().length < 10) { Alert.alert('Content must be at least 10 characters'); return; }
    setBusy(true);
    try {
      const r = await postsApi.create({
        title: title.trim(), content: content.trim(),
        tags: tags.split(',').map(x => x.trim()).filter(Boolean),
        visibility, visible_to_users: visibility === 'specific_members' ? selected : undefined,
        attachment_filename: attachment?.filename,
      });
      router.replace(`/forum/${r.slug}` as any);
    } catch (e) { Alert.alert('Could not post', errorMessage(e)); }
    finally { setBusy(false); }
  }

  return (
    <Screen>
      <Card>
        <Input label="Title" value={title} onChangeText={setTitle} placeholder="What's this about?" />
        <Input label="Content (markdown)" value={content} onChangeText={setContent} multiline placeholder="Share an update, ask a question…" style={{ minHeight: 160 }} />
        <Input label="Tags (comma separated)" value={tags} onChangeText={setTags} autoCapitalize="none" placeholder="announcement, sales, help" />
        <Small style={{ marginBottom: 6, fontWeight: '600' }}>Who can see this</Small>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
          {([['all_members', 'Everyone'], ['specific_members', 'Specific members'], ['author_only', 'Only me']] as const).map(([k, l]) => <Chip key={k} label={l} active={visibility === k} onPress={() => setVisibility(k)} />)}
        </View>
        {visibility === 'specific_members' ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
            {members.map(m => <Chip key={m.id} label={m.name} active={selected.includes(m.id)} onPress={() => setSelected(s => s.includes(m.id) ? s.filter(x => x !== m.id) : [...s, m.id])} />)}
            {members.length === 0 ? <Small>Loading members…</Small> : null}
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <Button title={attachment ? 'Replace attachment' : 'Attach a file'} variant="secondary" icon="attach" onPress={pickAttachment} />
          {attachment ? <Text style={{ color: t.muted, flex: 1 }} numberOfLines={1}>{attachment.name}</Text> : null}
        </View>
        <Button title="Publish" onPress={submit} loading={busy} />
      </Card>
      <P muted>Posts feed the company radio: a spoken summary is generated automatically for everyone allowed to see it.</P>
    </Screen>
  );
}
