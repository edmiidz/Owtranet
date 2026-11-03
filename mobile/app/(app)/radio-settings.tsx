import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radioApi } from '@/api';
import { pickBestVoice, previewVoice, qualityLabel, resolveVoice, useRadio } from '@/stores/radio';
import { useBadges } from '@/stores/badges';
import { openExternal } from '@/lib/files';
import { Button, Card, Chip, H2, P, Screen, Small } from '@/components/ui';
import { useTheme } from '@/theme';

export default function RadioSettingsScreen() {
  const t = useTheme();
  const { settings, updateSettings, voices, loadVoices, loadFeed } = useRadio();
  const refreshBadges = useBadges(s => s.refresh);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { loadVoices(); }, [loadVoices]);

  const best = useMemo(() => pickBestVoice(voices), [voices]);
  const english = useMemo(() => voices.filter(v => (v.language || '').toLowerCase().startsWith('en')), [voices]);
  const shown = showAll ? english : english.filter(v => qualityLabel(v) !== 'Compact' || v === best).slice(0, 12);
  const hasGoodVoice = english.some(v => qualityLabel(v) !== 'Compact');

  function choose(id: string | undefined) {
    updateSettings({ voice: id });
    previewVoice(id, settings.rate, settings.pitch);
  }

  return (
    <Screen>
      <Card>
        <H2 style={{ marginTop: 0 }}>Voice</H2>
        <Small style={{ marginBottom: 8 }}>Voices come from iOS/Android, not the app. Tap one to hear a sample.</Small>

        <Pressable onPress={() => choose(undefined)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.border }}>
          <Ionicons name={!settings.voice ? 'radio-button-on' : 'radio-button-off'} size={20} color={!settings.voice ? t.primary : t.muted} />
          <View style={{ flex: 1 }}><Text style={{ color: t.text, fontWeight: '600' }}>Best available (automatic)</Text><Small>{(() => { const id = resolveVoice({ ...settings, voice: undefined }, voices); const v = voices.find(x => x.identifier === id); return v ? `${v.name} · ${qualityLabel(v)} · ${v.language}` : id ? 'Samantha · Compact · en-US' : 'Loading voices…'; })()}</Small></View>
          <Ionicons name="volume-medium-outline" size={18} color={t.muted} />
        </Pressable>

        {shown.map(v => {
          const q = qualityLabel(v);
          const active = settings.voice === v.identifier;
          return (
            <Pressable key={v.identifier} onPress={() => choose(v.identifier)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.border }}>
              <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={20} color={active ? t.primary : t.muted} />
              <View style={{ flex: 1 }}><Text style={{ color: t.text, fontWeight: '600' }}>{v.name}</Text><Small>{v.language}</Small></View>
              <Text style={{ color: q === 'Premium' ? t.success : q === 'Enhanced' ? t.primary : t.muted, fontSize: 12, fontWeight: '700' }}>{q}</Text>
              <Ionicons name="volume-medium-outline" size={18} color={t.muted} />
            </Pressable>
          );
        })}
        {english.length > shown.length || showAll ? <Button title={showAll ? 'Show fewer' : `Show all ${english.length} English voices`} variant="ghost" onPress={() => setShowAll(v => !v)} /> : null}

        {!hasGoodVoice ? (
          <View style={{ backgroundColor: t.chip, borderRadius: 10, padding: 12, marginTop: 10 }}>
            <Text style={{ color: t.chipText, fontWeight: '700', marginBottom: 4 }}>Get a much nicer voice (one-time download)</Text>
            <Text style={{ color: t.chipText, lineHeight: 20 }}>iPhone: Settings → Accessibility → Spoken Content → Voices → English → pick Samantha and download the Enhanced version (or Ava, Zoe, Evan or Nathan Premium). Then come back here and it appears in this list. Siri's own voices are not available to apps.</Text>
            <Button title="Open Settings" variant="secondary" onPress={() => openExternal('App-Prefs:ACCESSIBILITY')} style={{ marginTop: 10 }} />
          </View>
        ) : null}
      </Card>

      <Card>
        <H2 style={{ marginTop: 0 }}>Pace</H2>
        <Small style={{ marginBottom: 6 }}>Speed</Small>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>{[0.8, 0.9, 1.0, 1.1, 1.25, 1.5].map(r => <Chip key={r} label={`${r}×`} active={settings.rate === r} onPress={() => { updateSettings({ rate: r }); previewVoice(settings.voice || best?.identifier, r, settings.pitch); }} />)}</View>
        <Small style={{ marginBottom: 6 }}>Pitch</Small>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{[0.9, 1.0, 1.1].map(p => <Chip key={p} label={`${p}`} active={settings.pitch === p} onPress={() => { updateSettings({ pitch: p }); previewVoice(settings.voice || best?.identifier, settings.rate, p); }} />)}</View>
      </Card>

      <Card>
        <H2 style={{ marginTop: 0 }}>What plays</H2>
        <Small style={{ marginBottom: 8 }}>The station never goes silent: when every story has played it starts again from the top, and stories you have already heard stay in the playlist.</Small>
        <Small style={{ marginBottom: 6 }}>Playlist size (newest stories first)</Small>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>{[10, 20, 50].map(n => <Chip key={n} label={`${n} stories`} active={settings.maxStories === n} onPress={() => updateSettings({ maxStories: n }).then(() => loadFeed())} />)}</View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <Chip label="New stories first" active={settings.unheardFirst} onPress={() => updateSettings({ unheardFirst: !settings.unheardFirst }).then(() => loadFeed())} />
          <Chip label="Read headlines first" active={settings.readTitles} onPress={() => updateSettings({ readTitles: !settings.readTitles })} />
        </View>
      </Card>

      <Card>
        <H2 style={{ marginTop: 0 }}>History</H2>
        <Button title="Replay everything (reset listening history)" variant="secondary" onPress={() => Alert.alert('Reset history?', 'All stories will be marked unheard.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Reset', onPress: async () => { await radioApi.reset().catch(() => {}); await loadFeed(); refreshBadges(); } }])} />
      </Card>
      <P muted>Stories are summaries of intranet posts you have permission to see, generated on the server. Audio is produced on your phone, so nothing is recorded or uploaded.</P>
    </Screen>
  );
}
