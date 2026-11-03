/**
 * Corporate Radio player (Layer 2 — app side).
 *
 * Pulls the pre-assembled feed from GET /api/radio/feed and reads it aloud with
 * the device's own TTS engine (expo-speech → AVSpeechSynthesizer / Android TTS).
 * Nothing is streamed from the server; the "station" is just text + a queue.
 */
import { create } from 'zustand';
import * as Speech from 'expo-speech';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { activatePlaybackSession, releasePlaybackSession } from '@/lib/audioSession';
import { radioApi } from '@/api';
import type { RadioFeed, RadioSegment } from '@/api/types';

const KEEP_AWAKE_TAG = 'radio';
const SETTINGS_KEY = 'intranet.radio.settings';

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'finished' | 'error';
export type QueueItem =
  | { kind: 'intro'; text: string }
  | { kind: 'segment'; segment: RadioSegment; text: string }
  | { kind: 'outro'; text: string };

export interface RadioSettings { rate: number; pitch: number; voice?: string; maxStories: number; unheardFirst: boolean; readTitles: boolean }
const DEFAULT_SETTINGS: RadioSettings = { rate: 1.0, pitch: 1.0, voice: undefined, maxStories: 20, unheardFirst: true, readTitles: false };
const FEED_WINDOW_DAYS = 90; // server maximum; the playlist is simply the newest `maxStories` within it
const LOOP_INTRO = 'That is everything for now. Replaying from the top.';

interface RadioState {
  feed: RadioFeed | null;
  queue: QueueItem[];
  index: number;
  loops: number;
  status: PlayerStatus;
  error: string | null;
  settings: RadioSettings;
  voices: Speech.Voice[];
  loadSettings: () => Promise<void>;
  updateSettings: (s: Partial<RadioSettings>) => Promise<void>;
  loadVoices: () => Promise<void>;
  loadFeed: () => Promise<RadioFeed | null>;
  play: (startIndex?: number) => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  next: () => void;
  prev: () => void;
  jumpTo: (segmentId: number) => void;
}

let playToken = 0; // invalidates stale onDone callbacks after skip/stop
let enqueued = new Set<number>(); // queue indexes already handed to AVSpeechSynthesizer for the current playToken

/** Rank a device voice: Premium > Enhanced > Compact, en-US first, nicer names first. */
export function voiceScore(v: Speech.Voice): number {
  const id = (v.identifier || '').toLowerCase();
  const lang = (v.language || '').toLowerCase();
  let score = 0;
  if (id.includes('premium')) score += 300;
  else if (id.includes('enhanced') || v.quality === Speech.VoiceQuality.Enhanced) score += 200;
  else if (id.includes('compact')) score += 0;
  else score -= 10; // unknown vendor voice: never above a plain Compact voice (a stock iPhone has nothing better)
  // Apple's novelty / sound-effect voices all live under com.apple.speech.synthesis.voice.* (Bahh, Bells,
  // Superstar, …) and the Eloquence set under com.apple.eloquence.*. Rank them below everything else.
  if (id.startsWith('com.apple.speech.synthesis.voice.') || id.includes('eloquence') || id.includes('novelty')
    || /\b(bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|albert|fred|junior|kathy|ralph|deranged|hysterical|pipe organ)\b/.test((v.name || '').toLowerCase())) score -= 500;
  if (lang === 'en-us') score += 30; else if (lang.startsWith('en')) score += 15;
  const preferred = ['ava', 'zoe', 'evan', 'nathan', 'joelle', 'samantha', 'allison', 'susan', 'tom', 'nicky', 'aaron', 'karen', 'daniel', 'moira', 'serena', 'tessa'];
  const i = preferred.indexOf((v.name || '').toLowerCase().split(' ')[0]);
  if (i >= 0) score += preferred.length - i;
  return score;
}

export function qualityLabel(v: Speech.Voice): 'Premium' | 'Enhanced' | 'Compact' {
  const id = (v.identifier || '').toLowerCase();
  if (id.includes('premium')) return 'Premium';
  if (id.includes('enhanced') || v.quality === Speech.VoiceQuality.Enhanced) return 'Enhanced';
  return 'Compact';
}

export function pickBestVoice(voices: Speech.Voice[]): Speech.Voice | undefined {
  return [...voices].filter(v => (v.language || '').toLowerCase().startsWith('en')).sort((a, b) => voiceScore(b) - voiceScore(a))[0];
}

/**
 * Voice actually handed to the synthesizer. Never leave it undefined on iOS:
 * expo-speech then uses whatever "default" voice the phone has, which is often
 * a poor one. Samantha ships on every iPhone (compact; Enhanced when downloaded)
 * and is the safe floor. A downloaded Premium/Enhanced voice still wins via
 * pickBestVoice; an explicit choice in Radio settings always wins.
 */
