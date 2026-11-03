import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { tasksApi } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { useAsync } from '@/lib/useAsync';
import { errorMessage } from '@/api/client';
import { humanStatus } from '@/lib/format';
import { Button, Card, Chip, H2, Input, Row, Screen, Small } from '@/components/ui';
import type { TaskPriority } from '@/api/types';

const PRIORITIES: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];
const DUE_PRESETS = [
  { label: 'No date', days: null },
  { label: 'Today', days: 0 },
  { label: 'Tomorrow', days: 1 },
  { label: 'Next week', days: 7 },
] as const;

/** The API stores due_date as a DATE, so send a plain YYYY-MM-DD in local time. */
function isoDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function NewTaskScreen() {
  const router = useRouter();
  const user = useAuthStore(s => s.user);
  const people = useAsync(() => tasksApi.users(), []);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [dueDays, setDueDays] = useState<number | null>(null);
  const [assignee, setAssignee] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);

  const assigneeName = assignee == null ? 'Unassigned'
    : assignee === user?.id ? 'Me'
    : (people.data || []).find(u => u.id === assignee)?.name || 'Someone';

  async function create() {
    const t = title.trim();
    if (!t) return;
    setSaving(true);
    try {
      const { taskId } = await tasksApi.create({
        title: t,
        description: description.trim() || undefined,
        priority,
        due_date: dueDays === null ? null : isoDate(dueDays),
        assigned_to: assignee,
      });
      // Replace so Back from the task lands on the list, not this form.
      router.replace(`/tasks/${taskId}` as any);
    } catch (e) {
      Alert.alert('Could not create task', errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Input label="Title" placeholder="What needs doing?" value={title} onChangeText={setTitle} autoFocus />
      <Input label="Description" placeholder="Optional. Markdown supported." value={description} onChangeText={setDescription} multiline style={{ minHeight: 100 }} />

      <H2>Priority</H2>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {PRIORITIES.map(p => <Chip key={p} label={humanStatus(p)} active={priority === p} onPress={() => setPriority(p)} />)}
      </View>

      <H2>Due</H2>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {DUE_PRESETS.map(d => <Chip key={d.label} label={d.label} active={dueDays === d.days} onPress={() => setDueDays(d.days)} />)}
      </View>

      <H2>Assign to</H2>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <Row icon="person-outline" title={assigneeName} subtitle="Tap to change" chevron={false} onPress={() => setPicking(p => !p)} />
        {picking ? (
          <>
            <Row icon="close-circle-outline" title="Unassigned" chevron={false} onPress={() => { setAssignee(null); setPicking(false); }} />
            {(people.data || []).map(u => (
              <Row key={u.id} avatar={{ uri: u.avatar_url, name: u.name }} title={u.name}
                subtitle={u.id === user?.id ? 'You' : u.intranet_username || undefined} chevron={false}
                onPress={() => { setAssignee(u.id); setPicking(false); }} />
            ))}
          </>
        ) : null}
      </Card>
      {people.error ? <Small style={{ marginTop: 6 }}>Could not load people — you can still create the task unassigned.</Small> : null}

      <Button title={saving ? 'Creating…' : 'Create task'} onPress={create} loading={saving} disabled={!title.trim() || saving} style={{ marginTop: 20 }} />
    </Screen>
  );
}
