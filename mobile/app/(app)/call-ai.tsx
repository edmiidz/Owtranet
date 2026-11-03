import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, PermissionsAndroid, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import { useConversation } from '@elevenlabs/react-native';
import { aiApi } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { useRadio } from '@/stores/radio';
import { useTheme } from '@/theme';

/**
 * "Call AI" — a live voice call to the workspace's ElevenLabs agent over WebRTC
 * (via the ElevenLabs React Native SDK). The server mints a per-call conversation
 * token (POST /api/mobile/ai/session) so the app never holds the ElevenLabs key;
 * the caller's identity travels as dynamic variables on the session.
 */
type Line = { id: number; role: 'user' | 'agent'; text: string };
type Phase = 'requesting' | 'connecting' | 'connected' | 'ended';

const DARK = { bg: '#0b1220', card: '#111a2e', text: '#e5e7eb', muted: '#94a3b8', border: '#1f2a44', agent: '#1e293b', user: '#2563eb' };

function fmtClock(secs: number) {
  const m = Math.floor(secs / 60); const s = secs % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export default function CallAiScreen() {
  useKeepAwake();
  const t = useTheme();
  const router = useRouter();
  const agent = useAuthStore(s => s.aiAgent);
  const agentName = agent?.name || 'AI assistant';
  const [phase, setPhase] = useState<Phase>('requesting');
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const pulse = useRef(new Animated.Value(1)).current;
  const endedByUser = useRef(false);

  const conversation = useConversation({
    onConnect: () => { startedAt.current = Date.now(); setPhase('connected'); },
    onDisconnect: (details) => {
      setPhase('ended');
      if (details?.reason === 'error') setError(details.message || 'The call dropped.');
    },
    onError: (message) => { setError(message || 'Something went wrong with the call.'); },
    onMessage: ({ message, source }) => {
      if (!message) return;
      setLines(prev => [...prev, { id: prev.length + 1, role: source === 'user' ? 'user' : 'agent', text: message }]);
    },
  });
  const { startSession, endSession, status, isSpeaking, isMuted, setMuted } = conversation;

  const start = useCallback(async () => {
    setError(null);
    setPhase('requesting');
    useRadio.getState().stop(); // one audio session at a time
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
        title: 'Microphone', message: `Intranet needs the microphone so you can talk to ${agentName}.`, buttonPositive: 'Allow',
      });
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) { setError('Microphone access is needed to talk to the assistant. Enable it in Settings.'); setPhase('ended'); return; }
    }
    let session;
    try {
      session = await aiApi.session();
    } catch (e: any) {
      const msg = e?.response?.status === 404 ? 'Call AI is not set up on this workspace yet.' : (e?.response?.data?.error || e?.message || 'Could not start the call.');
      setError(msg); setPhase('ended'); return;
    }
    setPhase('connecting');
    startSession({
      conversationToken: session.token,
      connectionType: 'webrtc',
      dynamicVariables: session.dynamic_variables,
      userId: session.dynamic_variables.user_id,
    });
  }, [agentName, startSession]);

  useEffect(() => { start(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { try { endSession(); } catch { /* already closed */ } }, [endSession]);

  // call clock
  useEffect(() => {
    if (phase !== 'connected') return;
    const id = setInterval(() => { if (startedAt.current) setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)); }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  // pulse ring while the agent speaks (or while connecting)
  useEffect(() => {
    const active = phase === 'connecting' || (phase === 'connected' && isSpeaking);
    if (!active) { pulse.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.18, duration: 600, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [phase, isSpeaking, pulse]);

  useEffect(() => { scrollRef.current?.scrollToEnd({ animated: true }); }, [lines.length]);

  function hangUp() {
    endedByUser.current = true;
    try { endSession(); } catch { /* ignore */ }
    setPhase('ended');
    router.back();
  }

  const statusText = (() => {
    if (error) return error;
    switch (phase) {
      case 'requesting': return 'Connecting…';
      case 'connecting': return `Waiting for ${agentName}…`;
      case 'connected': return isSpeaking ? `${agentName} is speaking` : (isMuted ? 'Muted' : 'Listening');
      case 'ended': return 'Call ended';
    }
  })();
  const live = phase === 'connected' && status === 'connected';

  return (
    <View style={{ flex: 1, backgroundColor: DARK.bg }}>
      <Stack.Screen options={{ title: agentName, headerStyle: { backgroundColor: DARK.bg }, headerTintColor: DARK.text, headerShadowVisible: false,
        headerLeft: () => <Pressable onPress={hangUp} hitSlop={12} style={{ paddingHorizontal: 4 }}><Ionicons name="chevron-down" size={26} color={DARK.text} /></Pressable> }} />

      <View style={{ alignItems: 'center', paddingTop: 18, paddingBottom: 8 }}>
        <View style={{ width: 128, height: 128, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View style={{ position: 'absolute', width: 120, height: 120, borderRadius: 60, backgroundColor: t.primary, opacity: 0.25, transform: [{ scale: pulse }] }} />
          <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={live ? (isSpeaking ? 'volume-high' : 'mic') : 'call'} size={40} color="#fff" />
          </View>
        </View>
        <Text style={{ color: DARK.text, fontSize: 22, fontWeight: '700', marginTop: 8 }}>{agentName}</Text>
        <Text style={{ color: error ? '#f87171' : DARK.muted, marginTop: 4, textAlign: 'center', paddingHorizontal: 24 }}>{statusText}</Text>
        {phase === 'connected' ? <Text style={{ color: DARK.muted, marginTop: 2, fontVariant: ['tabular-nums'] }}>{fmtClock(elapsed)}</Text> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: DARK.card, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: DARK.border }}>
          <Ionicons name="flash-outline" size={12} color="#fbbf24" />
          <Text style={{ color: DARK.muted, fontSize: 11 }}>Direct connection · knows the intranet</Text>
        </View>
      </View>

      <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 8 }}>
        {lines.length === 0 ? (
          <Text style={{ color: DARK.muted, textAlign: 'center', marginTop: 24 }}>
            {live ? `Ask ${agentName} to find a post, look someone up, or post an update for the team.` : ' '}
          </Text>
        ) : lines.map(l => (
          <View key={l.id} style={{ alignSelf: l.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%', backgroundColor: l.role === 'user' ? DARK.user : DARK.agent, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 }}>
            <Text style={{ color: '#fff', fontSize: 15, lineHeight: 20 }}>{l.text}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 28, paddingVertical: 24, paddingBottom: 40 }}>
        <Pressable onPress={() => setMuted(!isMuted)} disabled={!live}
          style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: isMuted ? '#fff' : DARK.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DARK.border, opacity: live ? 1 : 0.4 }}>
          <Ionicons name={isMuted ? 'mic-off' : 'mic'} size={26} color={isMuted ? DARK.bg : DARK.text} />
        </Pressable>
        {phase === 'ended' ? (
          <Pressable onPress={start} style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: '#16a34a', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="call" size={30} color="#fff" />
          </Pressable>
        ) : (
          <Pressable onPress={hangUp} style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: '#dc2626', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="call" size={30} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
          </Pressable>
        )}
        <Pressable onPress={() => router.back()} style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: DARK.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DARK.border }}>
          <Ionicons name="close" size={26} color={DARK.text} />
        </Pressable>
      </View>
    </View>
  );
}
