import { useRouter } from 'expo-router';
import { useState } from 'react';

import { useT } from '@/i18n';
import { RiskConfirm } from '@/ui/RiskConfirm';

/** Reboot entry used by Overview and More: confirm, then the full-screen progress screen. */
export function useRebootConfirm() {
  const t = useT();
  const nav = useRouter();
  const [visible, setVisible] = useState(false);
  const element = (
    <RiskConfirm
      visible={visible}
      level="medium"
      disruptive
      title={t('overview:reboot.confirmTitle')}
      consequences={[t('overview:reboot.consequenceOffline'), t('overview:reboot.consequenceUnsaved')]}
      confirmLabel={t('overview:reboot.confirm')}
      onCancel={() => setVisible(false)}
      onConfirm={() => {
        setVisible(false);
        nav.push('/reboot');
      }}
    />
  );
  return { open: () => setVisible(true), element };
}
