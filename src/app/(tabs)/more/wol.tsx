import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDeviceActions } from '@/features/devices/useDeviceActions';
import { useT } from '@/i18n';
import { useSettings, type WolEntry } from '@/state/settings';
import { ActionSheet } from '@/ui/ActionSheet';
import { AppText } from '@/ui/AppText';
import { EmptyState } from '@/ui/Feedback';
import { GlassButton } from '@/ui/GlassButton';
import { NoBlurTarget } from '@/ui/glass/BlurTarget';
import { GlassSurface } from '@/ui/glass/GlassSurface';
import { ListRow, ListSection } from '@/ui/ListSection';
import { Screen } from '@/ui/Screen';
import { TextField } from '@/ui/TextField';
import { spacing } from '@/ui/theme/tokens';
import { normalizeMac } from '@/utils/mac';

/** Saved Wake-on-LAN targets; long-press a row to delete it. */
export default function WakeOnLan() {
  const t = useT();
  const list = useSettings((s) => s.wolList);
  const addWol = useSettings((s) => s.addWol);
  const removeWol = useSettings((s) => s.removeWol);
  const actions = useDeviceActions();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<WolEntry | null>(null);

  return (
    <>
      <Screen title={t('more:wol')}>
        {list.length ? (
          <ListSection footer={t('more:wolScreen.emptyHint')}>
            {list.map((w) => (
              <ListRow
                key={w.mac}
                title={w.name}
                subtitle={w.mac}
                icon="desktop"
                right={
                  <GlassButton
                    label={t('more:wolScreen.wake')}
                    compact
                    disabled={actions.busy}
                    onPress={() => actions.wake(w.mac)}
                    testID={`wol-${w.mac}`}
                  />
                }
                onLongPress={() => setEditing(w)}
              />
            ))}
          </ListSection>
        ) : (
          <EmptyState icon="bolt" title={t('more:wolScreen.empty')} message={t('more:wolScreen.emptyHint')} />
        )}
        <GlassButton
          label={t('more:wolScreen.add')}
          icon="plus"
          variant="primary"
          onPress={() => setAdding(true)}
          testID="wol-add"
        />
      </Screen>

      {adding ? (
        <AddSheet
          onCancel={() => setAdding(false)}
          onAdd={(entry) => {
            addWol(entry);
            setAdding(false);
          }}
        />
      ) : null}
      <ActionSheet
        visible={!!editing}
        title={editing ? `${editing.name} · ${editing.mac}` : undefined}
        actions={[
          {
            label: t('more:wolScreen.delete'),
            icon: 'trash',
            destructive: true,
            onPress: () => {
              if (editing) removeWol(editing.mac);
              setEditing(null);
            },
          },
        ]}
        onCancel={() => setEditing(null)}
      />
    </>
  );
}

function AddSheet({ onAdd, onCancel }: { onAdd(entry: WolEntry): void; onCancel(): void }) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [mac, setMac] = useState('');
  const [error, setError] = useState<string | undefined>();

  const submit = () => {
    const normalized = normalizeMac(mac);
    if (!normalized) {
      setError(t('more:wolScreen.macInvalid'));
      return;
    }
    onAdd({ name: name.trim() || normalized, mac: normalized });
  };

  return (
    <Modal transparent animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <NoBlurTarget>
        <Pressable style={styles.scrim} onPress={onCancel} accessibilityLabel={t('cancel')} />
        <KeyboardAvoidingView behavior="padding" style={styles.wrap}>
          <GlassSurface variant="floating" style={[styles.sheet, { marginBottom: insets.bottom + spacing.m }]}>
            <AppText variant="title">{t('more:wolScreen.add')}</AppText>
            <TextField label={t('more:wolScreen.name')} value={name} onChangeText={setName} autoFocus />
            <TextField
              label={t('more:wolScreen.mac')}
              value={mac}
              onChangeText={(v) => {
                setMac(v);
                setError(undefined);
              }}
              placeholder="AA:BB:CC:DD:EE:FF"
              autoCapitalize="characters"
              autoCorrect={false}
              monospace
              error={error}
              returnKeyType="done"
              onSubmitEditing={submit}
              testID="wol-mac"
            />
            <GlassButton label={t('add')} variant="primary" onPress={submit} />
            <GlassButton label={t('cancel')} onPress={onCancel} />
          </GlassSurface>
        </KeyboardAvoidingView>
      </NoBlurTarget>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.35)' },
  wrap: { position: 'absolute', left: spacing.m, right: spacing.m, bottom: 0 },
  sheet: { padding: spacing.xl, gap: spacing.m },
});
