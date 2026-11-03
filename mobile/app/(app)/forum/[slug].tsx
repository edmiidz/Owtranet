import React, { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { postsApi } from '@/api';
import { errorMessage } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useAsync } from '@/lib/useAsync';
import { useBackFallback } from '@/lib/useBackFallback';
import { bytes, timeAgo } from '@/lib/format';
import { openPublicFile } from '@/lib/files';
import { Avatar, Button, Card, Chip, ErrorBox, H2, IconButton, Input, Loading, P, Screen, Small } from '@/components/ui';
import { Markdown } from '@/components/Markdown';
import { useTheme } from '@/theme';

export default function PostScreen() {
  const t = useTheme();
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const me = useAuthStore(s => s.user);
  useBackFallback('/(app)/(tabs)/forum');
  const { data: post, loading, error, reload, refresh, refreshing, setData } = useAsync(() => postsApi.get(String(slug)), [slug]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  async function vote(type: 'post' | 'comment', id: number, current: number | undefined, value: 1 | -1) {
    try { await postsApi.like(type, id, current === value ? 0 : value); refresh(); }
    catch (e) { Alert.alert('Vote failed', errorMessage(e)); }
  }

  async function submitComment() {
    if (!comment.trim() || !post) return;
    setBusy(true);
    try { await postsApi.comment(post.id, comment.trim()); setComment(''); refresh(); }
    catch (e) { Alert.alert('Could not comment', errorMessage(e)); }
    finally { setBusy(false); }
  }

  function deletePost() {
    if (!post) return;
    Alert.alert('Delete post', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { try { await postsApi.remove(post.id); router.back(); } catch (e) { Alert.alert('Failed', errorMessage(e)); } } },
    ]);
  }

  const canEdit = post && me && (post.user_id === me.id || me.role === 'admin' || me.role === 'moderator');

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : post ? (
        <>
          <Text style={{ color: t.text, fontSize: 22, fontWeight: '800', lineHeight: 29 }}>{post.title}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, marginBottom: 12 }}>
            <Pressable onPress={() => post.intranet_username && router.push(`/members/${post.intranet_username}` as any)}><Avatar uri={post.avatar_url} name={post.author_name} size={30} /></Pressable>
            <View style={{ flex: 1 }}><P style={{ fontWeight: '600' }}>{post.author_name}</P><Small>{timeAgo(post.created_at)} · {post.view_count ?? 0} views{post.visibility && post.visibility !== 'all_members' ? ` · ${post.visibility.replace('_', ' ')}` : ''}</Small></View>
            {canEdit ? <IconButton name="trash-outline" onPress={deletePost} color={t.danger} /> : null}
          </View>
          {post.tags?.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 }}>{post.tags.map(tag => <Chip key={tag.id} label={tag.name} />)}</View> : null}
          <Card><Markdown>{post.content}</Markdown>
            {post.attachment_filename ? (
              <Pressable onPress={() => openPublicFile(`/uploads/forum-attachments/${post.attachment_filename}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, padding: 10, borderRadius: 10, backgroundColor: t.chip }}>
                <Ionicons name="attach" size={20} color={t.chipText} /><View style={{ flex: 1 }}><Text style={{ color: t.chipText, fontWeight: '600' }} numberOfLines={1}>{post.attachment_original_name || post.attachment_filename}</Text><Small>{bytes(post.attachment_size)}</Small></View>
              </Pressable>
            ) : null}
          </Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 }}>
            <VoteBar score={post.score ?? 0} vote={post.user_vote} onUp={() => vote('post', post.id, post.user_vote, 1)} onDown={() => vote('post', post.id, post.user_vote, -1)} />
            <Small>{post.comments?.length ?? post.comment_count ?? 0} replies</Small>
          </View>

          <H2>Replies</H2>
          {(post.comments || []).map(c => (
            <Card key={c.id} style={{ borderColor: c.is_accepted ? t.success : t.border }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Avatar uri={c.avatar_url} name={c.author_name} size={24} />
                <Small style={{ flex: 1 }}>{c.author_name} · {timeAgo(c.created_at)}</Small>
                {c.is_accepted ? <Ionicons name="checkmark-circle" size={18} color={t.success} /> : null}
                {me && (c.user_id === me.id || me.role === 'admin') ? <IconButton name="trash-outline" size={16} color={t.muted} onPress={() => Alert.alert('Delete reply?', '', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { await postsApi.deleteComment(c.id).catch(() => {}); refresh(); } }])} /> : null}
              </View>
              <Markdown>{c.content}</Markdown>
              <VoteBar score={c.score ?? 0} vote={undefined} onUp={() => vote('comment', c.id, undefined, 1)} onDown={() => vote('comment', c.id, undefined, -1)} small />
            </Card>
          ))}
          {post.is_locked ? <P muted>This post is locked.</P> : (
            <Card>
              <Input placeholder="Write a reply… (markdown supported)" value={comment} onChangeText={setComment} multiline />
              <Button title="Reply" onPress={submitComment} loading={busy} disabled={!comment.trim()} />
            </Card>
          )}
        </>
      ) : null}
    </Screen>
  );
}

function VoteBar({ score, vote, onUp, onDown, small }: { score: number; vote?: number; onUp: () => void; onDown: () => void; small?: boolean }) {
  const t = useTheme();
  const size = small ? 18 : 22;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: small ? 6 : 0 }}>
      <IconButton name={vote === 1 ? 'arrow-up-circle' : 'arrow-up-circle-outline'} size={size} color={vote === 1 ? t.primary : t.muted} onPress={onUp} />
      <Text style={{ color: t.text, fontWeight: '700' }}>{score}</Text>
      <IconButton name={vote === -1 ? 'arrow-down-circle' : 'arrow-down-circle-outline'} size={size} color={vote === -1 ? t.danger : t.muted} onPress={onDown} />
    </View>
  );
}
