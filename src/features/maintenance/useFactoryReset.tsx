import { useRouter } from 'expo-router';
import { useState } from 'react';

import { useActiveRouter } from '@/features/routers/ActiveRouterProvider';
import { useT } from '@/i18n';
import { RiskConfirm } from '@/ui/RiskConfirm';

import { BackupFirst } from './BackupFirst';

/** MO-10 from the More tab: offer a backup, then the high-risk confirmation, then the progress screen. */
export function useFactoryReset() {
  const t = useT();
  const nav = useRouter();
  const { router } = useActiveRouter();
  const [step, setStep] = useState<'backup' | 'confirm' | null>(null);
  const element = (
    <>
      <BackupFirst visible={step === 'backup'} onCancel={() => setStep(null)} onContinue={() => setStep('confirm')} />
      <RiskConfirm
        visible={step === 'confirm'}
        level="high"
        title={t('more:resetScreen.confirmTitle')}
        consequences={[
          t('more:resetScreen.risks.erase'),
          t('more:resetScreen.risks.address'),
          t('more:resetScreen.risks.wifi'),
          t('more:resetScreen.risks.power'),
        ]}
        confirmPhrase={router?.name}
        confirmLabel={t('more:resetScreen.confirm')}
        onConfirm={() => {
          setStep(null);
          nav.push('/maintenance?mode=reset');
        }}
        onCancel={() => setStep(null)}
      />
    </>
  );
  return { open: () => setStep('backup'), element };
}
