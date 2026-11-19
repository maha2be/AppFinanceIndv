import { AppAlert as Alert } from '../services/appAlert';
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  AppState,
  AppStateStatus,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Radius, Space, Type } from '../utils/theme';
import { useReducedMotion } from '../utils/motion';
import { Screen } from '../components/ui/Screen';
import { Input } from '../components/ui/Input';
import { PatternInput } from '../components/security/PatternInput';
import { isValidLockPattern } from '../utils/lockPattern';
import {
  changeAppLockPin,
  disableAppLock,
  enableAppLock,
  getAppLockState,
  getBiometricAvailability,
  hydrateAppLock,
  setAppLockBiometrics,
  setAppLockPattern,
  subscribeAppLock,
} from '../services/appLock';

const PIN_PATTERN = /^[0-9]{6}$/;
type ManagementView = 'overview' | 'enable' | 'change-pin' | 'biometrics' | 'pattern' | 'remove-pattern' | 'disable';
type PatternSetupStep = 'summary' | 'draw' | 'repeat';

function sanitizePinInput(value: string): string {
  return value.replace(/[^0-9]/g, '').slice(0, 6);
}

function patternsMatch(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

export default function AppLockSettingsScreen() {
  const reducedMotion = useReducedMotion();
  const lockState = useSyncExternalStore(subscribeAppLock, getAppLockState, getAppLockState);
  const [view, setView] = useState<ManagementView>('overview');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [newPattern, setNewPattern] = useState<number[]>([]);
  const [confirmPattern, setConfirmPattern] = useState<number[]>([]);
  const [patternStep, setPatternStep] = useState<PatternSetupStep>('summary');
  const [error, setError] = useState<string | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [checkingBiometrics, setCheckingBiometrics] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [patternDrawing, setPatternDrawing] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const newPinRef = useRef('');
  const confirmPinRef = useRef('');
  const currentPinRef = useRef('');
  const newPatternRef = useRef<number[]>([]);
  const confirmPatternRef = useRef<number[]>([]);
  const patternStepRef = useRef<PatternSetupStep>('summary');
  const viewRef = useRef<ManagementView>('overview');
  const mountedRef = useRef(true);
  const focusedRef = useRef(true);
  const foregroundRef = useRef(AppState.currentState == null || AppState.currentState === 'active');
  const submitLockRef = useRef(false);
  const actionGenerationRef = useRef(0);

  const clearPinFields = useCallback(() => {
    newPinRef.current = '';
    confirmPinRef.current = '';
    currentPinRef.current = '';
    if (mountedRef.current) {
      setNewPin('');
      setConfirmPin('');
      setCurrentPin('');
    }
  }, []);

  const clearAllPinFields = useCallback(() => {
    clearPinFields();
    newPatternRef.current = [];
    confirmPatternRef.current = [];
    patternStepRef.current = 'summary';
    if (mountedRef.current) {
      setNewPattern([]);
      setConfirmPattern([]);
      setPatternStep('summary');
      setPatternDrawing(false);
    }
  }, [clearPinFields]);

  const returnToOverview = useCallback((message: string | null = null) => {
    actionGenerationRef.current += 1;
    viewRef.current = 'overview';
    clearAllPinFields();
    if (mountedRef.current) {
      setView('overview');
      setError(message);
      Keyboard.dismiss();
    }
  }, [clearAllPinFields]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      focusedRef.current = false;
      actionGenerationRef.current += 1;
      viewRef.current = 'overview';
      clearAllPinFields();
    };
  }, [clearAllPinFields]);

  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    return () => {
      focusedRef.current = false;
      returnToOverview();
    };
  }, [returnToOverview]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      foregroundRef.current = nextState === 'active';
      if (nextState !== 'active') returnToOverview();
    });
    return () => subscription.remove();
  }, [returnToOverview]);

  useEffect(() => {
    if (!lockState.ready || lockState.locked || lockState.covered || lockState.storageError) {
      returnToOverview();
    }
  }, [lockState.ready, lockState.locked, lockState.covered, lockState.storageError, returnToOverview]);

  useEffect(() => {
    let active = true;
    if (!lockState.ready || !lockState.supported) {
      setBiometricAvailable(false);
      setCheckingBiometrics(false);
      return () => { active = false; };
    }
    setCheckingBiometrics(true);
    getBiometricAvailability()
      .then((available) => {
        if (active && mountedRef.current) setBiometricAvailable(Boolean(available));
      })
      .catch(() => {
        if (active && mountedRef.current) setBiometricAvailable(false);
      })
      .finally(() => {
        if (active && mountedRef.current) setCheckingBiometrics(false);
      });
    return () => { active = false; };
  }, [lockState.ready, lockState.supported, lockState.enabled, lockState.biometricsEnabled]);

  useEffect(() => {
    if (!lockState.retryAt || lockState.retryAt <= Date.now()) return;
    setNowMs(Date.now());
    const interval = setInterval(() => {
      const current = Date.now();
      setNowMs(current);
      if (current >= lockState.retryAt) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [lockState.retryAt]);

  const cooldownSeconds = lockState.retryAt > nowMs ? Math.ceil((lockState.retryAt - nowMs) / 1000) : 0;
  const inCooldown = cooldownSeconds > 0;
  const isBusy = lockState.busy || submitting;

  useEffect(() => {
    if (inCooldown) returnToOverview();
  }, [inCooldown, returnToOverview]);

  const canNavigate = () => mountedRef.current && focusedRef.current && foregroundRef.current &&
    !submitLockRef.current && !getAppLockState().busy;
  const hasSafeDeviceState = () => {
    const latest = getAppLockState();
    return latest.ready && latest.supported && !latest.locked && !latest.covered && !latest.storageError;
  };
  const canManage = (expectedView: ManagementView) => {
    const latest = getAppLockState();
    return canNavigate() && hasSafeDeviceState() && latest.retryAt <= Date.now() &&
      viewRef.current === expectedView && (expectedView === 'enable' ? !latest.enabled : latest.enabled);
  };
  const isCurrentAction = (ticket: number, expectedView: ManagementView) =>
    mountedRef.current && focusedRef.current && foregroundRef.current &&
    ticket === actionGenerationRef.current && viewRef.current === expectedView;

  const handlePatternDrawingChange = useCallback((drawing: boolean) => {
    if (!mountedRef.current) return;
    setPatternDrawing(drawing && focusedRef.current && foregroundRef.current && viewRef.current === 'pattern');
  }, []);

  const handleBack = () => {
    if (!canNavigate()) return;
    if (viewRef.current !== 'overview') {
      returnToOverview();
      return;
    }
    returnToOverview();
    router.back();
  };
  const handleCancel = () => {
    if (canNavigate()) returnToOverview();
  };
  const openView = (nextView: ManagementView) => {
    const latest = getAppLockState();
    if (!canNavigate() || viewRef.current !== 'overview' || !hasSafeDeviceState() || latest.retryAt > Date.now()) return;
    if (nextView === 'enable' ? latest.enabled : !latest.enabled) return;
    returnToOverview();
    viewRef.current = nextView;
    setView(nextView);
    if (nextView === 'pattern') {
      patternStepRef.current = 'draw';
      setPatternStep('draw');
    }
  };

  const updatePin = (text: string, field: 'current' | 'new' | 'confirm') => {
    if (!canManage(view)) return;
    actionGenerationRef.current += 1;
    setError(null);
    const clean = sanitizePinInput(text);
    if (field === 'current') {
      currentPinRef.current = clean;
      setCurrentPin(clean);
    } else if (field === 'new') {
      newPinRef.current = clean;
      setNewPin(clean);
    } else {
      confirmPinRef.current = clean;
      setConfirmPin(clean);
    }
  };
  const startSubmission = () => {
    submitLockRef.current = true;
    setSubmitting(true);
    setError(null);
    return ++actionGenerationRef.current;
  };
  const finishSubmission = () => {
    submitLockRef.current = false;
    if (mountedRef.current) setSubmitting(false);
  };
  const operationSucceeded = (ticket: number, expectedView: ManagementView, title: string, message: string) => {
    if (!isCurrentAction(ticket, expectedView) || !hasSafeDeviceState()) return;
    returnToOverview();
    Alert.alert(title, message);
  };
  const operationFailed = (err: unknown, ticket: number, expectedView: ManagementView, fallback: string) => {
    if (!isCurrentAction(ticket, expectedView)) return;
    const message = err instanceof Error && err.message ? err.message : fallback;
    const latest = getAppLockState();
    const now = Date.now();
    setNowMs(now);
    if (!hasSafeDeviceState() || latest.retryAt > now) {
      returnToOverview(message);
    } else {
      clearPinFields();
      setError(message);
    }
  };

  const handleRetryHydrate = async () => {
    if (!canNavigate()) return;
    const ticket = startSubmission();
    try {
      await hydrateAppLock();
    } catch (err) {
      if (isCurrentAction(ticket, 'overview')) {
        setError(err instanceof Error && err.message ? err.message : 'Gagal memuat pengaturan kunci aplikasi.');
      }
    } finally {
      finishSubmission();
    }
  };

  const handleEnableLock = async () => {
    if (!canManage('enable')) return;
    const pinCandidate = newPinRef.current;
    const confirmCandidate = confirmPinRef.current;
    if (!PIN_PATTERN.test(pinCandidate)) {
      setError('PIN harus terdiri dari tepat 6 digit angka.');
      return;
    }
    if (!PIN_PATTERN.test(confirmCandidate)) {
      setError('Konfirmasi PIN harus terdiri dari tepat 6 digit angka.');
      return;
    }
    if (pinCandidate !== confirmCandidate) {
      setError('PIN baru dan konfirmasi PIN tidak cocok.');
      return;
    }
    const ticket = startSubmission();
    try {
      await enableAppLock(pinCandidate);
      operationSucceeded(ticket, 'enable', 'Kunci aplikasi aktif', 'PIN 6 digit berhasil disimpan untuk melindungi aplikasi di perangkat ini.');
    } catch (err) {
      operationFailed(err, ticket, 'enable', 'Gagal mengaktifkan kunci aplikasi.');
    } finally {
      finishSubmission();
    }
  };

  const handleChangePin = async () => {
    if (!canManage('change-pin')) return;
    const currCandidate = currentPinRef.current;
    const nextCandidate = newPinRef.current;
    const confirmCandidate = confirmPinRef.current;
    if (!PIN_PATTERN.test(currCandidate)) {
      setError('Masukkan PIN saat ini (6 digit).');
      return;
    }
    if (!PIN_PATTERN.test(nextCandidate)) {
      setError('PIN baru harus terdiri dari tepat 6 digit angka.');
      return;
    }
    if (!PIN_PATTERN.test(confirmCandidate)) {
      setError('Konfirmasi PIN baru harus terdiri dari tepat 6 digit angka.');
      return;
    }
    if (nextCandidate !== confirmCandidate) {
      setError('PIN baru dan konfirmasi PIN baru tidak cocok.');
      return;
    }
    const ticket = startSubmission();
    try {
      await changeAppLockPin(currCandidate, nextCandidate);
      operationSucceeded(ticket, 'change-pin', 'PIN diperbarui', 'PIN kunci aplikasi berhasil diganti.');
    } catch (err) {
      operationFailed(err, ticket, 'change-pin', 'Gagal mengganti PIN kunci aplikasi.');
    } finally {
      finishSubmission();
    }
  };

  const handleToggleBiometrics = async () => {
    if (!canManage('biometrics') || checkingBiometrics) return;
    const currCandidate = currentPinRef.current;
    if (!PIN_PATTERN.test(currCandidate)) {
      setError('Masukkan PIN saat ini (6 digit) untuk mengubah pengaturan biometrik.');
      return;
    }
    const nextEnabled = !getAppLockState().biometricsEnabled;
    if (nextEnabled && !biometricAvailable) {
      setError('Sidik jari / biometrik tidak tersedia atau belum terdaftar di perangkat ini.');
      return;
    }
    const ticket = startSubmission();
    try {
      await setAppLockBiometrics(currCandidate, nextEnabled);
      operationSucceeded(
        ticket, 'biometrics', nextEnabled ? 'Biometrik diaktifkan' : 'Biometrik dinonaktifkan',
        nextEnabled
          ? 'Sidik jari / biometrik kini dapat digunakan untuk membuka kunci aplikasi.'
          : 'Pembukaan kunci dengan sidik jari / biometrik telah dimatikan.'
      );
    } catch (err) {
      operationFailed(err, ticket, 'biometrics', 'Gagal memperbarui pengaturan sidik jari / biometrik.');
    } finally {
      finishSubmission();
    }
  };

  const handleAdvancePatternToRepeat = () => {
    if (!canManage('pattern') || patternStepRef.current !== 'draw') return;
    if (!isValidLockPattern(newPatternRef.current)) {
      setError('Pola baru harus menghubungkan minimal 4 titik.');
      return;
    }
    setError(null);
    confirmPatternRef.current = [];
    setConfirmPattern([]);
    patternStepRef.current = 'repeat';
    setPatternStep('repeat');
    setPatternDrawing(false);
  };
  const handleBackToDrawPattern = () => {
    if (!canManage('pattern')) return;
    actionGenerationRef.current += 1;
    clearAllPinFields();
    setError(null);
    patternStepRef.current = 'draw';
    setPatternStep('draw');
  };
  const handleSavePattern = async () => {
    if (!canManage('pattern') || patternStepRef.current !== 'repeat') return;
    const currCandidate = currentPinRef.current;
    const nextCandidate = newPatternRef.current;
    const confirmCandidate = confirmPatternRef.current;
    if (!isValidLockPattern(nextCandidate)) {
      clearPinFields();
      confirmPatternRef.current = [];
      setConfirmPattern([]);
      setError('Pola baru harus menghubungkan minimal 4 titik.');
      patternStepRef.current = 'draw';
      setPatternStep('draw');
      return;
    }
    if (!isValidLockPattern(confirmCandidate)) {
      setError('Konfirmasi pola baru harus menghubungkan minimal 4 titik.');
      return;
    }
    if (!patternsMatch(nextCandidate, confirmCandidate)) {
      confirmPatternRef.current = [];
      setConfirmPattern([]);
      setError('Pola baru dan konfirmasi pola tidak cocok. Silakan ulangi konfirmasi pola.');
      return;
    }
    if (!PIN_PATTERN.test(currCandidate)) {
      setError('Masukkan PIN saat ini (6 digit) untuk menyimpan pola kunci.');
      return;
    }
    const wasEnabled = getAppLockState().patternEnabled;
    const ticket = startSubmission();
    try {
      await setAppLockPattern(currCandidate, nextCandidate);
      operationSucceeded(
        ticket, 'pattern', wasEnabled ? 'Pola kunci diperbarui' : 'Pola kunci diaktifkan',
        'Pola 3x3 berhasil disimpan sebagai metode buka kunci pendamping PIN.'
      );
    } catch (err) {
      operationFailed(err, ticket, 'pattern', 'Gagal menyimpan pola kunci aplikasi.');
    } finally {
      finishSubmission();
    }
  };

  const executeRemovePattern = async (confirmationTicket: number) => {
    if (!canManage('remove-pattern') || confirmationTicket !== actionGenerationRef.current || !getAppLockState().patternEnabled) return;
    const currCandidate = currentPinRef.current;
    if (!PIN_PATTERN.test(currCandidate)) return;
    const ticket = startSubmission();
    clearPinFields();
    try {
      await setAppLockPattern(currCandidate, null);
      operationSucceeded(ticket, 'remove-pattern', 'Pola kunci dihapus', 'Pembukaan kunci dengan pola telah dinonaktifkan. PIN 6 digit tetap aktif.');
    } catch (err) {
      operationFailed(err, ticket, 'remove-pattern', 'Gagal menghapus pola kunci aplikasi.');
    } finally {
      finishSubmission();
    }
  };
  const executeDisableLock = async (confirmationTicket: number) => {
    if (!canManage('disable') || confirmationTicket !== actionGenerationRef.current) return;
    const currCandidate = currentPinRef.current;
    if (!PIN_PATTERN.test(currCandidate)) return;
    const ticket = startSubmission();
    clearPinFields();
    try {
      await disableAppLock(currCandidate);
      operationSucceeded(ticket, 'disable', 'Kunci aplikasi dinonaktifkan', 'Kunci aplikasi pada perangkat ini telah dimatikan.');
    } catch (err) {
      operationFailed(err, ticket, 'disable', 'Gagal menonaktifkan kunci aplikasi.');
    } finally {
      finishSubmission();
    }
  };
  const handleRemovePatternPrompt = () => {
    if (!canManage('remove-pattern') || !getAppLockState().patternEnabled) return;
    if (!PIN_PATTERN.test(currentPinRef.current)) {
      setError('Masukkan PIN saat ini (6 digit) untuk menghapus pola kunci.');
      return;
    }
    const ticket = ++actionGenerationRef.current;
    const cancel = () => {
      if (isCurrentAction(ticket, 'remove-pattern')) returnToOverview();
    };
    // The dialog owns only an action ticket. Read the live PIN after confirmation.
    Alert.alert('Hapus pola kunci?', 'Pola kunci pada perangkat ini akan dihapus. PIN 6 digit tetap digunakan untuk membuka aplikasi.', [
      { text: 'Batal', style: 'cancel', onPress: cancel },
      { text: 'Hapus pola', style: 'destructive', onPress: () => executeRemovePattern(ticket) },
    ], { onDismiss: cancel });
  };
  const handleDisableLockPrompt = () => {
    if (!canManage('disable')) return;
    if (!PIN_PATTERN.test(currentPinRef.current)) {
      setError('Masukkan PIN saat ini (6 digit) untuk menonaktifkan kunci aplikasi.');
      return;
    }
    const ticket = ++actionGenerationRef.current;
    const cancel = () => {
      if (isCurrentAction(ticket, 'disable')) returnToOverview();
    };
    Alert.alert('Nonaktifkan kunci aplikasi?', 'PIN, pola kunci, dan pengaturan sidik jari / biometrik di perangkat ini akan dihapus.', [
      { text: 'Batal', style: 'cancel', onPress: cancel },
      { text: 'Nonaktifkan', style: 'destructive', onPress: () => executeDisableLock(ticket) },
    ], { onDismiss: cancel });
  };

  const activeError = error || (lockState.storageError ? lockState.error : null);
  const notice = inCooldown
    ? `Terlalu banyak percobaan salah. Coba lagi dalam ${cooldownSeconds} detik.`
    : activeError;
  const errorNotice = notice ? (
    <View style={styles.errorNotice} accessibilityLiveRegion="polite">
      <Ionicons name={inCooldown ? 'time-outline' : 'alert-circle-outline'} size={18} color={Colors.danger} accessible={false} />
      <Text style={styles.errorText}>{notice}</Text>
    </View>
  ) : null;
  const fieldsDisabled = isBusy || inCooldown;
  const biometricUsable = biometricAvailable || lockState.biometricsEnabled;
  const biometricHint = checkingBiometrics
    ? 'Memeriksa dukungan sidik jari / biometrik perangkat...'
    : lockState.biometricsEnabled
    ? biometricAvailable ? 'Enabled. PIN remains available.' : 'Enabled, but currently unavailable on this device. PIN remains available.'
    : biometricAvailable
    ? 'Off. Use device biometrics alongside your PIN.'
    : 'Not available. Enroll biometrics in device settings.';
  const viewTitle = view === 'enable' ? 'Aktifkan PIN 6 digit'
    : view === 'change-pin' ? 'Ganti PIN'
    : view === 'biometrics' ? 'Sidik jari / biometrik'
    : view === 'pattern' ? 'Pola kunci (3x3)'
    : view === 'remove-pattern' ? 'Hapus pola kunci'
    : view === 'disable' ? 'Matikan kunci aplikasi'
    : 'Kunci aplikasi';

  return (
    <Screen bottomInset keyboardBehavior="padding" contentStyle={styles.screenContent} scrollEnabled={!patternDrawing}>
      <View style={styles.header}>
        <Pressable
          onPress={handleBack}
          disabled={isBusy}
          style={({ pressed }) => [styles.back, pressed && styles.pressed, pressed && !reducedMotion && styles.pressedScale]}
          accessibilityRole="button"
          accessibilityLabel="Kembali"
          accessibilityState={{ disabled: isBusy }}
        >
          <Ionicons name="arrow-back" size={20} color={isBusy ? Colors.inkMuted : Colors.ink} accessible={false} />
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">{viewTitle}</Text>
      </View>

      {!lockState.ready ? (
        <View style={styles.loadingBlock} accessibilityState={{ busy: true }}>
          <ActivityIndicator size="small" color={Colors.inkMuted} accessibilityLabel="Memuat pengaturan kunci aplikasi" />
          <Text style={styles.body}>Memuat status keamanan perangkat...</Text>
        </View>
      ) : !lockState.supported ? (
        <View style={styles.focusContent}>
          <Text style={styles.focusTitle}>Tidak didukung di perangkat ini</Text>
          <Text style={styles.body}>
            Kunci aplikasi memerlukan penyimpanan aman perangkat (SecureStore) dan kriptografi
            bawaan sistem yang hanya tersedia pada aplikasi mobile Android atau iOS, bukan versi
            web atau biner lama tanpa modul keamanan.
          </Text>
          <LockButton reducedMotion={reducedMotion} title="Kembali ke pengaturan" secondary onPress={handleBack} disabled={isBusy} />
        </View>
      ) : lockState.storageError ? (
        <View style={styles.focusContent}>
          <Text style={styles.focusTitle}>Security settings unavailable</Text>
          {errorNotice}
          <Text style={styles.body}>Restore access to secure device storage before changing app lock.</Text>
          <LockButton reducedMotion={reducedMotion} title="Coba lagi" secondary onPress={handleRetryHydrate} busy={isBusy} />
        </View>
      ) : lockState.locked || lockState.covered ? (
        <View style={styles.focusContent}>
          <Text style={styles.focusTitle}>Unlock the app first</Text>
          <Text style={styles.body}>App lock settings are unavailable while this device is locked or the app is covered.</Text>
          {errorNotice}
        </View>
      ) : view === 'overview' ? (
        <>
          <View style={styles.summary}>
            <View style={styles.summaryHeader}>
              <View style={[styles.statusIcon, lockState.enabled && styles.enabledIcon]} accessible={false} importantForAccessibility="no-hide-descendants">
                <Ionicons name={lockState.enabled ? 'shield-checkmark-outline' : 'lock-open-outline'} size={22} color={lockState.enabled ? Colors.income : Colors.inkSoft} />
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.summaryTitle}>{lockState.enabled ? 'Aktif' : 'Nonaktif'}</Text>
                <Text style={styles.summaryText}>{lockState.enabled ? 'Your PIN protects access on this device.' : 'Set a six-digit PIN to protect access on this device.'}</Text>
              </View>
            </View>
            {lockState.enabled ? <Text style={styles.fallbackNote}>PIN is always available as your fallback.</Text> : null}
          </View>
          {errorNotice}
          {!lockState.enabled ? (
            <View style={styles.focusContent}>
              <Text style={styles.body}>Buat PIN 6 digit angka. Jika kamu lupa PIN di kemudian hari, kamu perlu keluar dan masuk kembali ke akunmu.</Text>
              <LockButton reducedMotion={reducedMotion} title="Aktifkan PIN 6 digit" onPress={() => openView('enable')} disabled={fieldsDisabled} />
            </View>
          ) : (
            <>
              <View style={styles.section}>
                <Text style={styles.sectionLabel} accessibilityRole="header">Unlock methods</Text>
                <ActionRow reducedMotion={reducedMotion} icon="key-outline" title="Ganti PIN" hint="6-digit PIN. Active and required as your fallback." onPress={() => openView('change-pin')} disabled={fieldsDisabled} />
                <ActionRow reducedMotion={reducedMotion} icon="grid-outline" title={lockState.patternEnabled ? 'Ubah pola kunci' : 'Atur pola kunci'} hint={lockState.patternEnabled ? 'Active. Optional drag pattern alongside your PIN.' : 'Off. Add an optional 4-9 dot drag pattern.'} onPress={() => openView('pattern')} disabled={fieldsDisabled} />
                <ActionRow reducedMotion={reducedMotion} icon="finger-print-outline" title="Sidik jari / biometrik" hint={biometricHint} onPress={() => openView('biometrics')} disabled={fieldsDisabled || checkingBiometrics || !biometricUsable} busy={checkingBiometrics} last />
              </View>
              <View style={styles.dangerArea}>
                <Text style={styles.sectionLabel} accessibilityRole="header">Remove protection</Text>
                {lockState.patternEnabled ? <ActionRow reducedMotion={reducedMotion} icon="trash-outline" title="Hapus pola kunci" hint="Remove only the pattern. Your PIN stays active." onPress={() => openView('remove-pattern')} disabled={fieldsDisabled} danger /> : null}
                <ActionRow reducedMotion={reducedMotion} icon="lock-open-outline" title="Nonaktifkan kunci aplikasi" hint="Remove PIN, pattern, and biometrics from this device." onPress={() => openView('disable')} disabled={fieldsDisabled} danger last />
              </View>
            </>
          )}
        </>
      ) : (
        <View style={styles.focusContent}>
          {view === 'enable' || view === 'change-pin' ? (
            <>
              <Text style={styles.body}>{view === 'enable' ? 'Create and confirm a six-digit PIN for this device.' : 'Verify your current PIN, then choose and confirm a new six-digit PIN.'}</Text>
              {view === 'change-pin' ? <PinField label="PIN saat ini" value={currentPin} onChange={(text) => updatePin(text, 'current')} disabled={fieldsDisabled} /> : null}
              <PinField label="PIN baru (6 digit)" accessibilityLabel="PIN baru 6 digit" value={newPin} onChange={(text) => updatePin(text, 'new')} disabled={fieldsDisabled} />
              <PinField label="Konfirmasi PIN baru" value={confirmPin} onChange={(text) => updatePin(text, 'confirm')} onSubmit={view === 'enable' ? handleEnableLock : handleChangePin} disabled={fieldsDisabled} />
              {errorNotice}
              <LockButton reducedMotion={reducedMotion} title={view === 'enable' ? 'Aktifkan kunci aplikasi' : 'Simpan PIN baru'} onPress={view === 'enable' ? handleEnableLock : handleChangePin} busy={isBusy} disabled={inCooldown} />
            </>
          ) : view === 'biometrics' ? (
            <>
              <Text style={styles.body}>{lockState.biometricsEnabled ? 'Turn off biometric unlock on this device. Your PIN stays active.' : 'Verify your PIN, then confirm with your device biometrics. Your PIN stays active.'}</Text>
              <View style={styles.methodNote}><Text style={styles.body}>{biometricHint}</Text></View>
              <PinField label="PIN saat ini" value={currentPin} onChange={(text) => updatePin(text, 'current')} onSubmit={handleToggleBiometrics} disabled={fieldsDisabled || checkingBiometrics || !biometricUsable} />
              {errorNotice}
              <LockButton reducedMotion={reducedMotion} title={lockState.biometricsEnabled ? 'Disable biometrics' : 'Enable biometrics'} onPress={handleToggleBiometrics} busy={isBusy} disabled={inCooldown || checkingBiometrics || !biometricUsable} />
            </>
          ) : view === 'pattern' ? (
            <>
              <Text style={styles.body}>Add a drag pattern alongside your PIN. Your six-digit PIN remains available.</Text>
              <Text style={styles.stepIndicator}>{patternStep === 'repeat' ? 'Langkah 2 dari 2' : 'Langkah 1 dari 2'}</Text>
              {patternStep !== 'repeat' ? (
                <>
                  <PatternInput
                    label={lockState.patternEnabled ? 'Gambar pola baru (4-9 titik)' : 'Buat pola baru (4-9 titik)'}
                    hint="Sentuh salah satu titik lalu tarik garis tanpa melepas jari."
                    value={newPattern}
                    onDrawingChange={handlePatternDrawingChange}
                    onChange={(next) => {
                      if (!canManage('pattern') || patternStepRef.current !== 'draw') return;
                      setError(null);
                      newPatternRef.current = [...next];
                      setNewPattern([...next]);
                    }}
                    disabled={fieldsDisabled}
                    accessibilityLabel="Pola baru 3x3"
                  />
                  {errorNotice}
                  <LockButton reducedMotion={reducedMotion} title="Lanjut ke konfirmasi pola" onPress={handleAdvancePatternToRepeat} disabled={fieldsDisabled || !isValidLockPattern(newPattern)} />
                </>
              ) : (
                <>
                  <View style={styles.methodNote}><Text style={styles.body}>Pola pertama siap dikonfirmasi. Ulangi pola yang sama lalu masukkan PIN saat ini di bawah untuk menyimpan.</Text></View>
                  <PatternInput
                    label="Ulangi pola baru untuk konfirmasi"
                    hint="Tarik pola yang sama persis seperti langkah sebelumnya."
                    value={confirmPattern}
                    onDrawingChange={handlePatternDrawingChange}
                    onChange={(next) => {
                      if (!canManage('pattern') || patternStepRef.current !== 'repeat') return;
                      setError(null);
                      confirmPatternRef.current = [...next];
                      setConfirmPattern([...next]);
                    }}
                    disabled={fieldsDisabled}
                    accessibilityLabel="Konfirmasi pola baru 3x3"
                  />
                  <PinField label="PIN saat ini untuk menyimpan pola" value={currentPin} onChange={(text) => updatePin(text, 'current')} onSubmit={handleSavePattern} disabled={fieldsDisabled} />
                  {errorNotice}
                  <LockButton reducedMotion={reducedMotion} title={lockState.patternEnabled ? 'Simpan pola baru' : 'Aktifkan pola kunci'} onPress={handleSavePattern} busy={isBusy} disabled={inCooldown || !isValidLockPattern(confirmPattern)} />
                  <LockButton reducedMotion={reducedMotion} title="Gambar ulang pola pertama" secondary onPress={handleBackToDrawPattern} disabled={fieldsDisabled} />
                </>
              )}
            </>
          ) : (
            <>
              <View style={styles.warningNote}>
                <Ionicons name="warning-outline" size={20} color={Colors.danger} accessible={false} />
                <Text style={styles.warningText}>{view === 'remove-pattern' ? 'This removes only the pattern from this device. Your six-digit PIN stays active.' : 'This removes the PIN, pattern, and biometric settings from this device. Your financial records are not deleted.'}</Text>
              </View>
              <PinField label="PIN saat ini" value={currentPin} onChange={(text) => updatePin(text, 'current')} onSubmit={view === 'remove-pattern' ? handleRemovePatternPrompt : handleDisableLockPrompt} disabled={fieldsDisabled} />
              {errorNotice}
              <LockButton reducedMotion={reducedMotion} title={view === 'remove-pattern' ? 'Hapus pola kunci' : 'Nonaktifkan kunci aplikasi'} danger onPress={view === 'remove-pattern' ? handleRemovePatternPrompt : handleDisableLockPrompt} busy={isBusy} disabled={inCooldown} />
            </>
          )}
          <LockButton reducedMotion={reducedMotion} title="Batal" secondary onPress={handleCancel} disabled={isBusy} />
        </View>
      )}
    </Screen>
  );
}

function PinField({ label, accessibilityLabel = label, value, onChange, onSubmit, disabled }: {
  label: string;
  accessibilityLabel?: string;
  value: string;
  onChange: (text: string) => void;
  onSubmit?: () => void;
  disabled: boolean;
}) {
  return (
    <Input
      label={label}
      placeholder="••••••"
      value={value}
      onChangeText={onChange}
      keyboardType="number-pad"
      inputMode="numeric"
      maxLength={6}
      secureTextEntry
      autoCorrect={false}
      autoCapitalize="none"
      autoComplete="off"
      textContentType="none"
      contextMenuHidden
      editable={!disabled}
      returnKeyType={onSubmit ? 'done' : 'next'}
      onSubmitEditing={onSubmit}
      accessibilityLabel={accessibilityLabel}
      fieldStyle={styles.pinField}
    />
  );
}

function LockButton({ title, onPress, reducedMotion, busy = false, disabled = false, secondary = false, danger = false }: {
  title: string;
  onPress: () => void;
  reducedMotion: boolean;
  busy?: boolean;
  disabled?: boolean;
  secondary?: boolean;
  danger?: boolean;
}) {
  const inactive = disabled || busy;
  return (
    <Pressable
      onPress={() => { if (!inactive) return onPress(); }}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: inactive, busy }}
      style={({ pressed }) => [styles.button, secondary && styles.secondaryButton, danger && styles.dangerButton, inactive && styles.inactiveButton, pressed && styles.pressed, pressed && !reducedMotion && styles.pressedScale]}
    >
      {busy ? <ActivityIndicator size="small" color={secondary ? Colors.inkMuted : danger ? Colors.danger : Colors.onInk} accessible={false} /> : null}
      <Text style={[styles.buttonText, secondary && styles.secondaryButtonText, danger && styles.dangerButtonText]}>{title}</Text>
    </Pressable>
  );
}

