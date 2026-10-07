import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { AppState, Linking } from 'react-native';

import type { WidgetName } from './catalog';
import { countWidgets, pinWidget } from './update';

/**
 * - added: the widget is on the home screen.
 * - unsupported: the launcher cannot add widgets for an app; only its own widget picker can.
 * - blocked: the launcher said yes but showed nothing. Xiaomi, vivo, OPPO, Huawei and Honor do that while
 *   the app's "home screen shortcuts" permission is off (it is by default for apps not from their store).
 * - dismissed: the prompt showed and the user closed it.
 */
export type PinResult = 'added' | 'unsupported' | 'blocked' | 'dismissed';

export interface PinDeps {
  pin?: (name: WidgetName) => Promise<boolean>;
  count(name: WidgetName): Promise<number>;
  /** Resolves true once the app loses the foreground or focus (a prompt on top), false after `ms`. */
  promptShown(ms: number): Promise<boolean>;
  /** Resolves when the app is back in front, or after `ms`. */
  back(ms: number): Promise<void>;
  sleep(ms: number): Promise<void>;
}

/** The launcher's prompt comes up within this time, or not at all. */
const PROMPT_MS = 1_500;
/** The launcher binds the widget a moment after its prompt closes. */
const BIND_MS = 4_000;

function promptShown(ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (shown: boolean) => {
      clearTimeout(timer);
      change.remove();
      blur.remove();
      resolve(shown);
    };
    // A prompt that is its own activity pauses the app; a system dialog only takes the focus.
    const change = AppState.addEventListener('change', (state) => state !== 'active' && done(true));
    const blur = AppState.addEventListener('blur', () => done(true));
    const timer = setTimeout(() => done(false), ms);
  });
}

function back(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      change.remove();
      focus.remove();
      resolve();
    };
    const change = AppState.addEventListener('change', (state) => state === 'active' && done());
    const focus = AppState.addEventListener('focus', done);
    const timer = setTimeout(done, ms);
  });
}

const defaults: PinDeps = {
  pin: pinWidget,
  count: countWidgets,
  promptShown,
  back,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Asks the launcher to add widget `name` and finds out what came of it. */
export async function addWidget(name: WidgetName, deps: PinDeps = defaults): Promise<PinResult> {
  if (!deps.pin) return 'unsupported';
  const before = await deps.count(name).catch(() => 0);
  const added = async (waitMs: number) => {
    for (let waited = 0; ; waited += 500) {
      if ((await deps.count(name).catch(() => before)) > before) return true;
      if (waited >= waitMs) return false;
      await deps.sleep(500);
    }
  };
  // Listening before asking: the prompt can be up before the launcher's answer arrives.
  const shown = deps.promptShown(PROMPT_MS);
  const accepted = await deps.pin(name).catch(() => false);
  if (!accepted) return 'unsupported';
  if (!(await shown)) return (await added(0)) ? 'added' : 'blocked';
  await deps.back(2 * 60_000);
  return (await added(BIND_MS)) ? 'added' : 'dismissed';
}

const PACKAGE = Constants.expoConfig?.android?.package ?? 'io.github.tsix2019.routelink';

/**
 * Where the "home screen shortcuts" permission is switched on: MIUI/HyperOS has its own permission editor
 * (declared in the manifest's <queries>, plugins/with-widget-strings.js); elsewhere the app's settings page.
 */
export async function openPinPermission(): Promise<void> {
  if ((Device.manufacturer ?? '').toLowerCase() === 'xiaomi') {
    try {
      await Linking.sendIntent('miui.intent.action.APP_PERM_EDITOR', [{ key: 'extra_pkgname', value: PACKAGE }]);
      return;
    } catch {
      // an older or newer MIUI without it: the app's settings page below
    }
  }
  await Linking.openSettings();
}
