import { ActionSheetIOS, Alert, Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { activatePlaybackSession, releasePlaybackSession } from '@/lib/audioSession';
import { pickBestVoice, useRadio } from '@/stores/radio';

/**
 * Read one message aloud with the device TTS engine. iOS only produces sound
 * when the app owns an active playback audio session (the radio does the same
 * dance); without it Speak was silent with the mute switch on and failed
 * outright after the radio had released the session. Uses the listener's radio
 * voice / speed so it sounds like the station.
 */
function speak(content: string) {
  const radio = useRadio.getState();
  if (radio.status === 'playing') radio.pause();
  Speech.stop();
  const { settings, voices } = radio;
  const done = () => { if (useRadio.getState().status !== 'playing') releasePlaybackSession().catch(() => {}); };
  activatePlaybackSession().catch(() => {}).then(() => {
    Speech.speak(content, {
      language: 'en-US',
      rate: settings.rate,
      pitch: settings.pitch,
      voice: settings.voice || pickBestVoice(voices)?.identifier,
      useApplicationAudioSession: true,
      onDone: done,
      onStopped: done,
      onError: (e) => { done(); Alert.alert('Could not speak', (e as Error)?.message || 'The speech engine returned an error.'); },
    });
  });
}

/**
 * Long-press menu for a chat message (TestFlight feedback: "pressing down on a
 * message should show a contextual menu with options like copy and speak").
 * Native action sheet on iOS, an Alert with buttons on Android. "Speak" uses the
 * device's own TTS engine (expo-speech), the same one the radio uses.
 */
export function showMessageActions(opts: { content: string; onReply?: () => void; onDelete?: () => void }) {
  const content = (opts.content || '').trim();
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

  const actions: Array<{ label: string; run: () => void; destructive?: boolean }> = [];
  if (opts.onReply) actions.push({ label: 'Reply', run: opts.onReply });
  if (content) {
    actions.push({ label: 'Copy', run: () => { Clipboard.setStringAsync(content).catch(() => {}); } });
    actions.push({ label: 'Speak', run: () => speak(content) });
  }
  if (opts.onDelete) actions.push({ label: 'Delete', run: opts.onDelete, destructive: true });
  if (!actions.length) return;

  if (Platform.OS === 'ios') {
    const labels = [...actions.map(a => a.label), 'Cancel'];
    const destructiveButtonIndex = actions.findIndex(a => a.destructive);
    ActionSheetIOS.showActionSheetWithOptions(
      { options: labels, cancelButtonIndex: labels.length - 1, destructiveButtonIndex: destructiveButtonIndex >= 0 ? destructiveButtonIndex : undefined },
      (i) => { const a = actions[i]; if (a) a.run(); }
    );
  } else {
    Alert.alert('Message', content.length > 140 ? `${content.slice(0, 140)}…` : content, [
      ...actions.map(a => ({ text: a.label, onPress: a.run, style: a.destructive ? 'destructive' as const : 'default' as const })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }
}
