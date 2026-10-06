import { useT } from '@/i18n';
import { Badge, type BadgeTone } from '@/ui/Status';

import type { SignalGrade } from './signal';

export const GRADE_TONE: Record<SignalGrade, BadgeTone> = {
  excellent: 'success',
  good: 'accent',
  fair: 'warning',
  poor: 'danger',
};

/** Signal quality as a coloured capsule: excellent, good, fair, poor (design §17.1). */
export function GradeBadge({ grade }: { grade: SignalGrade }) {
  const t = useT();
  return <Badge label={t(`wifitools:grade.${grade}`)} tone={GRADE_TONE[grade]} />;
}

/** "433" from kbit/s: negotiated rates read best in whole Mbps. */
export const mbps = (kbit?: number | null) => (kbit ? String(Math.round(kbit / 1000)) : '—');
