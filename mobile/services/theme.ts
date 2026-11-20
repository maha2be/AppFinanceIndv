/** Device-local appearance preference (light or dark ledger theme). */
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import {
  createThemedStyles,
  getActiveTheme,
  getThemeTokens,
  isThemeMode,
  setActiveTheme,
  subscribeActiveTheme,
  ThemeMode,
  ThemeTokens,
} from '../utils/theme';

export { createThemedStyles };

const THEME_KEY = 'finance.themeMode.v1';

export interface ThemeContextValue extends ThemeTokens {
  setThemeMode: (mode: ThemeMode) => Promise<void>;
}

let revision = 0;
let storageQueue: Promise<void> = Promise.resolve();

function persistInOrder(write: () => Promise<void>): Promise<void> {
  const pending = storageQueue.then(write);
  storageQueue = pending.catch(() => {});
  return pending;
}

function syncSystemBackground(paperColor: string): void {
  if (Platform.OS === 'web') return;
  try {
    const systemUi = require('expo-system-ui') as typeof import('expo-system-ui');
    void systemUi.setBackgroundColorAsync(paperColor).catch(() => {});
  } catch {
    // Older runtimes without the native module simply use the React container background.
  }
}

function readWebTheme(): ThemeMode | null {
  try {
    const storage = (globalThis as { localStorage?: { getItem(key: string): string | null } }).localStorage;
    const raw = storage?.getItem(THEME_KEY);
    return isThemeMode(raw) ? raw : null;
  } catch {
    return null;
  }
}

function writeWebTheme(mode: ThemeMode): void {
  try {
    const storage = (globalThis as { localStorage?: { setItem(key: string, value: string): void } }).localStorage;
    storage?.setItem(THEME_KEY, mode);
  } catch {
    // Ignore restricted storage contexts on web.
  }
}

export async function hydrateTheme(): Promise<ThemeMode> {
  const ticket = revision;
  let stored: ThemeMode | null = null;

  if (Platform.OS === 'web') {
    stored = readWebTheme();
  } else {
    try {
      await storageQueue;
      const raw = await SecureStore.getItemAsync(THEME_KEY);
      if (isThemeMode(raw)) {
        stored = raw;
      }
    } catch {
      stored = null;
    }
  }

  if (ticket !== revision) {
    return getActiveTheme().mode;
  }

  const next = stored ?? 'light';
  const tokens = setActiveTheme(next);
  syncSystemBackground(tokens.colors.paper);
  return tokens.mode;
}

export async function setThemeMode(mode: ThemeMode): Promise<void> {
  if (!isThemeMode(mode)) return;

  const ticket = ++revision;
  const tokens = setActiveTheme(mode);
  syncSystemBackground(tokens.colors.paper);

  if (Platform.OS === 'web') {
    writeWebTheme(mode);
    return;
  }

  try {
    await persistInOrder(async () => {
      if (ticket !== revision) return;
      await SecureStore.setItemAsync(THEME_KEY, mode);
    });
  } catch {
    // Keep the active in-memory selection even if device storage fails.
  }
}

const LIGHT_HOOK_VALUE: ThemeContextValue = {
  ...getThemeTokens('light'),
  setThemeMode,
};

const DARK_HOOK_VALUE: ThemeContextValue = {
  ...getThemeTokens('dark'),
  setThemeMode,
};

export function useTheme(): ThemeContextValue {
  const active =
    typeof useSyncExternalStore === 'function'
      ? useSyncExternalStore(subscribeActiveTheme, getActiveTheme, getActiveTheme)
      : getActiveTheme();
  return active.isDark ? DARK_HOOK_VALUE : LIGHT_HOOK_VALUE;
}
