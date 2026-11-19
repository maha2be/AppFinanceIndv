import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, Space, Type } from '../utils/theme';
import { User } from '../types';
import { authApi, describeApiError } from '../services/auth';
import {
  isGoogleAuthAvailable,
  requestGoogleIdToken,
  signOutGoogle,
} from '../services/googleAuth';
import { describeGoogleError } from '../utils/googleError';
import { Screen } from '../components/ui/Screen';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Checkbox } from '../components/ui/Checkbox';
import { ErrorState } from '../components/ui/ErrorState';
import { SkeletonRows } from '../components/ui/Skeleton';
import { getAccountDeletionMethod } from '../utils/accountDeletion';
import { getAppLockState, subscribeAppLock, withAppLockCredentialPrompt } from '../services/appLock';
import { isAuthenticated, subscribeSession } from '../services/session';

export default function DeleteAccountScreen() {
  const [user, setUser] = useState<User | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmationText, setConfirmationText] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const proofGeneration = useRef(0);
  const mounted = useRef(true);
  const googlePrompt = useRef(false);

  const clearSecrets = useCallback(() => {
    setPassword('');
    setConfirmationText('');
    setAcknowledged(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      return () => {
        proofGeneration.current += 1;
        clearSecrets();
      };
    }, [clearSecrets])
  );

  useEffect(() => {
    mounted.current = true;
    const invalidate = () => {
      proofGeneration.current += 1;
      clearSecrets();
    };
    const lifecycle = AppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        if (googlePrompt.current) clearSecrets();
        else invalidate();
      }
    });
    const unsubscribeLock = subscribeAppLock(() => {
      const lock = getAppLockState();
      if ((!lock.ready || lock.locked || lock.covered) && !googlePrompt.current) invalidate();
    });
    const unsubscribeSession = subscribeSession(invalidate);
    return () => {
      mounted.current = false;
      proofGeneration.current += 1;
      lifecycle.remove();
      unsubscribeLock();
      unsubscribeSession();
    };
  }, [clearSecrets]);

  const loadProfile = useCallback(async () => {
    try {
      setUser(await authApi.getProfile());
      setProfileError(null);
    } catch (err) {
      setProfileError(describeApiError(err, 'Unable to load account details.'));
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleBack = () => {
    clearSecrets();
    router.back();
  };

  const requiresPassword = user === null || getAccountDeletionMethod(user) === 'password';

  const handleDeleteAccount = async () => {
    if (submitting.current || loading || !user) return;
    const lock = getAppLockState();
    if (!isAuthenticated() || !lock.ready || lock.locked || lock.covered) return;
    if (confirmationText.trim() !== 'DELETE') {
      setError('Type DELETE in uppercase to confirm account deletion.');
      return;
    }
    if (!acknowledged) {
      setError('Please confirm that you understand this action is permanent.');
      return;
    }
    if (requiresPassword && !password) {
      setError('Enter your account password to confirm deletion.');
      return;
    }

    submitting.current = true;
    const ticket = proofGeneration.current;
    const stillCurrent = () => {
      const currentLock = getAppLockState();
      return mounted.current && ticket === proofGeneration.current && isAuthenticated() &&
        currentLock.ready && !currentLock.locked && !currentLock.covered;
    };
    setLoading(true);
    setError(null);
    try {
      if (requiresPassword) {
        await authApi.deleteAccount({
          confirmation: 'DELETE',
          password,
        });
      } else {
        const available = await isGoogleAuthAvailable();
        if (!stillCurrent()) return;
        if (!available) {
          throw new Error('GOOGLE_UNAVAILABLE');
        }
        await signOutGoogle();
        if (!stillCurrent()) return;
        let idToken: string | null;
        googlePrompt.current = true;
        try {
          idToken = await withAppLockCredentialPrompt(requestGoogleIdToken);
        } finally {
          googlePrompt.current = false;
        }
        if (!idToken) {
          // User cancelled the Google prompt; never delete or clear session.
          return;
        }
        if (!stillCurrent()) {
          throw new Error('Verification was interrupted. Confirm deletion again.');
        }
        await authApi.deleteAccount({
          confirmation: 'DELETE',
          id_token: idToken,
        });
      }
      if (mounted.current) {
        clearSecrets();
        router.replace('/(auth)/login');
      }
    } catch (err) {
      if (mounted.current) {
        setPassword('');
        setError(
          describeGoogleError(err) ??
            describeApiError(err, 'Unable to delete account. Your session and data remain intact.')
        );
      }
    } finally {
      submitting.current = false;
      if (mounted.current) setLoading(false);
    }
  };

  return (
    <Screen bottomInset keyboardBehavior="padding">
      <View style={styles.header}>
        <Pressable
          onPress={handleBack}
          hitSlop={8}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={20} color={Colors.ink} />
        </Pressable>
        <Text style={styles.title}>Delete account</Text>
      </View>

      {profileError ? <ErrorState message={profileError} onRetry={loadProfile} /> : null}

      {user === null && !profileError ? (
        <View style={styles.loadingBlock}>
          <SkeletonRows count={3} />
        </View>
      ) : user ? (
        <View style={styles.content}>
          <View style={styles.warningBox} accessibilityRole="alert">
            <View style={styles.warningHeader}>
              <Ionicons name="warning-outline" size={20} color={Colors.danger} />
              <Text style={styles.warningTitle}>Permanent data deletion</Text>
            </View>
            <Text style={styles.warningBody}>
              Deleting your account permanently removes your profile, categories, transactions,
              debts and receivables, recurring schedules, and linked Telegram or Google
              connections. This action cannot be undone.
            </Text>
          </View>

          {error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}

          {requiresPassword ? (
            <Input
              label="Account password"
              placeholder="Enter your password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              editable={!loading}
              autoComplete="password"
              textContentType="password"
              hint={
                user.google_linked
                  ? 'Password is required even when Google is linked.'
                  : 'Required to verify account ownership.'
              }
              returnKeyType="next"
              accessibilityLabel="Account password"
            />
          ) : (
            <View style={styles.reauthNote}>
              <Text style={styles.reauthTitle}>Google verification required</Text>
              <Text style={styles.reauthBody}>
                Because this account uses Google sign-in without a password, you will be asked to
                re-authenticate with Google before deletion completes.
              </Text>
            </View>
          )}

          <Input
            label="Type DELETE to confirm"
            placeholder="DELETE"
            value={confirmationText}
            editable={!loading}
            onChangeText={setConfirmationText}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="done"
            accessibilityLabel="Type DELETE to confirm"
          />

          <View style={styles.checkboxWrap}>
            <Checkbox
              checked={acknowledged}
              onChange={setAcknowledged}
              label="I understand that all of my financial records and account data will be permanently deleted."
              disabled={loading}
            />
          </View>

          <Button
            title={
              requiresPassword
                ? 'Permanently delete account'
                : 'Verify with Google and delete account'
            }
            variant="danger"
            icon="trash-outline"
            loading={loading}
            onPress={handleDeleteAccount}
            size="lg"
          />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    marginBottom: Space.md,
  },
  back: {
    width: 44,
    height: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginLeft: -Space.sm,
  },
  title: {
    ...Type.h2,
  },
  loadingBlock: {
    paddingTop: Space.lg,
  },
  content: {
    gap: 0,
  },
  warningBox: {
    backgroundColor: Colors.dangerTint,
    borderWidth: 1,
    borderColor: 'rgba(163, 43, 43, 0.28)',
    borderRadius: Radius.block,
    padding: Space.lg,
    gap: Space.sm,
    marginBottom: Space.lg,
  },
  warningHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  warningTitle: {
    ...Type.title,
    color: Colors.danger,
  },
  warningBody: {
    ...Type.body,
    color: Colors.ink,
  },
  reauthNote: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radius.block,
    padding: Space.lg,
    gap: Space.xs,
    marginBottom: Space.lg,
  },
  reauthTitle: {
    ...Type.bodyStrong,
    color: Colors.ink,
  },
  reauthBody: {
    ...Type.caption,
    color: Colors.inkSoft,
  },
  error: {
    ...Type.caption,
    color: Colors.danger,
    marginBottom: Space.md,
  },
  checkboxWrap: {
    marginBottom: Space.xl,
  },
});
