import { AppAlert as Alert } from '../../services/appAlert';
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Radius, Space, Type } from '../../utils/theme';
import { User } from '../../types';
import { Screen } from '../../components/ui/Screen';
import { Skeleton } from '../../components/ui/Skeleton';
import { FadeIn } from '../../components/ui/FadeIn';
import { authApi, describeApiError } from '../../services/auth';
import { LinkGoogleSheet } from '../../components/auth/LinkGoogleSheet';
import { isGoogleAuthAvailable } from '../../services/googleAuth';
import { getAppLockState, subscribeAppLock } from '../../services/appLock';

export default function SettingsScreen() {
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [googleAvailable, setGoogleAvailable] = useState<boolean | null>(null);
  const [linkSheetVisible, setLinkSheetVisible] = useState(false);
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const mounted = useRef(true);
  const focused = useRef(false);
  const profileRequest = useRef(0);
  const profileReadyRef = useRef(false);
  const telegramBusy = useRef(false);
  const logoutBusy = useRef(false);
  const googleSheetOpen = useRef(false);
  const { width, fontScale } = useWindowDimensions();
  const stackDetails = width < 360 || fontScale > 1.3;
  const appLock = useSyncExternalStore(
    subscribeAppLock,
    getAppLockState,
    getAppLockState
  );

  useEffect(() => {
    mounted.current = true;
    let active = true;
    isGoogleAuthAvailable()
      .then((ok) => {
        if (active) setGoogleAvailable(ok);
      })
      .catch(() => {
        if (active) setGoogleAvailable(false);
      });
    return () => {
      active = false;
      mounted.current = false;
      profileReadyRef.current = false;
      profileRequest.current += 1;
    };
  }, []);

  const loadProfile = useCallback(async () => {
    if (!mounted.current || !focused.current) return;
    const request = ++profileRequest.current;
    const isCurrent = () =>
      mounted.current && focused.current && request === profileRequest.current;
    profileReadyRef.current = false;
    setProfileLoading(true);
    try {
      const profile = await authApi.getProfile();
      if (!isCurrent()) return;
      if (!profile) throw new Error('Missing account details.');
      setUser(profile);
      setError(null);
      profileReadyRef.current = true;
    } catch (err) {
      if (isCurrent()) setError(describeApiError(err, 'Gagal memuat profil.'));
    } finally {
      if (isCurrent()) setProfileLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      void loadProfile();
      return () => {
        focused.current = false;
        profileReadyRef.current = false;
        profileRequest.current += 1;
      };
    }, [loadProfile])
  );

  const profileReady = user !== null && !profileLoading && !error;
  const accountBusy = linking || unlinking || loggingOut || linkSheetVisible;
  const profileActionsDisabled = !profileReady || accountBusy;
  const canUseProfile = () =>
    mounted.current && focused.current && profileReadyRef.current &&
    !telegramBusy.current && !logoutBusy.current && !googleSheetOpen.current;

  const handleLinkTelegram = async () => {
    if (!canUseProfile()) return;
    telegramBusy.current = true;
    setLinking(true);
    try {
      const { code, expires_in_minutes } = await authApi.createTelegramLinkToken();
      if (!mounted.current || !focused.current) return;
      Alert.alert(
        'Kode tautan Telegram',
        `Kirim perintah berikut ke Bot04:\n\n/link ${code}\n\nKode berlaku ${expires_in_minutes} menit dan hanya bisa dipakai sekali.`
      );
    } catch (err) {
      if (mounted.current && focused.current) {
        Alert.alert('Gagal membuat kode', describeApiError(err, 'Coba lagi sebentar lagi.'));
      }
    } finally {
      telegramBusy.current = false;
      if (mounted.current) setLinking(false);
    }
  };

  const handleUnlinkTelegram = () => {
    if (!canUseProfile() || !user?.telegram_linked) return;
    Alert.alert(
      'Putuskan tautan Telegram',
      'Data keuanganmu tetap aman. Setelah diputus, kamu bisa menautkan akun Telegram lain lewat kode baru.',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Putuskan',
          style: 'destructive',
          onPress: async () => {
            if (!canUseProfile()) return;
            telegramBusy.current = true;
            setUnlinking(true);
            try {
              await authApi.unlinkTelegram();
              await loadProfile();
            } catch (err) {
              if (mounted.current && focused.current) {
                Alert.alert('Gagal memutus tautan', describeApiError(err, 'Coba lagi sebentar lagi.'));
              }
            } finally {
              telegramBusy.current = false;
              if (mounted.current) setUnlinking(false);
            }
          },
        },
      ]
    );
  };

  const handleLogout = () => {
    if (logoutBusy.current || telegramBusy.current || googleSheetOpen.current) return;
    Alert.alert('Keluar dari akun', 'Kamu perlu masuk lagi untuk membuka data keuangan.', [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Keluar',
        style: 'destructive',
        onPress: async () => {
          if (!mounted.current || !focused.current || logoutBusy.current || telegramBusy.current || googleSheetOpen.current) return;
          logoutBusy.current = true;
          profileReadyRef.current = false;
          profileRequest.current += 1;
          setLoggingOut(true);
          try {
            await authApi.logout();
            if (mounted.current && focused.current) router.replace('/(auth)/login');
          } catch (err) {
            if (mounted.current && focused.current) {
              Alert.alert('Unable to sign out', describeApiError(err, 'Try again.'));
              await loadProfile();
            }
          } finally {
            logoutBusy.current = false;
            if (mounted.current) setLoggingOut(false);
          }
        },
      },
    ]);
  };

  const profileStatus = profileLoading ? 'Loading account details...' : 'Account details unavailable.';
  const initial = user?.first_name?.trim().charAt(0).toUpperCase();
  const lockHint = !appLock.ready
    ? 'Memuat status keamanan perangkat...'
    : !appLock.supported
    ? 'Tidak tersedia di perangkat ini.'
    : appLock.enabled
    ? appLock.patternEnabled && appLock.biometricsEnabled
      ? 'Aktif · PIN 6 digit, pola kunci, dan sidik jari / biometrik'
      : appLock.patternEnabled
      ? 'Aktif · PIN 6 digit dan pola kunci'
      : appLock.biometricsEnabled
      ? 'Aktif · PIN 6 digit dan sidik jari / biometrik'
      : 'Aktif · PIN 6 digit'
    : 'Nonaktif · Lindungi aplikasi dengan PIN 6 digit';
  const googleLinkable = profileReady && googleAvailable === true && user?.has_password === true;
  const googleTitle = !profileReady
    ? 'Google'
    : user?.google_linked
    ? 'Google tertaut'
    : googleLinkable
    ? 'Tautkan akun Google'
    : googleAvailable === null
    ? 'Google'
    : 'Google belum tersedia';
  const googleHint = !profileReady
    ? profileStatus
    : user?.google_linked
    ? 'Kamu bisa masuk memakai akun Google yang sudah ditautkan.'
    : googleAvailable === null
    ? 'Checking availability...'
    : googleLinkable
    ? 'Masuk lebih cepat dengan akun Google yang emailnya sama.'
    : googleAvailable === false
    ? 'Google sign-in is not available in this build.'
    : 'Google linking requires an account password.';

  return (
    <Screen contentStyle={styles.content}>
      <FadeIn>
        <Text style={styles.title} accessibilityRole="header">Pengaturan</Text>

        <View style={styles.profile}>
          <View style={styles.avatar} accessible={false} importantForAccessibility="no-hide-descendants">
            {initial ? (
              <Text style={styles.avatarText}>{initial}</Text>
            ) : (
              <Ionicons name="person-outline" size={22} color={Colors.inkSoft} />
            )}
          </View>
          <View style={styles.profileInfo}>
            {user ? (
              <>
                <Text style={styles.userName}>{user.first_name || 'Pengguna'}</Text>
                {user.email ? <Text style={styles.userEmail}>{user.email}</Text> : null}
              </>
            ) : profileLoading ? (
              <>
                <Skeleton width="60%" height={24} />
                <Skeleton width="85%" height={14} style={styles.skeletonLine} />
              </>
            ) : (
              <Text style={styles.userName}>Your account</Text>
            )}
            {!profileReady ? (
              <Text style={styles.profileStatus} accessibilityLiveRegion="polite">{profileStatus}</Text>
            ) : null}
          </View>
        </View>

        {error ? (
          <View style={styles.errorPanel}>
            <Text style={styles.errorText} accessibilityLiveRegion="polite">{error}</Text>
            <SettingsRow
              icon="refresh-outline"
              title="Coba lagi"
              onPress={loadProfile}
              disabled={profileLoading || accountBusy}
              busy={profileLoading}
              last
            />
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionLabel} accessibilityRole="header">Account security</Text>
          <SettingsRow
            icon="lock-closed-outline"
            title="Kunci aplikasi"
            hint={lockHint}
            onPress={() => router.push('/app-lock' as never)}
            disabled={accountBusy}
          />
          <SettingsRow
            icon="key-outline"
            title="Change password"
            hint={!profileReady
              ? profileStatus
              : user?.has_password === false
              ? 'Signed in with Google. View password management info.'
              : 'Update your password and sign out other devices.'}
            onPress={() => {
              if (canUseProfile()) router.push('/change-password');
            }}
            disabled={profileActionsDisabled}
            last
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel} accessibilityRole="header">Connected accounts</Text>
          <SettingsRow
            icon="paper-plane-outline"
            title={profileReady && user?.telegram_linked ? 'New Telegram link code' : 'Hubungkan akun Telegram'}
            hint={!profileReady
              ? profileStatus
              : user?.telegram_linked
              ? 'Connected. Request a new code to switch Telegram accounts.'
              : 'Not linked. Request a code, then send /link <code> to Bot04.'}
            onPress={handleLinkTelegram}
            disabled={profileActionsDisabled}
            busy={linking}
          />
          {(profileReady || unlinking) && user?.telegram_linked ? (
            <SettingsRow
              icon="unlink-outline"
              title="Putuskan tautan Telegram"
              hint="Your financial records stay intact."
              onPress={handleUnlinkTelegram}
              disabled={profileActionsDisabled}
              busy={unlinking}
            />
          ) : null}
          <SettingsRow
            icon="logo-google"
            title={googleTitle}
            hint={googleHint}
            onPress={googleLinkable && !user?.google_linked ? () => {
              if (!canUseProfile()) return;
              googleSheetOpen.current = true;
              setLinkSheetVisible(true);
            } : undefined}
            disabled={profileActionsDisabled}
            complete={profileReady && !!user?.google_linked}
            last
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel} accessibilityRole="header">Otomatisasi</Text>
          <SettingsRow
            icon="repeat-outline"
            title="Transaksi berulang"
            hint="Jadwal pemasukan, pengeluaran, dan investasi otomatis"
            onPress={() => router.push('/recurring')}
            disabled={accountBusy}
            last
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel} accessibilityRole="header">Preferences & app</Text>
          <DetailRow label="Mata uang" value={user?.currency || (profileLoading ? 'Loading...' : 'Not available')} stacked={stackDetails} />
          <DetailRow label="Zona waktu" value={user?.timezone || (profileLoading ? 'Loading...' : 'Not available')} stacked={stackDetails} />
          <DetailRow label="Versi" value="1.0.0" stacked={stackDetails} last />
        </View>

        <View style={styles.logout}>
          <SettingsRow
            icon="log-out-outline"
            title="Keluar dari akun"
            onPress={handleLogout}
            disabled={accountBusy}
            busy={loggingOut}
            last
          />
        </View>

        <View style={styles.dangerArea}>
          <Text style={styles.sectionLabel} accessibilityRole="header">Permanent deletion</Text>
          <SettingsRow
            icon="trash-outline"
            title="Delete account"
            hint="Permanently delete your account and all financial records."
            onPress={() => {
              if (canUseProfile()) router.push('/delete-account');
            }}
            disabled={profileActionsDisabled}
            danger
            last
          />
        </View>
      </FadeIn>

      <LinkGoogleSheet
        visible={linkSheetVisible}
        onClose={() => {
          googleSheetOpen.current = false;
          if (mounted.current) setLinkSheetVisible(false);
        }}
        onLinked={(linkedUser) => {
          if (!mounted.current || !focused.current) return;
          profileRequest.current += 1;
          profileReadyRef.current = true;
          setUser(linkedUser);
          setError(null);
          setProfileLoading(false);
          googleSheetOpen.current = false;
          setLinkSheetVisible(false);
        }}
      />
    </Screen>
  );
}

type SettingsRowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  hint?: string;
  onPress?: () => void;
  disabled?: boolean;
  busy?: boolean;
  complete?: boolean;
  danger?: boolean;
  last?: boolean;
};

function SettingsRow({ icon, title, hint, onPress, disabled = false, busy = false, complete = false, danger = false, last = false }: SettingsRowProps) {
  const inactive = disabled || busy;
  const color = danger ? Colors.danger : inactive && onPress ? Colors.inkMuted : Colors.inkSoft;
  const content = (
    <>
      <View style={styles.rowIcon} accessible={false} importantForAccessibility="no-hide-descendants">
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <View style={styles.navBody}>
        <Text style={[styles.navTitle, danger && styles.dangerTitle, inactive && onPress && styles.disabledTitle]}>{title}</Text>
        {hint ? <Text style={styles.navHint}>{hint}</Text> : null}
      </View>
      <View style={styles.rowAccessory} accessible={false} importantForAccessibility="no-hide-descendants">
        {busy ? <ActivityIndicator size="small" color={color} /> : onPress ? (
          <Ionicons name="chevron-forward" size={18} color={color} />
        ) : complete ? (
          <Ionicons name="checkmark-circle-outline" size={20} color={Colors.inkSoft} />
        ) : null}
      </View>
    </>
  );

  return onPress ? (
    <Pressable
      onPress={() => { if (!inactive) return onPress(); }}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={hint}
      accessibilityState={{ disabled: inactive, busy }}
      style={({ pressed }) => [styles.navRow, last && styles.lastRow, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  ) : (
    <View style={[styles.navRow, last && styles.lastRow]} accessible accessibilityLabel={hint ? `${title}. ${hint}` : title}>
      {content}
    </View>
  );
}

function DetailRow({ label, value, stacked, last = false }: { label: string; value: string; stacked: boolean; last?: boolean }) {
  return (
    <View style={[styles.detailRow, stacked && styles.stackedDetail, last && styles.lastRow]}>
      <Text style={[styles.rowLabel, stacked && styles.stackedValue]}>{label}</Text>
      <Text style={[styles.rowValue, stacked && styles.stackedValue]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  title: {
    ...Type.h1,
    marginBottom: Space.lg,
  },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.lg,
    borderRadius: Radius.block,
    backgroundColor: Colors.surfaceAlt,
    marginBottom: Space.xl,
  },
  avatar: {
    minWidth: 56,
    minHeight: 56,
    padding: Space.sm,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: {
    fontFamily: Fonts.serif,
    fontSize: 28,
    color: Colors.ink,
  },
  profileInfo: {
    flex: 1,
    minWidth: 0,
    gap: Space.xs,
  },
  userName: {
    ...Type.h2,
  },
  userEmail: {
    ...Type.caption,
    color: Colors.inkSoft,
  },
  profileStatus: {
    ...Type.caption,
  },
  skeletonLine: {
    marginTop: Space.xs,
  },
  section: {
    marginBottom: Space.xl,
  },
  sectionLabel: {
    ...Type.caption,
    fontFamily: Fonts.semibold,
    color: Colors.ink,
    marginBottom: Space.xs,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: 64,
    paddingVertical: Space.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  rowIcon: {
    width: 24,
    alignItems: 'center',
    flexShrink: 0,
  },
  rowAccessory: {
    width: 20,
    alignItems: 'center',
    flexShrink: 0,
  },
  navBody: {
    flex: 1,
    minWidth: 0,
  },
  navTitle: {
    ...Type.bodyStrong,
  },
  dangerTitle: {
    color: Colors.danger,
  },
  disabledTitle: {
    color: Colors.inkMuted,
  },
  navHint: {
    ...Type.caption,
    marginTop: Space.xs,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: 48,
    paddingVertical: Space.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  stackedDetail: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: Space.xs,
  },
  rowLabel: {
    ...Type.body,
    color: Colors.inkSoft,
    flex: 1,
    minWidth: 0,
  },
  rowValue: {
    ...Type.bodyStrong,
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
  },
  stackedValue: {
    flex: 0,
    textAlign: 'left',
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  pressed: {
    backgroundColor: Colors.inkTint,
  },
  errorPanel: {
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
    borderRadius: Radius.block,
    backgroundColor: Colors.dangerTint,
    marginBottom: Space.xl,
  },
  errorText: {
    ...Type.body,
    color: Colors.danger,
  },
  logout: {
    borderTopWidth: 1,
    borderTopColor: Colors.line,
  },
  dangerArea: {
    marginTop: Space.xl,
    padding: Space.lg,
    borderRadius: Radius.block,
    backgroundColor: Colors.dangerTint,
  },
});
