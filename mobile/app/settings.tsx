import { AppAlert as Alert } from '../services/appAlert';
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, useWindowDimensions, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Fonts, Radius, Space, ThemeMode } from '../utils/theme';
import { createThemedStyles, useTheme } from '../services/theme';
import { User } from '../types';
import { Screen } from '../components/ui/Screen';
import { FadeIn } from '../components/ui/FadeIn';
import { authApi, describeApiError } from '../services/auth';
import { LinkGoogleSheet } from '../components/auth/LinkGoogleSheet';
import { isGoogleAuthAvailable } from '../services/googleAuth';
import { getAppLockState, subscribeAppLock } from '../services/appLock';
import {
  sendTestInstallmentNotification,
  setInstallmentRemindersEnabled,
  setInstallmentReminderTime,
  useInstallmentReminders,
} from '../services/installmentNotifications';

export default function SettingsScreen() {
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [googleAvailable, setGoogleAvailable] = useState<boolean | null>(null);
  const [linkSheetVisible, setLinkSheetVisible] = useState(false);
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const mounted = useRef(true);
  const focused = useRef(false);
  const profileRequest = useRef(0);
  const profileReadyRef = useRef(false);
  const telegramBusy = useRef(false);
  const googleSheetOpen = useRef(false);
  const { width, fontScale } = useWindowDimensions();
  const stackDetails = width < 360 || fontScale > 1.3;
  const appLock = useSyncExternalStore(
    subscribeAppLock,
    getAppLockState,
    getAppLockState
  );
  const theme = useTheme();
  const { mode: themeMode, colors, setThemeMode } = theme;
  const reminders = useInstallmentReminders();
  const [testingReminder, setTestingReminder] = useState(false);
  const styles = useStyles(theme);

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
  const accountBusy = linking || unlinking || linkSheetVisible;
  const profileActionsDisabled = !profileReady || accountBusy;
  const canUseProfile = () =>
    mounted.current && focused.current && profileReadyRef.current &&
    !telegramBusy.current && !googleSheetOpen.current;

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

  const profileStatus = profileLoading ? 'Loading account details...' : 'Account details unavailable.';
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
    <Screen bottomInset contentStyle={styles.content}>
      <FadeIn>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            style={styles.back}
            accessibilityRole="button"
            accessibilityLabel="Kembali"
          >
            <Ionicons name="arrow-back" size={20} color={colors.ink} />
          </Pressable>
          <Text style={styles.title} accessibilityRole="header">Pengaturan</Text>
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
              styles={styles}
              colors={colors}
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
            styles={styles}
            colors={colors}
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
            styles={styles}
            colors={colors}
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
            styles={styles}
            colors={colors}
          />
          {(profileReady || unlinking) && user?.telegram_linked ? (
            <SettingsRow
              icon="unlink-outline"
              title="Putuskan tautan Telegram"
              hint="Your financial records stay intact."
              onPress={handleUnlinkTelegram}
              disabled={profileActionsDisabled}
              busy={unlinking}
              styles={styles}
              colors={colors}
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
            styles={styles}
            colors={colors}
            last
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel} accessibilityRole="header">Preferences & app</Text>
          <ThemeRow
            mode={themeMode}
            onSelect={(next) => {
              void setThemeMode(next);
            }}
            stacked={stackDetails}
            disabled={accountBusy}
            styles={styles}
            colors={colors}
          />
          <ReminderRow
            reminders={reminders}
            stacked={stackDetails}
            disabled={accountBusy}
            testing={testingReminder}
            onToggle={async (next) => {
              const status = await setInstallmentRemindersEnabled(next);
              if (next && status === 'denied') {
                Alert.alert(
                  'Izin notifikasi ditolak',
                  'Aktifkan izin notifikasi untuk FinanceApp / Expo Go di pengaturan perangkat.'
                );
              }
            }}
            onSelectHour={(hour) => {
              void setInstallmentReminderTime(hour, 0);
            }}
            onTest={async () => {
              if (testingReminder) return;
              setTestingReminder(true);
              try {
                await sendTestInstallmentNotification();
                if (mounted.current && focused.current) {
                  Alert.alert(
                    'Notifikasi dijadwalkan',
                    'Pengingat cicilan akan muncul di panel notifikasi perangkat dalam 2 detik.'
                  );
                }
              } catch (err) {
                if (mounted.current && focused.current) {
                  Alert.alert(
                    'Gagal mengirim notifikasi',
                    err instanceof Error ? err.message : 'Coba lagi sebentar lagi.'
                  );
                }
              } finally {
                if (mounted.current) setTestingReminder(false);
              }
            }}
            styles={styles}
            colors={colors}
          />
          <DetailRow label="Mata uang" value={user?.currency || (profileLoading ? 'Loading...' : 'Not available')} stacked={stackDetails} styles={styles} />
          <DetailRow label="Zona waktu" value={user?.timezone || (profileLoading ? 'Loading...' : 'Not available')} stacked={stackDetails} styles={styles} />
          <DetailRow label="Versi" value="1.0.0" stacked={stackDetails} styles={styles} last />
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
            styles={styles}
            colors={colors}
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

type SettingsStyles = ReturnType<typeof useStyles>;

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
  styles: SettingsStyles;
  colors: ReturnType<typeof useTheme>['colors'];
};

function SettingsRow({ icon, title, hint, onPress, disabled = false, busy = false, complete = false, danger = false, last = false, styles, colors }: SettingsRowProps) {
  const inactive = disabled || busy;
  const color = danger ? colors.danger : inactive && onPress ? colors.inkMuted : colors.inkSoft;
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
          <Ionicons name="checkmark-circle-outline" size={20} color={colors.inkSoft} />
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

const THEME_OPTIONS: ReadonlyArray<{
  mode: ThemeMode;
  label: string;
  accessibilityLabel: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  { mode: 'light', label: 'Light', accessibilityLabel: 'Tema Light', icon: 'sunny-outline' },
  { mode: 'dark', label: 'Dark', accessibilityLabel: 'Tema Dark', icon: 'moon-outline' },
];

function ThemeRow({
  mode,
  onSelect,
  stacked,
  disabled = false,
  styles,
  colors,
}: {
  mode: ThemeMode;
  onSelect: (mode: ThemeMode) => void;
  stacked: boolean;
  disabled?: boolean;
  styles: SettingsStyles;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={[styles.themeRow, stacked && styles.stackedDetail]}>
      <View style={styles.themeMeta}>
        <Text style={styles.themeLabel}>Tema tampilan</Text>
        <Text style={styles.navHint}>{mode === 'dark' ? 'Mode gelap aktif' : 'Mode terang aktif'}</Text>
      </View>
      <View
        style={[styles.themeOptions, stacked && styles.themeOptionsStacked]}
        accessibilityRole="radiogroup"
        accessibilityLabel="Tema tampilan"
      >
        {THEME_OPTIONS.map((option) => {
          const active = mode === option.mode;
          return (
            <Pressable
              key={option.mode}
              onPress={() => {
                if (!disabled) onSelect(option.mode);
              }}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityLabel={option.accessibilityLabel}
              accessibilityState={{ checked: active, selected: active, disabled }}
              style={({ pressed }) => [
                styles.themeOption,
                stacked && styles.themeOptionStacked,
                active && styles.themeOptionActive,
                pressed && !disabled && styles.themeOptionPressed,
              ]}
            >
              <Ionicons
                name={option.icon}
                size={15}
                color={active ? colors.onInk : colors.inkSoft}
              />
              <Text style={[styles.themeOptionText, active && styles.themeOptionTextActive]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const REMINDER_HOURS = [8, 9, 20] as const;

function formatHour(hour: number, minute = 0): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function ReminderRow({
  reminders,
  stacked,
  disabled = false,
  testing = false,
  onToggle,
  onSelectHour,
  onTest,
  styles,
  colors,
}: {
  reminders: ReturnType<typeof useInstallmentReminders>;
  stacked: boolean;
  disabled?: boolean;
  testing?: boolean;
  onToggle: (enabled: boolean) => void;
  onSelectHour: (hour: number) => void;
  onTest: () => void;
  styles: SettingsStyles;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const hint = !reminders.supported
    ? 'Notifikasi perangkat tidak tersedia di versi web.'
    : !reminders.enabled
    ? 'Nonaktif · Pengingat jatuh tempo cicilan dimatikan'
    : reminders.permission === 'denied'
    ? 'Izin notifikasi ditolak · Aktifkan di pengaturan perangkat'
    : reminders.permission === 'granted'
    ? `Aktif · Pengingat H-3, H-1 & hari-H pukul ${formatHour(reminders.hour, reminders.minute)} (${reminders.scheduledCount} terjadwal)`
    : `Siap · Aktifkan izin atau uji notifikasi (${formatHour(reminders.hour, reminders.minute)})`;

  return (
    <View style={styles.reminderBlock}>
      <View style={styles.reminderTop}>
        <View style={styles.themeMeta}>
          <Text style={styles.themeLabel}>Pengingat cicilan</Text>
          <Text style={styles.navHint}>{hint}</Text>
        </View>
        {reminders.supported ? (
          <Switch
            value={reminders.enabled}
            onValueChange={onToggle}
            disabled={disabled}
            trackColor={{ false: colors.lineStrong, true: colors.inkSoft }}
            thumbColor={colors.surface}
            ios_backgroundColor={colors.lineStrong}
            accessibilityLabel="Aktifkan pengingat cicilan"
          />
        ) : null}
      </View>

      {reminders.supported && reminders.enabled ? (
        <View style={[styles.reminderControls, stacked && styles.reminderControlsStacked]}>
          <View
            style={styles.hourOptions}
            accessibilityRole="radiogroup"
            accessibilityLabel="Jam pengingat cicilan"
          >
            {REMINDER_HOURS.map((hour) => {
              const active = reminders.hour === hour;
              const label = formatHour(hour);
              return (
                <Pressable
                  key={hour}
                  onPress={() => {
                    if (!disabled) onSelectHour(hour);
                  }}
                  disabled={disabled}
                  accessibilityRole="radio"
                  accessibilityLabel={`Jam pengingat ${label}`}
                  accessibilityState={{ checked: active, selected: active, disabled }}
                  style={({ pressed }) => [
                    styles.hourPill,
                    active && styles.themeOptionActive,
                    pressed && !disabled && styles.themeOptionPressed,
                  ]}
                >
                  <Text style={[styles.themeOptionText, active && styles.themeOptionTextActive]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={onTest}
            disabled={disabled || testing}
            accessibilityRole="button"
            accessibilityLabel="Uji notifikasi cicilan"
            accessibilityState={{ disabled: disabled || testing, busy: testing }}
            style={({ pressed }) => [
              styles.testNotifyButton,
              pressed && !disabled && !testing && styles.themeOptionPressed,
            ]}
          >
            {testing ? (
              <ActivityIndicator size="small" color={colors.ink} />
            ) : (
              <Ionicons name="notifications-outline" size={15} color={colors.ink} />
            )}
            <Text style={styles.testNotifyText}>Uji notifikasi</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function DetailRow({ label, value, stacked, last = false, styles }: { label: string; value: string; stacked: boolean; last?: boolean; styles: SettingsStyles }) {
  return (
    <View style={[styles.detailRow, stacked && styles.stackedDetail, last && styles.lastRow]}>
      <Text style={[styles.rowLabel, stacked && styles.stackedValue]}>{label}</Text>
      <Text style={[styles.rowValue, stacked && styles.stackedValue]}>{value}</Text>
    </View>
  );
}

const useStyles = createThemedStyles(({ colors, type }) => StyleSheet.create({
  content: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    marginBottom: Space.lg,
  },
  back: {
    width: 44,
    height: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginLeft: -Space.sm,
  },
  title: {
    ...type.h2,
    flex: 1,
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
  dangerTitle: {
    color: colors.danger,
  },
  disabledTitle: {
    color: colors.inkMuted,
  },
  navHint: {
    ...type.caption,
    marginTop: Space.xs,
  },
  themeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
    minHeight: 64,
    paddingVertical: Space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  themeMeta: {
    flex: 1,
    minWidth: 0,
  },
  themeLabel: {
    ...type.bodyStrong,
  },
  themeOptions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    flexShrink: 0,
  },
  themeOptionsStacked: {
    marginTop: Space.xs,
  },
  themeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: Space.md,
    borderRadius: Radius.control,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
  },
  themeOptionStacked: {
    flex: 1,
  },
  themeOptionActive: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  themeOptionPressed: {
    opacity: 0.8,
  },
  themeOptionText: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkSoft,
  },
  themeOptionTextActive: {
    color: colors.onInk,
    fontFamily: Fonts.semibold,
  },
  reminderBlock: {
    paddingVertical: Space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    gap: Space.md,
  },
  reminderTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
  },
  reminderControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
    flexWrap: 'wrap',
  },
  reminderControlsStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  hourOptions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  hourPill: {
    minHeight: 40,
    paddingHorizontal: Space.md,
    borderRadius: Radius.control,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  testNotifyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: Space.md,
    borderRadius: Radius.control,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surfaceAlt,
  },
  testNotifyText: {
    fontFamily: Fonts.medium,
    fontSize: 12,
    lineHeight: 16,
    color: colors.ink,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: 48,
    paddingVertical: Space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  stackedDetail: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: Space.xs,
  },
  rowLabel: {
    ...type.body,
    color: colors.inkSoft,
    flex: 1,
    minWidth: 0,
  },
  rowValue: {
    ...type.bodyStrong,
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
    backgroundColor: colors.inkTint,
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
  dangerArea: {
    marginTop: Space.md,
    padding: Space.lg,
    borderRadius: Radius.block,
    backgroundColor: colors.dangerTint,
  },
}));
