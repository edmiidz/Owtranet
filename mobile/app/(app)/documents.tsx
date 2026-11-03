import React from 'react';
import { useRouter } from 'expo-router';
import { deliverablesApi, postsApi } from '@/api';
import { useAsync } from '@/lib/useAsync';
import { bytes, timeAgo } from '@/lib/format';
import { downloadAndShare, openPublicFile } from '@/lib/files';
import { Card, Empty, ErrorBox, H2, Loading, P, Row, Screen } from '@/components/ui';

/** Document sharing = every file attached to a post or a deliverable you can see. */
export default function DocumentsScreen() {
  const router = useRouter();
  const { data, loading, error, reload, refresh, refreshing } = useAsync(async () => {
    const [posts, deliverables] = await Promise.all([
      postsApi.list({ limit: 100, sort: 'recent' }).then(r => r.posts.filter(p => p.attachment_filename)),
      deliverablesApi.list().then(d => d.filter(x => x.attachments && x.attachments.length)).catch(() => []),
    ]);
    return { posts, deliverables };
  }, []);

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <P muted style={{ marginBottom: 10 }}>Files shared on forum posts and investment-tracker deliverables. Attach a file to a new post to share it with the team.</P>
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={reload} /> : data ? (
        <>
          <H2>Post attachments</H2>
          {data.posts.length === 0 ? <Empty icon="document-outline" title="No files on recent posts" /> : (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {data.posts.map(p => (
                <Row key={p.id} icon="document-attach-outline" title={p.attachment_original_name || p.attachment_filename!}
                  subtitle={`${p.title} · ${p.author_name} · ${timeAgo(p.created_at)}${p.attachment_size ? ` · ${bytes(p.attachment_size)}` : ''}`}
                  onPress={() => openPublicFile(`/uploads/forum-attachments/${p.attachment_filename}`)} chevron={false} />
              ))}
            </Card>
          )}
          {data.deliverables.length > 0 ? (
            <>
              <H2>Deliverable documents</H2>
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                {data.deliverables.flatMap(d => (d.attachments || []).map(a => (
                  <Row key={`${d.id}-${a.id}`} icon="receipt-outline" title={a.file_name} subtitle={`${d.title} · ${bytes(a.file_size)}`}
                    onPress={() => downloadAndShare(`/api/deliverables/documents/${a.file_path.split('/').pop()}`, a.file_name)} chevron={false} />
                )))}
              </Card>
            </>
          ) : null}
          <Row icon="add-circle-outline" title="Share a new file" subtitle="Create a post with an attachment" onPress={() => router.push('/forum/create')} />
        </>
      ) : null}
    </Screen>
  );
}
