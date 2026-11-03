import React, { useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { tasksApi } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { useAsync } from '@/lib/useAsync';
import { formatDate, humanStatus } from '@/lib/format';
import { Button, Card, Chip, Empty, ErrorBox, Input, Loading, Row, Screen, Small, StatusPill } from '@/components/ui';
import { useTheme } from '@/theme';
import type { TaskStatus } from '@/api/types';

const VIEWS = [{ k: 'mine', label: 'Mine' }, { k: 'all', label: 'Everyone' }] as const;
const STATUSES = ['all', 'pending', 'in_progress', 'completed'] as const;

/** Overdue and due-today are the two things worth flagging in a list; anything else is noise. */
function dueLabel(due?: string | null, status?: TaskStatus): { text: string; overdue: boolean } | null {
  if (!due) return null;
  if (status === 'completed') return { text: `Was due ${formatDate(due)}`, overdue: false };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(due); d.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { text: `Overdue · ${formatDate(due)}`, overdue: true };
  if (days === 0) return { text: 'Due today', overdue: true };
  if (days === 1) return { text: 'Due tomorrow', overdue: false };
  return { text: `Due ${formatDate(due)}`, overdue: false };
}

export default function TasksScreen() {
  const router = useRouter();
  const theme = useTheme();
  const user = useAuthStore(s => s.user);
  const [view, setView] = useState<'all' | 'mine'>('mine');
  const [status, setStatus] = useState<'all' | TaskStatus>('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  const { data, loading, error, reload, refresh, refreshing, refreshIfLoaded } = useAsync(
    () => tasksApi.list({
      view,
      limit: 50,
      sort: 'due_date',
      ...(status === 'all' ? {} : { status }),
      ...(query ? { search: query } : {}),
    }),
    [view, status, query]
  );
  // Coming back from a detail or create screen should show the change without a manual pull.
  useFocusEffect(refreshIfLoaded);

  const tasks = data?.tasks || [];
  const open = tasks.filter(t => t.status !== 'completed').length;

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Button title="New task" icon="add-circle-outline" onPress={() => router.push('/tasks/new')} style={{ marginBottom: 12 }} />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 }}>
        {VIEWS.map(v => <Chip key={v.k} label={v.label} active={view === v.k} onPress={() => setView(v.k)} />)}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
        {STATUSES.map(s => <Chip key={s} label={humanStatus(s)} active={status === s} onPress={() => setStatus(s)} />)}
      </View>
      <Input
        placeholder="Search tasks"
        value={search}
        onChangeText={setSearch}
        onSubmitEditing={() => setQuery(search.trim())}
        returnKeyType="search"
        autoCapitalize="none"
        style={{ marginBottom: 10 }}
      />

      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : !tasks.length ? (
        <Empty
          icon="checkmark-done-outline"
          title={query ? 'No matching tasks' : view === 'mine' ? 'No tasks for you' : 'No tasks yet'}
          hint={query ? 'Try a different search.' : 'Create one with the button above.'}
        />
      ) : (
        <>
          <Small style={{ marginBottom: 8 }}>{tasks.length} shown · {open} open</Small>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {tasks.map(task => {
              const due = dueLabel(task.due_date, task.status);
              const mine = task.assigned_to === user?.id;
              const bits = [
                task.assignee_name ? (mine ? 'You' : task.assignee_name) : 'Unassigned',
                task.priority !== 'normal' ? humanStatus(task.priority) : null,
                task.comment_count ? `${task.comment_count} comment${task.comment_count === 1 ? '' : 's'}` : null,
              ].filter(Boolean);
              return (
                <Row
                  key={task.id}
                  avatar={{ uri: task.assignee_avatar, name: task.assignee_name }}
                  title={task.title}
                  subtitle={bits.join(' · ')}
                  right={
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <StatusPill status={task.status} />
                      {due ? <Small style={due.overdue ? { color: theme.danger, fontWeight: '700' } : undefined}>{due.text}</Small> : null}
                    </View>
                  }
                  onPress={() => router.push(`/tasks/${task.id}` as any)}
                />
              );
            })}
          </Card>
          {data?.pagination && data.pagination.total > tasks.length ? (
            <Small style={{ textAlign: 'center', marginTop: 10 }}>
              Showing {tasks.length} of {data.pagination.total} — narrow with a filter or search.
            </Small>
          ) : null}
        </>
      )}
    </Screen>
  );
}
