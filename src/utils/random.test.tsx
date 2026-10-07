import { Stack, Tabs, router } from 'expo-router';
import { act, renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { repairMathRandom } from './random';

const working = Math.random;
/** Hermes under ARM translation: the generator's 64-bit integer, never scaled down to [0, 1). */
const translated = () => Math.floor(working() * 2 ** 64);
const fill = (array: Uint32Array) => array.forEach((_, i) => (array[i] = working() * 2 ** 32));

afterEach(() => {
  Math.random = working;
});

it('leaves a working Math.random alone', () => {
  expect(repairMathRandom(fill)).toBe(false);
  expect(Math.random).toBe(working);
});

it('replaces one that returns integers', () => {
  Math.random = translated;
  expect(repairMathRandom(fill)).toBe(true);
  const xs = Array.from({ length: 1000 }, () => Math.random());
  expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  expect(new Set(xs).size).toBe(1000);
});

it('a root screen pushed from inside a tab opens and closes when Math.random was broken', async () => {
  Math.random = translated;
  repairMathRandom(fill);
  // The app's shape: a root stack holding the tabs and the sheets, a stack in each tab.
  const result = renderRouter(
    {
      _layout: () => <Stack />,
      '(tabs)/_layout': () => <Tabs />,
      '(tabs)/devices/_layout': () => <Stack />,
      '(tabs)/devices/index': () => <Text>devices</Text>,
      '(tabs)/devices/intruders': () => <Text>intruders</Text>,
      'device/[mac]': () => <Text>device</Text>,
    },
    { initialUrl: '/devices' },
  );
  await result;
  await act(async () => router.push('/devices/intruders'));
  expect(result.getPathname()).toBe('/devices/intruders');
  await act(async () => router.push('/device/aa:bb'));
  expect(result.getPathname()).toBe('/device/aa:bb');
  await act(async () => router.back());
  expect(result.getPathname()).toBe('/devices/intruders');
});
