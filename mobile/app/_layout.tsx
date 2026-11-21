import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, AppState, BackHandler, Platform, StyleSheet, Text, View } from 'react-native';
import { Fonts } from '../utils/theme';
import { createThemedStyles, hydrateTheme, useTheme } from '../services/theme';
import { hydrateInstallmentReminders } from '../services/installmentNotifications';
import { clearSession, hydrateSession, isAuthenticated, subscribeSession } from '../services/session';
import {
  getAppLockState, handleAppLockState, hydrateAppLock, subscribeAppLock,
} from '../services/appLock';
import {
  activatePendingTutorial,
  getTutorialHintState,
  resetTutorialHint,
  subscribeTutorialHint,
} from '../services/tutorialHint';
import { AppLockView } from '../components/security/AppLockView';
import { TutorialHintOverlay } from '../components/tutorial/TutorialHintOverlay';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppAlertHost } from '../components/security/AppAlertHost';

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [fontsLoaded, fontError] = useFonts({
    InstrumentSerif: require('../assets/fonts/InstrumentSerif-Regular.ttf'),
    PlexRegular: require('../assets/fonts/IBMPlexSans-Regular.ttf'),
    PlexMedium: require('../assets/fonts/IBMPlexSans-Medium.ttf'),
    PlexSemiBold: require('../assets/fonts/IBMPlexSans-SemiBold.ttf'),
  });
  const router = useRouter();
  const segments = useSegments();
  const appLock = useSyncExternalStore(subscribeAppLock, getAppLockState, getAppLockState);
  const tutorial = useSyncExternalStore(
    subscribeTutorialHint,
    getTutorialHintState,
    getTutorialHintState
  );
  const theme = useTheme();
  const { colors, isDark } = theme;
  const styles = useStyles(theme);
  const gated = authed && (!appLock.ready || appLock.locked || appLock.covered);
  const inAuthGroup = segments[0] === '(auth)';

  const handleNavigateTab = useCallback(
    (route: string) => {
      router.navigate(route as never);
    },
    [router]
  );

  useEffect(() => {
    if (!gated) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => listener.remove();
  }, [gated]);

  useEffect(() => {
    let mounted = true;

    handleAppLockState(AppState.currentState || 'active');
    Promise.all([
      hydrateTheme(),
      hydrateInstallmentReminders(),
      hydrateSession().then(() => hydrateAppLock()),
    ]).finally(() => {
      if (mounted) {
        setAuthed(isAuthenticated());
        setReady(true);
      }
    });

    const unsubscribe = subscribeSession(() => {
      if (mounted) {
        setAuthed(isAuthenticated());
      }
    });
    const lifecycle = AppState.addEventListener('change', handleAppLockState);

    let notificationSub: { remove?: () => void } | undefined;
    if (Platform.OS !== 'web') {
      try {
        const Notifications = require('expo-notifications') as typeof import('expo-notifications');
        notificationSub = Notifications.addNotificationResponseReceivedListener((response) => {
          const route = response?.notification?.request?.content?.data?.route;
          if (mounted && isAuthenticated() && route === '/debts') {
            router.push('/debts');
          }
        });
      } catch {
        // Ignore when running without the notifications native module.
      }
    }

    return () => {
      mounted = false;
      unsubscribe();
      lifecycle.remove();
      notificationSub?.remove?.();
    };
  }, [router]);

  useEffect(() => {
    if (!authed || !appLock.enabled || Platform.OS === 'web') return;
    let capture: typeof import('expo-screen-capture') | undefined;
    let disposed = false;
    try {
      capture = require('expo-screen-capture');
      capture!.preventScreenCaptureAsync('app-lock').then(async () => {
        if (disposed) await capture!.allowScreenCaptureAsync('app-lock');
      }).catch(() => {});
    } catch {
      // Older installed binaries still use the opaque JS privacy gate.
    }
    return () => {
      disposed = true;
      capture?.allowScreenCaptureAsync('app-lock').catch(() => {});
    };
  }, [authed, appLock.enabled]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    if (!authed && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (authed && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [authed, inAuthGroup, ready, router]);

  useEffect(() => {
    if (!ready) return;
    if (!authed) {
      resetTutorialHint();
      return;
    }
    if (!gated && !inAuthGroup && tutorial.pendingAfterUnlock) {
      activatePendingTutorial();
    }
  }, [authed, gated, inAuthGroup, ready, tutorial.pendingAfterUnlock]);

  const booting = !ready || (!fontsLoaded && !fontError);

  if (booting) {
    return (
      <View style={styles.loading}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <Text style={styles.wordmark}>Bot04</Text>
        <ActivityIndicator size="small" color={colors.inkMuted} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <View
        style={styles.navigator}
        pointerEvents={gated ? 'none' : 'auto'}
        accessibilityElementsHidden={gated}
        importantForAccessibility={gated ? 'no-hide-descendants' : 'auto'}
      >
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.paper },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="debts" options={{ headerShown: false }} />
        <Stack.Screen name="recurring" options={{ headerShown: false }} />
        <Stack.Screen name="shopping-lists" options={{ headerShown: false }} />
        <Stack.Screen name="shopping-list/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="budgets" options={{ headerShown: false }} />
        <Stack.Screen name="transactions" options={{ headerShown: false }} />
        <Stack.Screen name="transaction/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="transaction-history" options={{ headerShown: false }} />
        <Stack.Screen name="change-password" options={{ headerShown: false }} />
        <Stack.Screen name="delete-account" options={{ headerShown: false }} />
        <Stack.Screen name="app-lock" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)/login" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)/register" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)/forgot-password" options={{ headerShown: false }} />
      </Stack>
      <TutorialHintOverlay
        authed={authed}
        gated={gated}
        inAuthGroup={inAuthGroup}
        onNavigateTab={handleNavigateTab}
      />
      </View>
      {gated ? (
        <View style={styles.lockCover} accessibilityViewIsModal>
          <SafeAreaProvider>
            <AppLockView onSignOut={async () => {
              await clearSession();
              router.replace('/(auth)/login');
            }} />
          </SafeAreaProvider>
        </View>
      ) : null}
      <AppAlertHost host="root" />
    </>
  );
}

const useStyles = createThemedStyles(({ colors }) => StyleSheet.create({
  navigator: { flex: 1 },
  lockCover: { ...StyleSheet.absoluteFill, zIndex: 100, backgroundColor: colors.paper },
  loading: {
    flex: 1,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  wordmark: {
    fontFamily: Fonts.serif,
    fontSize: 40,
    color: colors.ink,
  },
}));
