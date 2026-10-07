import { useNavigation, useRouter, type Href } from 'expo-router';
import { usePreventRemove, type NavigationAction } from 'expo-router/react-navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useT } from '@/i18n';

import { ActionSheet } from './ActionSheet';
import { EmptyState, ErrorState, Skeleton } from './Feedback';
import { GlassButton } from './GlassButton';
import { Screen } from './Screen';
import { spacing } from './theme/tokens';

export interface FormScreenProps {
  title: string;
  children: ReactNode;
  /** Something was changed and not saved: leaving asks first. */
  dirty: boolean;
  /** Set by useFormExit once the form is done, so the way out is not stopped. */
  leaving?: boolean;
  onSave(): void;
  saving?: boolean;
  saveLabel?: string;
  saveDisabled?: boolean;
  /** Editing an existing item: a red Delete under Save. */
  onDelete?(): void;
  deleteLabel?: string;
  top?: ReactNode;
  testID?: string;
}

/**
 * A form on its own page (design §8.3): the fields, then "Save and apply" and an optional Delete. Leaving
 * with unsaved changes — back button, swipe, Android back — asks before the changes are thrown away.
 */
export function FormScreen({
  title,
  children,
  dirty,
  leaving,
  onSave,
  saving,
  saveLabel,
  saveDisabled,
  onDelete,
  deleteLabel,
  top,
  testID,
}: FormScreenProps) {
  const t = useT();
  const navigation = useNavigation();
  const [blocked, setBlocked] = useState<NavigationAction | null>(null);
  usePreventRemove(dirty && !leaving, ({ data }) => setBlocked(data.action));

  return (
    <>
      <Screen title={title} top={top}>
        <View style={styles.fields} testID={testID}>
          {children}
        </View>
        <GlassButton
          label={saveLabel ?? t('saveAndApply')}
          variant="primary"
          disabled={saveDisabled || saving}
          loading={saving}
          onPress={onSave}
          testID={testID ? `${testID}-save` : undefined}
        />
        {onDelete ? (
          <GlassButton
            label={deleteLabel ?? t('delete')}
            variant="destructive"
            icon="trash"
            disabled={saving}
            onPress={onDelete}
            testID={testID ? `${testID}-delete` : undefined}
          />
        ) : null}
      </Screen>
      <ActionSheet
        visible={!!blocked}
        title={t('discardTitle')}
        message={t('discardMessage')}
        actions={[
          {
            label: t('discard'),
            destructive: true,
            onPress: () => {
              const action = blocked;
              setBlocked(null);
              if (action) navigation.dispatch(action);
            },
          },
        ]}
        cancelLabel={t('keepEditing')}
        onCancel={() => setBlocked(null)}
      />
    </>
  );
}

/**
 * Leaving a form after it was saved: first the form stops guarding (so its unsaved-changes prompt does not
 * stop us), then, once that has rendered, back — or replace with another page (a new peer's export).
 */
export function useFormExit() {
  const router = useRouter();
  const [target, setTarget] = useState<{ to?: Href } | null>(null);
  useEffect(() => {
    if (!target) return;
    if (target.to) router.replace(target.to);
    else router.back();
  }, [target, router]);
  return {
    leaving: !!target,
    back: () => setTarget({}),
    replace: (to: Href) => setTarget({ to }),
  };
}

/**
 * The item being edited as first loaded. Saving or deleting it refetches the list; the page keeps its form
 * on the way out instead of flashing "no longer exists".
 */
export function useLoaded<T>(value: T | undefined): T | undefined {
  const [kept, setKept] = useState(value);
  if (kept === undefined && value !== undefined) setKept(value);
  return kept ?? value;
}

/** Whether a form's values moved away from where they started. */
export const differs = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);

/** The page for one item while its data loads, failed to load, or the item is gone (deleted elsewhere). */
export function FormPlaceholder({
  title,
  error,
  onRetry,
  missing,
}: {
  title: string;
  error?: unknown;
  onRetry?: () => void;
  missing?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  return (
    <Screen title={title}>
      {missing ? (
        <EmptyState icon="info" title={t('itemGone')} action={{ label: t('back'), onPress: () => router.back() }} />
      ) : error ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : (
        <View style={styles.fields}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={56} radius={14} />
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fields: { gap: spacing.l },
});
