// The app's entry: expo-router first, then what must exist before any screen does, also when the system
// starts the app headless — Android's widget task handler and the background check (design §19).
import 'expo-router/entry';

import './src/widgets/register';
import './src/features/background/task';
