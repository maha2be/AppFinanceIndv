import { AppAlert as Alert } from '../../services/appAlert';
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Fonts, Radius, Space } from '../../utils/theme';
import { createThemedStyles, useTheme } from '../../services/theme';
import { User } from '../../types';
import { Screen } from '../../components/ui/Screen';
import { Skeleton } from '../../components/ui/Skeleton';
import { FadeIn } from '../../components/ui/FadeIn';
import { EditProfileSheet } from '../../components/profile/EditProfileSheet';
import { TutorialTarget } from '../../components/tutorial/TutorialTarget';
import { authApi, describeApiError } from '../../services/auth';
import { getAppLockState, subscribeAppLock } from '../../services/appLock';
import { openTutorialGuide } from '../../services/tutorialHint';

export default function MeScreen() {
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [editSheetVisible, setEditSheetVisible] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const mounted = useRef(true);
  const focused = useRef(false);
  const profileRequest = useRef(0);
  const logoutBusy = useRef(false);
  const editSheetOpen = useRef(false);

  const appLock = useSyncExternalStore(
    subscribeAppLock,
    getAppLockState,
    getAppLockState
  );
  const theme = useTheme();
  const { mode: themeMode, colors } = theme;
  const styles = useStyles(theme);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      profileRequest.current += 1;
    };
  }, []);

  const loadProfile = useCallback(async () => {
    if (!mounted.current || !focused.current) return;
    const request = ++profileRequest.current;
    const isCurrent = () =>
      mounted.current && focused.current && request === profileRequest.current;
    setProfileLoading(true);
    try {
      const profile = await authApi.getProfile();
      if (!isCurrent()) return;
      if (!profile) throw new Error('Missing account details.');
      setUser(profile);
      setError(null);
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
        profileRequest.current += 1;
      };
    }, [loadProfile])
  );

  const handleLogout = () => {
    if (logoutBusy.current || editSheetOpen.current) return;
    Alert.alert('Keluar dari akun', 'Kamu perlu masuk lagi untuk membuka data keuangan.', [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Keluar',
        style: 'destructive',
        onPress: async () => {
          if (!mounted.current || !focused.current || logoutBusy.current || editSheetOpen.current) return;
          logoutBusy.current = true;
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

  const profileReady = user !== null && !profileLoading && !error;
  const accountBusy = loggingOut || editSheetVisible;
  const canEditProfile = profileReady && !accountBusy;
  const profileStatus = profileLoading ? 'Loading account details...' : 'Account details unavailable.';
  const initial = user?.first_name?.trim().charAt(0).toUpperCase();

  const lockBadge = !appLock.ready
    ? 'Memuat keamanan'
    : !appLock.supported
    ? 'Keamanan perangkat'
    : appLock.enabled
    ? 'Kunci aktif'
    : 'Kunci nonaktif';
  const themeLabel = themeMode === 'dark' ? 'Dark' : 'Light';
  const settingsHint = `${lockBadge} · Tema ${themeLabel} · Akun terhubung`;

  return (
    <Screen tutorialScrollId="me" contentStyle={styles.content}>
      <FadeIn>
        <Text style={styles.title} accessibilityRole="header">Saya</Text>

        <View style={styles.profile}>
          <View style={styles.avatar} accessible={false} importantForAccessibility="no-hide-descendants">
            {user?.avatar_url ? (
              <Image source={{ uri: user.avatar_url }} style={styles.avatarImage} resizeMode="cover" />
            ) : initial ? (
              <Text style={styles.avatarText}>{initial}</Text>
            ) : (
              <Ionicons name="person-outline" size={22} color={colors.inkSoft} />
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
          {user ? (
            <Pressable
              onPress={() => {
                if (!canEditProfile) return;
                editSheetOpen.current = true;
                setEditSheetVisible(true);
              }}
              disabled={!canEditProfile}
              accessibilityRole="button"
              accessibilityLabel="Edit profil"
              accessibilityState={{ disabled: !canEditProfile }}
              style={({ pressed }) => [
                styles.editButton,
                !canEditProfile && styles.editButtonDisabled,
                pressed && canEditProfile && styles.editButtonPressed,
              ]}
            >
              <Ionicons name="pencil-outline" size={14} color={colors.ink} />
              <Text style={styles.editButtonText}>Edit</Text>
            </Pressable>
          ) : null}
        </View>

        {error ? (
          <View style={styles.errorPanel}>
            <Text style={styles.errorText} accessibilityLiveRegion="polite">{error}</Text>
            <MenuRow
              icon="refresh-outline"
              title="Coba lagi"
              onPress={loadProfile}
              disabled={profileLoading || accountBusy}
              busy={profileLoading}
              styles={styles}
              colors={colors}
              last
            />
          </View>
        ) : null}

        <TutorialTarget id="me.features" trimBottom={Space.xl}>
          <View style={styles.section}>
            <Text style={styles.sectionLabel} accessibilityRole="header">Fitur keuangan</Text>
            <MenuRow
              icon="repeat-outline"
              title="Transaksi berulang"
              hint="Jadwal pemasukan, pengeluaran, dan investasi otomatis"
              onPress={() => router.push('/recurring')}
              disabled={accountBusy}
              styles={styles}
              colors={colors}
            />
            <MenuRow
              icon="swap-horizontal-outline"
              title="Hutang & piutang"
              hint="Catat pinjaman, tagihan, dan progres pembayaran"
              onPress={() => router.push('/debts')}
              disabled={accountBusy}
              styles={styles}
              colors={colors}
            />
            <MenuRow
              icon="cart-outline"
              title="Daftar belanja"
              hint="Rencana belanja bulanan, target budget, dan ceklis"
              onPress={() => router.push('/shopping-lists')}
              disabled={accountBusy}
              styles={styles}
              colors={colors}
            />
            <MenuRow
              icon="time-outline"
              title="Riwayat perubahan"
              hint="Jejak edit dan penghapusan transaksi"
              onPress={() => router.push('/transaction-history')}
              disabled={accountBusy}
              styles={styles}
              colors={colors}
              last
            />
          </View>
        </TutorialTarget>

        <TutorialTarget id="me.settings" trimBottom={Space.xl}>
          <View style={styles.section}>
            <Text style={styles.sectionLabel} accessibilityRole="header">Akun & aplikasi</Text>
            <MenuRow
              icon="options-outline"
              title="Pengaturan"
              hint={settingsHint}
              onPress={() => router.push('/settings')}
              disabled={accountBusy}
              styles={styles}
              colors={colors}
            />
            <MenuRow
              icon="compass-outline"
              title="Panduan aplikasi"
              hint="Lihat ulang ringkasan tampilan dan fitur utama"
              onPress={openTutorialGuide}
              disabled={accountBusy}
              styles={styles}
              colors={colors}
              last
            />
          </View>
        </TutorialTarget>

        <View style={styles.logout}>
          <MenuRow
            icon="log-out-outline"
            title="Keluar dari akun"
            onPress={handleLogout}
            disabled={accountBusy}
            busy={loggingOut}
            styles={styles}
            colors={colors}
            last
          />
        </View>
      </FadeIn>

      <EditProfileSheet
        visible={editSheetVisible}
        user={user}
        onClose={() => {
          editSheetOpen.current = false;
          if (mounted.current) setEditSheetVisible(false);
        }}
        onSaved={(updatedUser) => {
          if (!mounted.current || !focused.current) return;
          profileRequest.current += 1;
          setUser(updatedUser);
          setError(null);
          setProfileLoading(false);
          editSheetOpen.current = false;
          setEditSheetVisible(false);
        }}
      />
    </Screen>
  );
}

type MeStyles = ReturnType<typeof useStyles>;

function MenuRow({
  icon,
  title,
  hint,
  onPress,
  disabled = false,
  busy = false,
  last = false,
  styles,
  colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  hint?: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  last?: boolean;
  styles: MeStyles;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const inactive = disabled || busy;
  const color = inactive ? colors.inkMuted : colors.inkSoft;
  return (
    <Pressable
      onPress={() => { if (!inactive) return onPress(); }}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={hint}
      accessibilityState={{ disabled: inactive, busy }}
      style={({ pressed }) => [styles.navRow, last && styles.lastRow, pressed && styles.pressed]}
    >
      <View style={styles.rowIcon} accessible={false} importantForAccessibility="no-hide-descendants">
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <View style={styles.navBody}>
        <Text style={[styles.navTitle, inactive && styles.disabledTitle]}>{title}</Text>
        {hint ? <Text style={styles.navHint}>{hint}</Text> : null}
      </View>
      <View style={styles.rowAccessory} accessible={false} importantForAccessibility="no-hide-descendants">
        {busy ? (
          <ActivityIndicator size="small" color={color} />
        ) : (
          <Ionicons name="chevron-forward" size={18} color={color} />
        )}
      </View>
    </Pressable>
  );
}

const useStyles = createThemedStyles(({ colors, type }) => StyleSheet.create({
  content: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  title: {
    ...type.h1,
    marginBottom: Space.lg,
  },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.lg,
    borderRadius: Radius.block,
    backgroundColor: colors.surfaceAlt,
    marginBottom: Space.xl,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: Radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarText: {
    fontFamily: Fonts.serif,
    fontSize: 28,
    color: colors.ink,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 44,
    paddingHorizontal: Space.md,
    borderRadius: Radius.control,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    flexShrink: 0,
  },
  editButtonDisabled: {
    opacity: 0.45,
  },
  editButtonPressed: {
    opacity: 0.8,
  },
  editButtonText: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    lineHeight: 18,
    color: colors.ink,
  },
  profileInfo: {
    flex: 1,
    minWidth: 0,
    gap: Space.xs,
  },
  userName: {
    ...type.h2,
  },
  userEmail: {
    ...type.caption,
    color: colors.inkSoft,
  },
  profileStatus: {
    ...type.caption,
  },
  skeletonLine: {
    marginTop: Space.xs,
  },
  errorPanel: {
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
    borderRadius: Radius.block,
    backgroundColor: colors.dangerTint,
    marginBottom: Space.xl,
  },
  errorText: {
    ...type.body,
    color: colors.danger,
  },
  section: {
    marginBottom: Space.xl,
  },
  sectionLabel: {
    ...type.caption,
    fontFamily: Fonts.semibold,
    color: colors.ink,
    marginBottom: Space.xs,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: 64,
    paddingVertical: Space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
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
    ...type.bodyStrong,
  },
  disabledTitle: {
    color: colors.inkMuted,
  },
  navHint: {
    ...type.caption,
    marginTop: Space.xs,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  pressed: {
    backgroundColor: colors.inkTint,
  },
  logout: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
}));
