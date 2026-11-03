import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { postsApi } from '@/api';
import type { Post } from '@/api/types';
import { errorMessage } from '@/api/client';
import { timeAgo } from '@/lib/format';
import { Avatar, Button, Chip, Empty, ErrorBox, IconButton, Input, Loading, Screen } from '@/components/ui';
import { useTheme } from '@/theme';

const SORTS = [['recent', 'Recent'], ['popular', 'Popular'], ['unanswered', 'Unanswered'], ['oldest', 'Oldest']] as const;

export default function ForumScreen() {
  const t = useTheme();
  const router = useRouter();
  const [posts, setPosts] = useState<Post[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [sort, setSort] = useState<string>('recent');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p = 1, silent = false) => {
    if (p === 1 && !silent) setLoading(true);
    if (silent) setRefreshing(true);
    setError(null);
    try {
      const r = await postsApi.list({ page: p, limit: 20, sort, search: query || undefined });
      setPosts(prev => (p === 1 ? r.posts : [...prev, ...r.posts]));
      setPage(r.pagination.page); setPages(r.pagination.pages);
    } catch (e) { setError(errorMessage(e)); }
    finally { setLoading(false); setRefreshing(false); }
  }, [sort, query]);

  useEffect(() => { load(1); }, [load]);
  // Silent refresh on return (after creating a post, say) — via refs so the callback never sees stale state.
  const loadRef = useRef(load); loadRef.current = load;
  const loadingRef = useRef(loading); loadingRef.current = loading;
  useFocusEffect(useCallback(() => { if (!loadingRef.current) loadRef.current(1, true); }, []));

  const header = (
    <View style={{ padding: 16, paddingBottom: 6 }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Input placeholder="Search posts…" value={search} onChangeText={setSearch} returnKeyType="search" onSubmitEditing={() => setQuery(search.trim())} style={{ marginBottom: 0 }} />
        </View>
        {query ? <IconButton name="close-circle" onPress={() => { setSearch(''); setQuery(''); }} /> : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 }}>
        {SORTS.map(([k, label]) => <Chip key={k} label={label} active={sort === k} onPress={() => setSort(k)} />)}
      </View>
    </View>
  );

  return (
    <Screen scroll={false} padded={false}>
      {error ? <View style={{ padding: 16 }}><ErrorBox message={error} onRetry={() => load(1)} /></View> : null}
      <FlatList
        data={posts}
        keyExtractor={p => String(p.id)}
        ListHeaderComponent={header}
        ListEmptyComponent={loading ? <Loading /> : <Empty icon="chatbubbles-outline" title="No posts" hint={query ? 'Try a different search.' : 'Be the first to post.'} />}
        refreshing={refreshing}
        onRefresh={() => load(1, true)}
        onEndReached={() => { if (page < pages && !loading) load(page + 1); }}
        onEndReachedThreshold={0.4}
        contentContainerStyle={{ paddingBottom: 90 }}
        renderItem={({ item }) => (
          <View style={{ marginHorizontal: 16, marginBottom: 10, backgroundColor: t.card, borderRadius: 14, borderWidth: 1, borderColor: t.border, padding: 14 }}
            onTouchEnd={undefined}>
            <Text onPress={() => router.push(`/forum/${item.slug}` as any)} style={{ color: t.text, fontSize: 16, fontWeight: '700' }}>
              {item.is_pinned ? '📌 ' : ''}{item.title}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <Avatar uri={item.avatar_url} name={item.author_name} size={22} />
              <Text style={{ color: t.muted, fontSize: 12.5, flex: 1 }} numberOfLines={1}>{item.author_name} · {timeAgo(item.created_at)}</Text>
              <Ionicons name="chatbubble-outline" size={14} color={t.muted} /><Text style={{ color: t.muted, fontSize: 12.5 }}>{item.comment_count ?? 0}</Text>
              {item.visibility && item.visibility !== 'all_members' ? <Ionicons name="lock-closed-outline" size={14} color={t.muted} /> : null}
            </View>
            {item.tags && item.tags.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>{item.tags.map(tag => <Chip key={tag.id} label={tag.name} onPress={() => { setSearch(tag.name); setQuery(tag.name); }} />)}</View> : null}
          </View>
        )}
      />
      <View style={{ position: 'absolute', right: 18, bottom: 22 }}>
        <Button title="Post" icon="create-outline" onPress={() => router.push('/forum/create')} style={{ borderRadius: 999, paddingHorizontal: 18, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, elevation: 4 }} />
      </View>
    </Screen>
  );
}