export const IOS_FALLBACK_VOICE = 'com.apple.voice.compact.en-US.Samantha';
export function resolveVoice(settings: RadioSettings, voices: Speech.Voice[]): string | undefined {
  if (settings.voice) return settings.voice;
  const best = pickBestVoice(voices);
  // A negative score means the "best" English voice is a novelty / sound-effect voice (Bahh, Superstar…):
  // treat that exactly like having no voice list at all and fall through to Samantha.
  if (best && voiceScore(best) >= 0) {
    // Only downloaded voices beat Samantha: with compact voices only, prefer Samantha even if
    // the phone happens to list another compact en-US voice first.
    if (qualityLabel(best) !== 'Compact') return best.identifier;
    const samantha = voices.find(v => /samantha/i.test(v.name || '') && (v.language || '').toLowerCase() === 'en-us');
    return (samantha || best).identifier;
  }
  const samantha = voices.find(v => /samantha/i.test(v.name || '') && (v.language || '').toLowerCase() === 'en-us');
  if (samantha) return samantha.identifier;
  return Platform.OS === 'ios' ? IOS_FALLBACK_VOICE : undefined;
}

/** Speak a short sample with a given voice (used by the settings screen). */
export function previewVoice(voiceId: string | undefined, rate = 1, pitch = 1) {
  Speech.stop();
  const voice = voiceId || resolveVoice({ ...DEFAULT_SETTINGS, voice: undefined }, useRadio.getState().voices);
  Speech.speak('Good morning. This is your company radio. Here are today\'s stories.', { language: 'en-US', voice, rate, pitch, useApplicationAudioSession: true });
}

function orderedSegments(feed: RadioFeed, settings: RadioSettings): RadioSegment[] {
  if (!settings.unheardFirst) return feed.segments;
  // Stable: new stories first, already-heard ones after (server order within each group).
  return [...feed.segments.filter(s => !s.heard), ...feed.segments.filter(s => s.heard)];
}

function buildQueue(feed: RadioFeed, settings: RadioSettings, loop = false): QueueItem[] {
  const items: QueueItem[] = [{ kind: 'intro', text: loop ? LOOP_INTRO : feed.station.intro_text }];
  for (const s of orderedSegments(feed, settings)) {
    const text = settings.readTitles ? `${s.headline}. ${s.tts_text}` : s.tts_text;
    items.push({ kind: 'segment', segment: s, text });
  }
  items.push({ kind: 'outro', text: feed.station.outro_text });
  return items;
}

export const useRadio = create<RadioState>((set, get) => ({
  feed: null, queue: [], index: 0, loops: 0, status: 'idle', error: null, settings: DEFAULT_SETTINGS, voices: [],

  loadSettings: async () => {
    try {
      const raw = await AsyncStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const { days: _legacyDays, unheardOnly: _legacyUnheard, ...saved } = JSON.parse(raw); // older builds used a day window
        set({ settings: { ...DEFAULT_SETTINGS, ...saved } });
      }
    } catch { /* ignore */ }
  },

  updateSettings: async (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)).catch(() => {});
    const feed = get().feed;
    if (feed && get().status !== 'playing') set({ queue: buildQueue(feed, settings) });
  },

  loadVoices: async () => {
    try {
      let voices: Speech.Voice[] = [];
      for (let attempt = 0; attempt < 4 && voices.length === 0; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 250 * attempt));
        voices = await Speech.getAvailableVoicesAsync();
      }
      if (voices.length === 0) return; // keep whatever we had; resolveVoice falls back to Samantha
      set({ voices: [...voices].sort((a, b) => voiceScore(b) - voiceScore(a)) });
    } catch { /* not supported on this platform */ }
  },

  loadFeed: async () => {
    set({ status: get().status === 'playing' ? 'playing' : 'loading', error: null });
    try {
      const { settings } = get();
      // Newest N stories (heard ones included) — a quiet week must never empty the station.
      const feed = await radioApi.feed({ days: FEED_WINDOW_DAYS, limit: settings.maxStories, unheard: 0 });
      if (get().status === 'playing') set({ feed }); // restartLoop/next rebuild the queue themselves
      else set({ feed, queue: buildQueue(feed, settings), index: 0, loops: 0, status: 'idle' });
      return feed;
    } catch (e: any) {
      set({ status: 'error', error: e?.response?.data?.error || e?.message || 'Could not load the station' });
      return null;
    }
  },

  play: async (startIndex) => {
    if (get().voices.length === 0) await get().loadVoices();
    let { queue } = get();
    if (queue.length === 0) {
      const feed = await get().loadFeed();
      if (!feed) return;
      queue = get().queue;
    }
    const index = Math.min(Math.max(startIndex ?? get().index, 0), queue.length - 1);
    Speech.stop();
    const token = ++playToken;
    enqueued = new Set();
    set({ index, status: 'playing', error: null, ...(startIndex === 0 ? { loops: 0 } : {}) });
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    await activatePlaybackSession(); // must precede speak() or iOS cuts audio on lock
    if (token !== playToken) return;
    speakItem(token, index);
  },

  pause: () => {
    if (get().status !== 'playing') return;
    if (Platform.OS === 'ios') {
      Speech.pause();
      set({ status: 'paused' });
    } else {
      // Android TTS cannot pause; stop and restart this item on resume.
      playToken++;
      Speech.stop();
      set({ status: 'paused' });
    }
  },

  resume: () => {
    if (get().status !== 'paused') return;
    if (Platform.OS === 'ios') {
      Speech.resume();
      set({ status: 'playing' });
    } else {
      get().play(get().index);
    }
  },

  stop: () => {
    playToken++;
    Speech.stop();
    deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    releasePlaybackSession();
    set({ status: 'idle' });
  },

  next: () => {
    const { index, queue } = get();
    if (index + 1 >= queue.length) { restartLoop(); return; }
    get().play(index + 1);
  },

  prev: () => {
    const { index } = get();
    get().play(Math.max(0, index - 1));
  },

  jumpTo: (segmentId) => {
    const i = get().queue.findIndex(q => q.kind === 'segment' && q.segment.segment_id === segmentId);
    if (i >= 0) get().play(i);
  },
}));

