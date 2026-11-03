import React, { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { currentSegment, useRadio } from '@/stores/radio';
import { useAuthStore } from '@/stores/auth';
import { useBadges } from '@/stores/badges';
import { secondsToClock, timeAgo } from '@/lib/format';
import { Card, Empty, ErrorBox, H2, IconButton, Loading, P, Screen, Small } from '@/components/ui';
import { useTheme } from '@/theme';

export default function RadioScreen() {
  const t = useTheme();
  const router = useRouter();
  const radio = useRadio();
  const branding = useAuthStore(s => s.branding);
  const refreshBadges = useBadges(s => s.refresh);
  const seg = currentSegment(radio);
  const item = radio.queue[radio.index];
  const playing = radio.status === 'playing';
  const stationName = radio.feed?.station.name || `${branding?.companyShortName || 'Company'} Radio`;

  useEffect(() => { if (!radio.feed) radio.loadFeed(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (radio.status === 'finished') refreshBadges(); }, [radio.status, refreshBadges]);

  const nowPlayingText = item?.kind === 'intro' ? 'Station intro' : item?.kind === 'outro' ? 'Sign-off' : seg ? seg.headline : 'Tap play to start';
  const total = radio.feed?.segments.length ?? 0;
  const segIndex = seg ? radio.feed!.segments.findIndex(s => s.segment_id === seg.segment_id) + 1 : 0;

  return (
    <Screen refreshing={radio.status === 'loading'} onRefresh={() => radio.loadFeed()}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <View><Small>Personalized audio news</Small><Text style={{ color: t.text, fontSize: 24, fontWeight: '800' }}>{stationName}</Text></View>
        <IconButton name="options-outline" onPress={() => router.push('/radio-settings')} />
      </View>

      <Card style={{ backgroundColor: t.primary, borderColor: t.primary }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: playing ? '#4ade80' : '#c7d2fe' }} />
          <Text style={{ color: '#e0e7ff', fontSize: 12, fontWeight: '700', letterSpacing: 1 }}>{playing ? (radio.loops > 0 ? 'ON AIR · REPLAY' : 'ON AIR') : radio.status === 'paused' ? 'PAUSED' : radio.status === 'finished' ? 'NO STORIES' : 'READY'}</Text>
          {seg ? <Text style={{ color: '#e0e7ff', fontSize: 12, marginLeft: 'auto' }}>{segIndex} / {total}</Text> : null}
        </View>
        <Text style={{ color: '#fff', fontSize: 19, fontWeight: '700', lineHeight: 26 }} numberOfLines={3}>{nowPlayingText}</Text>
        {seg ? <Text style={{ color: '#e0e7ff', marginTop: 4 }}>{seg.author.name} · {timeAgo(seg.posted_at)} · ~{secondsToClock(seg.est_duration_secs)}</Text> : null}
        {radio.feed && !seg ? <Text style={{ color: '#e0e7ff', marginTop: 4 }}>{radio.feed.station.unheard} new · {total} stories · ~{Math.max(1, Math.round(radio.feed.station.est_total_secs / 60))} min · loops when done</Text> : null}

        <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 22, marginTop: 18 }}>
          <Pressable onPress={radio.prev} disabled={radio.index === 0} hitSlop={10}><Ionicons name="play-skip-back" size={30} color={radio.index === 0 ? '#93c5fd' : '#fff'} /></Pressable>
          <Pressable hitSlop={10} onPress={() => { if (playing) radio.pause(); else if (radio.status === 'paused') radio.resume(); else radio.play(radio.status === 'finished' || radio.status === 'idle' ? 0 : undefined); }}
            style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={playing ? 'pause' : 'play'} size={36} color={t.primary} style={{ marginLeft: playing ? 0 : 4 }} />
          </Pressable>
          <Pressable onPress={radio.next} disabled={!radio.queue.length} hitSlop={10}><Ionicons name="play-skip-forward" size={30} color="#fff" /></Pressable>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 14 }}>
          <Pressable onPress={radio.stop}><Text style={{ color: '#e0e7ff', fontWeight: '600' }}>Stop</Text></Pressable>
          {seg ? <Pressable onPress={() => router.push(`/forum/${seg.slug}` as any)}><Text style={{ color: '#e0e7ff', fontWeight: '600' }}>Open post</Text></Pressable> : null}
          <Pressable onPress={() => radio.loadFeed()}><Text style={{ color: '#e0e7ff', fontWeight: '600' }}>Refresh</Text></Pressable>
        </View>
      </Card>

      {radio.status === 'error' && radio.error ? <ErrorBox message={radio.error} onRetry={() => radio.loadFeed()} /> : null}
      {radio.status === 'loading' && !radio.feed ? <Loading /> : null}

      {radio.feed ? (
        <>
          <H2>Playlist</H2>
          <P muted style={{ marginBottom: 8 }}>{radio.feed.station.intro_text}</P>
          {radio.feed.segments.length === 0 ? <Empty icon="radio-outline" title="No stories yet" hint="Nothing has been posted on the intranet in the last 90 days. The station starts as soon as someone posts." /> : null}
          {radio.feed.segments.map((s, i) => {
            const active = seg?.segment_id === s.segment_id;
            return (
              <Pressable key={s.segment_id} onPress={() => radio.jumpTo(s.segment_id)}
                style={{ flexDirection: 'row', gap: 12, padding: 12, borderRadius: 12, backgroundColor: active ? t.chip : t.card, borderWidth: 1, borderColor: active ? t.primary : t.border, marginBottom: 8, opacity: s.heard && !active ? 0.6 : 1 }}>
                <View style={{ width: 28, alignItems: 'center', paddingTop: 2 }}>
                  {active && playing ? <Ionicons name="volume-high" size={18} color={t.primary} /> : s.heard ? <Ionicons name="checkmark-circle" size={18} color={t.success} /> : <Text style={{ color: t.muted, fontWeight: '700' }}>{i + 1}</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.text, fontWeight: '700', fontSize: 15 }}>{s.headline}</Text>
                  <Text style={{ color: t.muted, fontSize: 12.5, marginTop: 2 }}>{s.author.name} · {timeAgo(s.posted_at)} · {secondsToClock(s.est_duration_secs)}{s.tags.length ? ` · ${s.tags.join(', ')}` : ''}</Text>
                  {active ? <Text style={{ color: t.text, marginTop: 8, lineHeight: 21 }}>{s.tts_text}</Text> : null}
                </View>
              </Pressable>
            );
          })}
        </>
      ) : null}
    </Screen>
  );
}
