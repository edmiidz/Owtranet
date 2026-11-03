import React, { useState } from 'react';
import { useRouter } from 'expo-router';
import { searchApi } from '@/api';
import type { SearchResults } from '@/api/types';
import { errorMessage } from '@/api/client';
import { timeAgo } from '@/lib/format';
import { Card, Empty, ErrorBox, H2, Input, Loading, Row, Screen } from '@/components/ui';

export default function SearchScreen() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (q.trim().length < 2) return;
    setLoading(true); setError(null);
    try { setResults(await searchApi.search(q.trim())); }
    catch (e) { setError(errorMessage(e)); }
    finally { setLoading(false); }
  }

  const empty = results && !(results.posts?.length || results.comments?.length || results.users?.length || results.agents?.length || results.investments?.length);

  return (
    <Screen>
      <Input placeholder="Search everything…" value={q} onChangeText={setQ} autoFocus returnKeyType="search" onSubmitEditing={run} />
      {loading ? <Loading /> : error ? <ErrorBox message={error} onRetry={run} /> : empty ? <Empty icon="search-outline" title="No results" /> : results ? (
        <>
          {results.users?.length ? <><H2>People</H2><Card style={{ padding: 0, overflow: 'hidden' }}>{results.users.map(u => <Row key={u.id} avatar={{ uri: u.avatar_url, name: u.name }} title={u.name} subtitle={u.position || u.email} onPress={() => router.push(`/members/${u.intranet_username || u.github_username || u.id}` as any)} />)}</Card></> : null}
          {results.agents?.length ? <><H2>AI Agents</H2><Card style={{ padding: 0, overflow: 'hidden' }}>{results.agents.map(a => <Row key={a.id} avatar={{ uri: a.avatar_url, name: a.name }} title={a.name} subtitle={a.tagline || `@${a.handle}`} onPress={() => router.push(`/members/${a.handle}` as any)} />)}</Card></> : null}
          {results.posts?.length ? <><H2>Posts</H2><Card style={{ padding: 0, overflow: 'hidden' }}>{results.posts.map(p => <Row key={p.id} icon="document-text-outline" title={p.title} subtitle={`${p.author_name} · ${timeAgo(p.created_at)}`} onPress={() => router.push(`/forum/${p.slug}` as any)} />)}</Card></> : null}
          {results.comments?.length ? <><H2>Replies</H2><Card style={{ padding: 0, overflow: 'hidden' }}>{results.comments.map((c: any) => <Row key={c.id} icon="chatbubble-outline" title={c.content?.slice(0, 80) || ''} subtitle={`${c.author_name} · ${timeAgo(c.created_at)}`} onPress={() => c.post_slug && router.push(`/forum/${c.post_slug}` as any)} chevron={!!c.post_slug} />)}</Card></> : null}
          {results.investments?.length ? <><H2>Investments</H2><Card style={{ padding: 0, overflow: 'hidden' }}>{results.investments.map(d => <Row key={d.id} icon="trending-up-outline" title={d.title} subtitle={`${d.user_name || ''} · ${d.status}`} onPress={() => router.push(`/investments/${d.id}` as any)} />)}</Card></> : null}
        </>
      ) : null}
    </Screen>
  );
}
