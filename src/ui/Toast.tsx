import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from './AppText';
import { GlassSurface } from './glass/GlassSurface';
import { Icon } from './Icon';
import { TAB_BAR_HEIGHT } from './tabs/GlassTabBar';
import { useTheme } from './theme/ThemeProvider';
import { spacing } from './theme/tokens';

export type ToastTone = 'success' | 'warning' | 'error' | 'info';

interface ToastState {
  id: number;
  text: string;
  tone: ToastTone;
}

const ToastContext = createContext<(text: string, tone?: ToastTone) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text: string, tone: ToastTone = 'success') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ id: Date.now(), text, tone });
    timer.current = setTimeout(() => setToast(null), tone === 'success' ? 2_200 : 4_500);
  }, []);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast ? <ToastView key={toast.id} toast={toast} /> : null}
    </ToastContext.Provider>
  );
}

function ToastView({ toast }: { toast: ToastState }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const color = { success: colors.success, warning: colors.warning, error: colors.danger, info: colors.accent }[
    toast.tone
  ];
  const bottom = insets.bottom + (Platform.OS === 'android' ? TAB_BAR_HEIGHT + 24 : 96);
  return (
    <View pointerEvents="none" style={[styles.wrap, { bottom }]}>
      <Animated.View entering={FadeInDown} exiting={FadeOutDown}>
        <GlassSurface variant="floating" radius={20} style={styles.toast}>
          <Icon name={toast.tone === 'success' ? 'check' : 'warning'} size={18} color={color} />
          <AppText variant="subhead" weight="500" style={styles.text}>
            {toast.text}
          </AppText>
        </GlassSurface>
      </Animated.View>
    </View>
  );
}

export const useToast = () => useContext(ToastContext);

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: spacing.l, right: spacing.l, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.m,
  },
  text: { flexShrink: 1 },
});