/** Stop for real — only used when the station truly has no stories at all. */
function finish() {
  playToken++;
  Speech.stop();
  deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
  releasePlaybackSession();
  useRadio.setState({ status: 'finished' });
}

/**
 * End of playlist: a radio station never goes silent. Refresh the feed (new
 * posts may have arrived), rebuild the queue with a short "replaying" intro and
 * keep going from the top. Only if there is nothing at all do we stop.
 */
async function restartLoop() {
  const state = useRadio.getState();
  const token = ++playToken;
  let feed = state.feed;
  try { feed = (await useRadio.getState().loadFeed()) || feed; } catch { /* keep the old feed */ }
  if (token !== playToken) return; // user pressed something meanwhile
  if (!feed || feed.segments.length === 0) { finish(); return; }
  const queue = buildQueue(feed, useRadio.getState().settings, true);
  enqueued = new Set();
  useRadio.setState({ queue, index: 0, loops: state.loops + 1, status: 'playing' });
  speakItem(token, 0);
}

/**
 * Hand queue item `index` to the synthesizer (if not already queued) and also
 * pre-queue `index + 1`. AVSpeechSynthesizer plays queued utterances back to
 * back, so there is never a silent gap in which iOS could suspend a locked app.
 * Every utterance uses the app's playback audio session (activated in play()).
 */
function speakItem(token: number, index: number) {
  const { queue } = useRadio.getState();
  if (!queue[index]) { restartLoop(); return; }
  enqueueItem(token, index);
  if (queue[index + 1]) enqueueItem(token, index + 1);
}

function enqueueItem(token: number, index: number) {
  if (enqueued.has(index)) return;
  const { queue, settings, voices } = useRadio.getState();
  const item = queue[index];
  if (!item) return;
  enqueued.add(index);
  const voice = resolveVoice(settings, voices);

  Speech.speak(item.text, {
    language: 'en-US',
    rate: settings.rate,
    pitch: settings.pitch,
    voice,
    useApplicationAudioSession: true,
    onStart: () => {
      if (token !== playToken) return;
      useRadio.setState({ index });
    },
    onDone: () => {
      if (token !== playToken) return; // superseded by skip/stop
      if (item.kind === 'segment') {
        radioApi.listened(item.segment.segment_id, true).catch(() => {});
        useRadio.setState(s => ({
          feed: s.feed ? { ...s.feed, segments: s.feed.segments.map(x => x.segment_id === item.segment.segment_id ? { ...x, heard: true } : x) } : s.feed,
        }));
      }
      const q = useRadio.getState().queue;
      if (index + 1 < q.length) {
        useRadio.setState({ index: index + 1 });
        speakItem(token, index + 1); // ensures index+2 is queued behind the one now playing
      } else {
        restartLoop();
      }
    },
    onStopped: () => { /* handled by pause/stop/skip */ },
    onError: () => {
      if (token !== playToken) return;
      useRadio.setState({ status: 'error', error: 'Text-to-speech failed on this device.' });
    },
  });
}

export function currentSegment(state: RadioState): RadioSegment | null {
  const item = state.queue[state.index];
  return item && item.kind === 'segment' ? item.segment : null;
}