function ActionRow({ icon, title, hint, onPress, disabled, reducedMotion, busy = false, danger = false, last = false }: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  hint: string;
  onPress: () => void;
  disabled: boolean;
  reducedMotion: boolean;
  busy?: boolean;
  danger?: boolean;
  last?: boolean;
}) {
  const inactive = disabled || busy;
  const color = danger ? Colors.danger : Colors.inkSoft;
  return (
    <Pressable
      onPress={() => { if (!inactive) onPress(); }}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={hint}
      accessibilityState={{ disabled: inactive, busy }}
      style={({ pressed }) => [styles.actionRow, last && styles.lastRow, pressed && styles.pressed, pressed && !reducedMotion && styles.pressedScale]}
    >
      <View style={styles.rowIcon} accessible={false} importantForAccessibility="no-hide-descendants"><Ionicons name={icon} size={20} color={color} /></View>
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, danger && styles.dangerButtonText, inactive && styles.disabledText]}>{title}</Text>
        <Text style={styles.rowHint}>{hint}</Text>
      </View>
      <View style={styles.rowAccessory} accessible={false} importantForAccessibility="no-hide-descendants">
        {busy ? <ActivityIndicator size="small" color={color} /> : <Ionicons name="chevron-forward" size={18} color={color} />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screenContent: {
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
    width: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginLeft: -Space.sm,
    borderRadius: Radius.control,
  },
  title: {
    ...Type.h2,
    flex: 1,
    minWidth: 0,
  },
  loadingBlock: {
    paddingVertical: Space.xxl,
    gap: Space.md,
    alignItems: 'center',
  },
  focusContent: {
    gap: Space.md,
  },
  focusTitle: {
    ...Type.title,
  },
  body: {
    ...Type.body,
    color: Colors.inkSoft,
  },
  summary: {
    padding: Space.lg,
    borderRadius: Radius.block,
    backgroundColor: Colors.surfaceAlt,
    marginBottom: Space.xl,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  statusIcon: {
    width: 48,
    height: 48,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.inkTint,
    borderRadius: Radius.pill,
  },
  enabledIcon: {
    backgroundColor: Colors.incomeTint,
  },
  summaryTitle: {
    ...Type.h2,
  },
  summaryText: {
    ...Type.caption,
    color: Colors.inkSoft,
    marginTop: Space.xs,
  },
  fallbackNote: {
    ...Type.caption,
    color: Colors.inkSoft,
    paddingTop: Space.md,
    marginTop: Space.md,
    borderTopWidth: 1,
    borderTopColor: Colors.lineStrong,
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
  actionRow: {
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
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    ...Type.bodyStrong,
  },
  rowHint: {
    ...Type.caption,
    marginTop: Space.xs,
  },
  rowAccessory: {
    width: 20,
    alignItems: 'center',
    flexShrink: 0,
  },
  disabledText: {
    color: Colors.inkMuted,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  dangerArea: {
    backgroundColor: Colors.dangerTint,
    padding: Space.lg,
    borderRadius: Radius.block,
  },
  warningNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.md,
    backgroundColor: Colors.dangerTint,
    padding: Space.lg,
    borderRadius: Radius.block,
  },
  warningText: {
    ...Type.body,
    color: Colors.danger,
    flex: 1,
    minWidth: 0,
  },
  methodNote: {
    padding: Space.md,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.control,
  },
  stepIndicator: {
    ...Type.caption,
    fontFamily: Fonts.semibold,
    color: Colors.ink,
  },
  errorNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.sm,
    paddingVertical: Space.md,
  },
  errorText: {
    ...Type.body,
    color: Colors.danger,
    flex: 1,
    minWidth: 0,
    fontVariant: ['tabular-nums'],
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
    minHeight: 48,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    backgroundColor: Colors.ink,
    borderWidth: 1,
    borderColor: Colors.ink,
    borderRadius: Radius.control,
  },
  buttonText: {
    ...Type.bodyStrong,
    fontFamily: Fonts.semibold,
    color: Colors.onInk,
    flexShrink: 1,
    minWidth: 0,
    textAlign: 'center',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderColor: Colors.lineStrong,
  },
  secondaryButtonText: {
    color: Colors.ink,
  },
  dangerButton: {
    backgroundColor: Colors.dangerTint,
    borderColor: Colors.danger,
  },
  dangerButtonText: {
    color: Colors.danger,
  },
  inactiveButton: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.75,
  },
  pressedScale: {
    transform: [{ scale: 0.98 }],
  },
  pinField: {
    fontFamily: Fonts.semibold,
    fontSize: 20,
    letterSpacing: 4,
    minHeight: 48,
    fontVariant: ['tabular-nums'],
  },
});
