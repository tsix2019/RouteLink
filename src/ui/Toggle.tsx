import { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, Switch } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { useTheme } from './theme/ThemeProvider';

const IOS_GREEN = '#34C759';
const WIDTH = 51;
const HEIGHT = 31;
const THUMB = 27;

export interface ToggleProps {
  value: boolean;
  onValueChange?: (value: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}

/** iOS system switch on iOS; an iOS-style capsule switch elsewhere. */
export function Toggle({ value, onValueChange, disabled, accessibilityLabel }: ToggleProps) {
  if (Platform.OS === 'ios') {
    return <Switch value={value} onValueChange={onValueChange} disabled={disabled} accessibilityLabel={accessibilityLabel} />;
  }
  return <CapsuleSwitch value={value} onValueChange={onValueChange} disabled={disabled} accessibilityLabel={accessibilityLabel} />;
}

function CapsuleSwitch({ value, onValueChange, disabled, accessibilityLabel }: ToggleProps) {
  const { scheme } = useTheme();
  const progress = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    progress.set(withSpring(value ? 1 : 0, { damping: 18, stiffness: 260 }));
  }, [value, progress]);
  const off = scheme === 'dark' ? '#39393D' : '#E9E9EA';

  const track = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.get(), [0, 1], [off, IOS_GREEN]),
  }));
  const thumb = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.get() * (WIDTH - THUMB - 4) }],
  }));

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={() => onValueChange?.(!value)}
      hitSlop={8}
      style={{ opacity: disabled ? 0.5 : 1 }}>
      <Animated.View style={[styles.track, track]}>
        <Animated.View style={[styles.thumb, thumb]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { width: WIDTH, height: HEIGHT, borderRadius: HEIGHT / 2, padding: 2, justifyContent: 'center' },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: '#FFFFFF',
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
  },
});
