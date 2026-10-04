import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useT } from '@/i18n';
import { sortedRouters, useRouters } from '@/state/routers';
import { useSettings } from '@/state/settings';
import { useSnapshots } from '@/state/snapshots';
import { EmptyState } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { Icon } from '@/ui/Icon';
import { ListRow, ListSection } from '@/ui/ListSection';
import { HeaderButton, Screen } from '@/ui/Screen';
import { Badge } from '@/ui/Status';
import { useTheme } from '@/ui/theme/ThemeProvider';
import { spacing } from '@/ui/theme/tokens';
import { isHttps } from '@/utils/url';

/**
 * Saved routers in switcher order. Edit mode reorders with up/down buttons (the plan's fallback to
 * drag-and-drop; see the execution log), otherwise a row opens the router's settings.
 */
export default function Routers() {
  const t = useT();
  const nav = useRouter();
  const { colors } = useTheme();
  const routers = sortedRouters(useRouters((s) => s.routers));
  const activeId = useRouters((s) => s.activeId);
  const reorder = useRouters((s) => s.reorder);
  const demoMode = useSettings((s) => s.demoMode);
  const snapshots = useSnapshots((s) => s.byRouter);
  const [editing, setEditing] = useState(false);

  const move = (index: number, delta: -1 | 1) => {
    const ids = routers.map((r) => r.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorder(ids);
  };

  return (
    <Screen
      title={t('more:manageRouters')}
      headerRight={
        routers.length > 1 ? (
          <HeaderButton
            icon={editing ? 'check' : 'edit'}
            accessibilityLabel={editing ? t('more:routersScreen.done') : t('more:routersScreen.edit')}
            onPress={() => setEditing((e) => !e)}
            testID="routers-edit"
          />
        ) : undefined
      }>
      {routers.length ? (
        <ListSection>
          {routers.map((r, i) => (
            <ListRow
              key={r.id}
              title={r.name}
              subtitle={[r.baseUrl.replace(/^https?:\/\//, ''), snapshots[r.id]?.model ?? r.model]
                .filter(Boolean)
                .join(' · ')}
              icon="router"
              right={
                editing ? (
                  <View style={styles.moves}>
                    <MoveButton
                      icon="up"
                      label={t('more:routersScreen.moveUp')}
                      disabled={i === 0}
                      onPress={() => move(i, -1)}
                    />
                    <MoveButton
                      icon="down"
                      label={t('more:routersScreen.moveDown')}
                      disabled={i === routers.length - 1}
                      onPress={() => move(i, 1)}
                    />
                  </View>
                ) : (
                  <View style={styles.badges}>
                    {!isHttps(r.baseUrl) ? <Badge label={t('routers:insecure')} tone="warning" /> : null}
                    {!demoMode && r.id === activeId ? <Icon name="check" size={18} color={colors.accent} /> : null}
                  </View>
                )
              }
              chevron={!editing}
              onPress={editing ? undefined : () => nav.push(`/more/router/${encodeURIComponent(r.id)}`)}
              testID={`router-${r.id}`}
            />
          ))}
        </ListSection>
      ) : (
        <EmptyState icon="router" title={t('more:routersScreen.empty')} />
      )}
      <GlassButton
        label={t('more:routersScreen.add')}
        icon="plus"
        variant="primary"
        onPress={() => nav.push('/add-router')}
        testID="routers-add"
      />
    </Screen>
  );
}

function MoveButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: 'up' | 'down';
  label: string;
  disabled: boolean;
  onPress(): void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={[styles.move, { backgroundColor: colors.fill }, disabled && styles.disabled]}>
      <Icon name={icon} size={16} color={colors.accent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  moves: { flexDirection: 'row', gap: spacing.s },
  move: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.3 },
});
