import SegmentedControl, { type SegmentedControlProps } from '@react-native-segmented-control/segmented-control';

import { useTheme } from './theme/ThemeProvider';

/**
 * The segmented control in the app's own light or dark appearance. Left alone it follows the system
 * setting, so a phone in light mode drew white controls on the app's dark theme (and the reverse).
 */
export function Segmented(props: SegmentedControlProps) {
  const { scheme } = useTheme();
  return <SegmentedControl appearance={scheme} {...props} />;
}
