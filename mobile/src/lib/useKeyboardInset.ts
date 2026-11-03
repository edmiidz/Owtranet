import { useEffect, useState } from 'react';
import { Dimensions, Keyboard, KeyboardEvent, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * How much to lift a bottom-pinned composer so the keyboard does not cover it.
 *
 * We deliberately do NOT use KeyboardAvoidingView here. Its `keyboardVerticalOffset`
 * is the distance from the top of the screen to the top of the view, which depends on
 * the header height and the notch, so it was hardcoded to 90 — wrong on most devices,
 * and wrong again because `Screen` already applies the bottom safe-area inset. The two
 * stacked and pushed the message box down behind the keyboard (reported on iPhone:
 * "the message box is covered by the iPhone keyboard").
 *
 * `endCoordinates.screenY` is the keyboard's top edge in absolute screen coordinates,
 * so `screenHeight - screenY` is the exact height it covers, whatever the device. The
 * parent already reserves `insets.bottom` for the home indicator, so we subtract it to
 * avoid double-counting, and clamp at 0 for devices with no inset.
 */
export function useKeyboardInset() {
  const insets = useSafeAreaInsets();
  const [height, setHeight] = useState(0);

  useEffect(() => {
    // iOS reports the frame before the animation so the lift moves with the keyboard;
    // Android only fires the did* events.
    const showEvent = Platform.OS === 'ios' ? ('keyboardWillChangeFrame' as const) : ('keyboardDidShow' as const);
    const hideEvent = Platform.OS === 'ios' ? ('keyboardWillHide' as const) : ('keyboardDidHide' as const);

    const onShow = (e: KeyboardEvent) => {
      // screenY is the keyboard's top edge. When the keyboard is dismissed
      // interactively it slides below the screen, so screenY grows past the
      // screen height and `covered` correctly goes to 0 — using
      // endCoordinates.height instead would keep the composer floating.
      const screenHeight = Dimensions.get('window').height;
      const covered = screenHeight - e.endCoordinates.screenY;
      setHeight(Math.max(0, covered - insets.bottom));
    };
    const subs = [
      Keyboard.addListener(showEvent, onShow),
      Keyboard.addListener(hideEvent, () => setHeight(0)),
    ];
    return () => subs.forEach(s => s.remove());
  }, [insets.bottom]);

  return height;
}
