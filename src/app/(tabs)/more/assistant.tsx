import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { makeProvider, presetOf, PRESETS, type PresetId } from '@/ai/presets';
import { AiError } from '@/ai/types';
import { useT } from '@/i18n';
import { getApiKey, setApiKey, useAssistant } from '@/state/assistant';
import { AppText } from '@/ui/AppText';
import { GlassButton } from '@/ui/GlassButton';
import { GlassCard } from '@/ui/GlassCard';
import { ListRow, ListSection } from '@/ui/ListSection';
import { RiskConfirm } from '@/ui/RiskConfirm';
import { Screen } from '@/ui/Screen';
import { SelectSheet } from '@/ui/SelectSheet';
import { TextField } from '@/ui/TextField';
import { spacing } from '@/ui/theme/tokens';
import { useToast } from '@/ui/Toast';

type PrivacyKey = 'names' | 'ips' | 'macs' | 'logs';
const KINDS: PrivacyKey[] = ['names', 'ips', 'macs', 'logs'];

/** Design §18: provider, model and key; what the AI may see; the saved conversations. */
export default function AssistantSettings() {
  const t = useT();
  const toast = useToast();
  const provider = useAssistant((s) => s.provider);
  const privacy = useAssistant((s) => s.privacy);
  const setProvider = useAssistant((s) => s.setProvider);
  const setPrivacy = useAssistant((s) => s.setPrivacy);
  const clearAll = useAssistant((s) => s.clear);
  const preset = presetOf(provider.preset);
  const [keySaved, setKeySaved] = useState(false);
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
  const [model, setModel] = useState(provider.model);
  const [models, setModels] = useState<string[]>([]);
  const [picking, setPicking] = useState<'preset' | 'model' | null>(null);
  const [testing, setTesting] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    let live = true;
    void getApiKey(preset.id).then((k) => live && setKeySaved(!!k));
    return () => {
      live = false;
    };
  }, [preset.id]);

  const save = async () => {
    setProvider({ baseUrl: baseUrl.trim(), model: model.trim() });
    if (key.trim()) {
      await setApiKey(preset.id, key);
      setKey('');
      setKeySaved(true);
    }
    toast(t('assistant:setup.saved'));
  };

  const test = async () => {
    setTesting(true);
    try {
      await save();
      const apiKey = (await getApiKey(preset.id)) ?? '';
      const list = await makeProvider(
        { preset: preset.id, baseUrl: baseUrl.trim(), model: model.trim() },
        apiKey,
        (url, init) => fetch(url, init),
      ).listModels();
      setModels(list);
      toast(t('assistant:setup.testOk', { count: list.length }));
    } catch (error) {
      const kind = error instanceof AiError ? error.kind : 'other';
      toast(t(`assistant:error.${kind}`, { message: error instanceof Error ? error.message : String(error) }), 'error');
    } finally {
      setTesting(false);
    }
  };

  const modelChoices = [...new Set([...preset.models, ...models])];

  return (
    <>
      <Screen title={t('assistant:settings')}>
        <ListSection>
          <ListRow
            title={t('assistant:setup.provider')}
            value={t(`assistant:setup.presets.${preset.id}`)}
            chevron
            onPress={() => setPicking('preset')}
            testID="assistant-preset"
          />
        </ListSection>
        <GlassCard>
          {preset.editableUrl ? (
            <TextField
              label={t('assistant:setup.baseUrl')}
              value={baseUrl}
              onChangeText={setBaseUrl}
              hint={t('assistant:setup.baseUrlHint')}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          ) : null}
          <TextField
            label={t('assistant:setup.model')}
            value={model}
            onChangeText={setModel}
            hint={t('assistant:setup.modelHint')}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {modelChoices.length ? (
            <GlassButton
              label={t('assistant:setup.model')}
              compact
              icon="chevronDown"
              onPress={() => setPicking('model')}
            />
          ) : null}
          <TextField
            label={t('assistant:setup.apiKey')}
            value={key}
            onChangeText={setKey}
            placeholder={keySaved ? t('assistant:setup.apiKeySaved') : undefined}
            hint={t('assistant:setup.apiKeyHint')}
            secret
            autoCapitalize="none"
            testID="assistant-key"
          />
        </GlassCard>
        <View style={styles.buttons}>
          <GlassButton
            label={t('assistant:setup.test')}
            loading={testing}
            onPress={() => void test()}
            style={styles.flex}
            testID="assistant-test"
          />
          <GlassButton
            label={t('assistant:setup.save')}
            variant="primary"
            onPress={() => void save()}
            style={styles.flex}
            testID="assistant-save"
          />
        </View>
        {keySaved ? (
          <ListSection>
            <ListRow
              title={t('assistant:setup.apiKeyRemove')}
              destructive
              onPress={() => void setApiKey(preset.id, null).then(() => setKeySaved(false))}
            />
          </ListSection>
        ) : null}

        <ListSection title={t('assistant:setup.privacy')} footer={t('assistant:setup.privacyFooter')}>
          {KINDS.map((k) => (
            <ListRow
              key={k}
              title={t(`assistant:setup.${k}`)}
              switchValue={privacy[k]}
              onSwitch={(on) => setPrivacy({ [k]: on })}
              testID={`assistant-privacy-${k}`}
            />
          ))}
          <ListRow
            title={t('assistant:setup.mask')}
            subtitle={t('assistant:setup.maskHint')}
            switchValue={privacy.mask}
            onSwitch={(mask) => setPrivacy({ mask })}
          />
        </ListSection>

        <ListSection title={t('assistant:setup.history')} footer={t('assistant:setup.historyFooter')}>
          <ListRow title={t('assistant:setup.clearAll')} destructive onPress={() => setConfirmClear(true)} />
        </ListSection>
        <AppText variant="footnote" tone="secondary" style={styles.note}>
          {t('assistant:consent.privacy')}
        </AppText>
      </Screen>

      <SelectSheet
        visible={picking === 'preset'}
        title={t('assistant:setup.provider')}
        options={PRESETS.map((p) => ({ value: p.id, label: t(`assistant:setup.presets.${p.id}`) }))}
        value={preset.id}
        onSelect={(value) => {
          setPicking(null);
          const next = presetOf(value as PresetId);
          setProvider({ preset: next.id });
          setKey('');
          setModels([]);
          setModel(next.models[0] ?? '');
          setBaseUrl(next.editableUrl ? next.baseUrl : '');
        }}
        onCancel={() => setPicking(null)}
      />
      <SelectSheet
        visible={picking === 'model'}
        title={t('assistant:setup.model')}
        options={modelChoices.map((m) => ({ value: m, label: m }))}
        value={model}
        onSelect={(value) => {
          setPicking(null);
          setModel(value);
        }}
        onCancel={() => setPicking(null)}
      />
      <RiskConfirm
        visible={confirmClear}
        level="medium"
        title={t('assistant:setup.clearAll')}
        consequences={[t('assistant:clearConsequence')]}
        confirmLabel={t('assistant:setup.clearAll')}
        onConfirm={() => {
          setConfirmClear(false);
          clearAll();
          toast(t('assistant:setup.cleared'));
        }}
        onCancel={() => setConfirmClear(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  buttons: { flexDirection: 'row', gap: spacing.s },
  flex: { flex: 1 },
  note: { paddingHorizontal: spacing.l },
});
