import { BlurTargetView } from 'expo-blur';
import { createContext, useContext, useRef, type ReactNode, type RefObject } from 'react';
import { Platform, View, type StyleProp, type ViewStyle } from 'react-native';

const BlurTargetContext = createContext<RefObject<View | null> | null>(null);

/**
 * Android blur samples a BlurTargetView. Wrap the area that holds both the content and the floating
 * glass (tab bar) in the provider, and the scrolling content alone in <BlurTarget>.
 */
export function BlurTargetProvider({ children }: { children: ReactNode }) {
  const ref = useRef<View | null>(null);
  return <BlurTargetContext.Provider value={ref}>{children}</BlurTargetContext.Provider>;
}

export function BlurTarget({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const ref = useContext(BlurTargetContext);
  if (Platform.OS !== 'android' || !ref) return <View style={style}>{children}</View>;
  return (
    <BlurTargetView ref={ref} style={style}>
      {children}
    </BlurTargetView>
  );
}

export const useBlurTarget = () => useContext(BlurTargetContext);

/**
 * For content rendered in a separate window (RN Modal): a blur there would sample the main window's
 * target at the wrong place, so glass inside falls back to its translucent fill.
 */
export function NoBlurTarget({ children }: { children: ReactNode }) {
  return <BlurTargetContext.Provider value={null}>{children}</BlurTargetContext.Provider>;
}
