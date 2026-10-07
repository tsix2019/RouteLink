// Imported first by index.ts, before anything draws on Math.random (see repairMathRandom).
import { repairMathRandom } from './random';

repairMathRandom((array) => {
  // The system's secure generator. Loaded only on the devices that need it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- a lazy load, which import() cannot do synchronously
  const { getRandomValues } = require('expo-crypto') as typeof import('expo-crypto');
  getRandomValues(array);
});
