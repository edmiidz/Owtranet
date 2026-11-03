import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { tasksApi } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { useAsync } from '@/lib/useAsync';
import { errorMessage } from '@/api/client';
import { formatDate, humanStatus, timeAgo } from '@/lib/format';
import { Avatar, Button, Card, Chip, ErrorBox, H2, Input, Loading, P, Row, Screen, Small, StatusPill } from '@/components/ui';
import { Markdown } from '@/components/Markdown';
import type { TaskPriority, TaskStatus } from '@/api/types';

const STATUSES: TaskStatus[] = ['pending', 'in_progress', 'completed'];
const PRIORITIES: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const taskId = Number(id);
  const router = useRouter();
  const user = useAuthStore(s => s.user);

  const task = useAsync(() => tasksApi.get(taskId), [taskId]);
  const comments = useAsync(() => tasksApi.comments(taskId), [taskId]);
  const people = useAsync(() => tasksApi.users(), []);

  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [assigning, setAssigning] = useState(false);

  const t = task.data;
  const canDelete = !!t && !!user && (t.created_by === user.id || user.role === 'admin');

  async function patch(body: Parameters<typeof tasksApi.update>[1], label: string) {
    setSaving(true);
    try {
      await tasksApi.update(taskId, body);
      await task.refresh();
    } catch (e) {
      Alert.alert(`Could not update ${label}`, errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function addComment() {
    const content = draft.trim();
    if (!content) return;
    setPosting(true);
    try {
      await tasksApi.comment(taskId, content);
      setDraft('');
      await comments.refresh();
      await task.refresh(); // comment_count
    } catch (e) {
      Alert.alert('Could not post comment', errorMessage(e));
    } finally {
      setPosting(false);
    }
  }

  function confirmDelete() {
    Alert.alert('Delete task', 'This removes the task, its comments and its history. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try { await tasksApi.remove(taskId); router.back(); }
          catch (e) { Alert.alert('Could not delete', errorMessage(e)); }
        },
      },
    ]);
  }

  if (task.loading) return <Screen><Loading /></Screen>;
  if (task.error || !t) return <Screen><ErrorBox message={task.error || 'Task not found'} onRetry={task.reload} /></Screen>;

  return (
    <Screen refreshing={task.refreshing} onRefresh={() => { task.refresh(); comments.refresh(); }}>
      <Card>
        <P style={{ fontWeight: '700', fontSize: 18 }}>{t.title}</P>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <StatusPill status={t.status} />
          {t.priority !== 'normal' ? <Small>{humanStatus(t.priority)} priority</Small> : null}
          {t.due_date ? <Small>· Due {formatDate(t.due_date)}</Small> : null}
        </View>
        <Small style={{ marginTop: 8 }}>
          Created by {t.creator_name || 'someone'} {timeAgo(t.created_at)}
        </Small>
      </Card>

      {t.description ? <Card><Markdown>{t.description}</Markdown></Card> : null}

      <H2>Status</H2>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {STATUSES.map(s => (
          <Chip key={s} label={humanStatus(s)} active={t.status === s} onPress={() => { if (!saving && t.status !== s) patch({ status: s }, 'status'); }} />
        ))}
      </View>

      <H2>Priority</H2>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {PRIORITIES.map(p => (
          <Chip key={p} label={humanStatus(p)} active={t.priority === p} onPress={() => { if (!saving && t.priority !== p) patch({ priority: p }, 'priority'); }} />
        ))}
      </View>

      <H2>Assignee</H2>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <Row
          avatar={{ uri: t.assignee_avatar, name: t.assignee_name }}
          title={t.assignee_name || 'Unassigned'}
          subtitle={assigning ? 'Pick someone below' : 'Tap to change'}
          chevron={false}
          onPress={() => setAssigning(a => !a)}
        />
        {assigning ? (
          <>
            <Row icon="close-circle-outline" title="Unassigned" chevron={false}
              onPress={() => { setAssigning(false); patch({ assigned_to: null }, 'assignee'); }} />
            {(people.data || []).map(u => (
              <Row key={u.id} avatar={{ uri: u.avatar_url, name: u.name }} title={u.name}
                subtitle={u.id === user?.id ? 'You' : u.intranet_username || undefined} chevron={false}
                onPress={() => { setAssigning(false); patch({ assigned_to: u.id }, 'assignee'); }} />
            ))}
            {people.loading ? <Loading /> : null}
          </>
        ) : null}
      </Card>

      <H2>Comments{t.comment_count ? ` (${t.comment_count})` : ''}</H2>
      {comments.loading ? <Loading /> : comments.error ? <ErrorBox message={comments.error} onRetry={comments.reload} /> : (
        <>
          {(comments.data || []).map(c => (
            <Card key={c.id}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Avatar uri={c.author_avatar} name={c.author_name} size={28} />
                <Small style={{ fontWeight: '700' }}>{c.author_name}</Small>
                <Small>· {timeAgo(c.created_at)}</Small>
              </View>
              <Markdown>{c.content}</Markdown>
            </Card>
          ))}
          {!comments.data?.length ? <Small style={{ marginBottom: 8 }}>No comments yet.</Small> : null}
        </>
      )}

      <Input placeholder="Add a comment" value={draft} onChangeText={setDraft} multiline style={{ minHeight: 80 }} />
      <Button title={posting ? 'Posting…' : 'Post comment'} onPress={addComment} loading={posting} disabled={!draft.trim() || posting} style={{ marginTop: 8 }} />

      {canDelete ? (
        <Button title="Delete task" variant="secondary" onPress={confirmDelete} style={{ marginTop: 20 }} />
      ) : null}
    </Screen>
  );
}
