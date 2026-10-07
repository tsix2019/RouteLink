import { act, fireEvent, screen } from '@testing-library/react-native';
import { router, Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { useState } from 'react';
import { Text } from 'react-native';

import { initI18n } from '@/i18n';

import { FormScreen, useFormExit } from './FormScreen';

beforeAll(() => {
  initI18n('en');
});

/** A form whose "Change" makes it dirty and whose Save leaves through useFormExit. */
function Form() {
  const [dirty, setDirty] = useState(false);
  const exit = useFormExit();
  return (
    <FormScreen title="Edit" dirty={dirty} leaving={exit.leaving} onSave={exit.back}>
      <Text onPress={() => setDirty(true)}>Change</Text>
    </FormScreen>
  );
}

const routes = {
  _layout: () => <Stack />,
  index: () => <Text>List</Text>,
  form: Form,
};

async function openForm() {
  await renderRouter(routes, { initialUrl: '/' });
  await act(() => router.push('/form'));
  expect(screen.getByText('Change')).toBeOnTheScreen();
}

it('leaves an unchanged form straight away', async () => {
  await openForm();
  await act(() => router.back());
  expect(screen.getByText('List')).toBeOnTheScreen();
});

it('asks before throwing changes away, and stays when told to keep editing', async () => {
  await openForm();
  await fireEvent.press(screen.getByText('Change'));
  await act(() => router.back());
  expect(screen.getByText('Discard changes?')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Keep Editing' }));
  expect(screen.queryByText('Discard changes?')).toBeNull();
  expect(screen.getByText('Change')).toBeOnTheScreen();
});

it('leaves after Discard', async () => {
  await openForm();
  await fireEvent.press(screen.getByText('Change'));
  await act(() => router.back());
  await fireEvent.press(screen.getByRole('button', { name: 'Discard Changes' }));
  expect(screen.getByText('List')).toBeOnTheScreen();
});

it('does not ask once the form was saved', async () => {
  await openForm();
  await fireEvent.press(screen.getByText('Change'));
  await fireEvent.press(screen.getByRole('button', { name: 'Save and Apply' }));
  expect(screen.queryByText('Discard changes?')).toBeNull();
  expect(screen.getByText('List')).toBeOnTheScreen();
});
