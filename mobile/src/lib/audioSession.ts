import { setAudioModeAsync, setIsAudioActiveAsync } from 'expo-audio';

/**
 * iOS suspends an app on screen lock unless it owns an active *playback* audio
 * session (plus the UIBackgroundModes=audio entitlement declared in app.json).
 * expo-speech drives AVSpeechSynthesizer but never touches the session, so the
 * radio would stop the moment the phone locked. Activate before speaking,
 * release when the station stops.
 */
let active = false;

export async function activatePlaybackSession() {
  if (active) return;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,        // radio should play with the mute switch on, like a podcast app
      shouldPlayInBackground: true,   // keep the session alive when locked / backgrounded
      interruptionMode: 'duckOthers', // lower music instead of stopping it
      allowsRecording: false,
      shouldRouteThroughEarpiece: false,
    });
    await setIsAudioActiveAsync(true);
    active = true;
  } catch (e) {
    console.warn('[radio] audio session not activated:', (e as Error).message);
  }
}

export async function releasePlaybackSession() {
  if (!active) return;
  active = false;
  try { await setIsAudioActiveAsync(false); } catch { /* ignore */ }
}
