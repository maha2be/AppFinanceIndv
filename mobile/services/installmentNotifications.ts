/** Device-local installment reminder preferences and OS notification scheduler. */
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { Debt } from '../types';
import {
  buildInstallmentNotificationPlans,
  DEFAULT_REMINDER_HOUR,
  DEFAULT_REMINDER_MINUTE,
  findUrgentInstallments,
} from '../utils/installmentReminders';
import { localTodayIso } from '../utils/date';
import { debtApi } from './debts';

const PREF_KEY = 'finance.installmentReminders.v1';
const LAST_IMMEDIATE_KEY = 'finance.installmentReminders.lastImmediate.v1';
const CHANNEL_ID = 'installment-reminders';
const NOTIFICATION_KIND = 'installment-reminder';

export type ReminderPermissionState = 'unknown' | 'granted' | 'denied' | 'unsupported';

export interface InstallmentReminderState {
  ready: boolean;
  enabled: boolean;
  hour: number;
  minute: number;
  permission: ReminderPermissionState;
  scheduledCount: number;
  supported: boolean;
}

interface StoredReminderPrefs {
  enabled: boolean;
  hour: number;
  minute: number;
}

let state: InstallmentReminderState = {
  ready: false,
  enabled: true,
  hour: DEFAULT_REMINDER_HOUR,
  minute: DEFAULT_REMINDER_MINUTE,
  permission: Platform.OS === 'web' ? 'unsupported' : 'unknown',
  scheduledCount: 0,
  supported: Platform.OS !== 'web',
};

let revision = 0;
let storageQueue: Promise<void> = Promise.resolve();
let handlerConfigured = false;
const listeners = new Set<() => void>();

function publish(patch: Partial<InstallmentReminderState>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function getInstallmentReminderState(): InstallmentReminderState {
  return state;
}

export function subscribeInstallmentReminders(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useInstallmentReminders(): InstallmentReminderState {
  if (typeof useSyncExternalStore === 'function') {
    return useSyncExternalStore(
      subscribeInstallmentReminders,
      getInstallmentReminderState,
      getInstallmentReminderState
    );
  }
  return getInstallmentReminderState();
}

function persistInOrder(write: () => Promise<void>): Promise<void> {
  const pending = storageQueue.then(write);
  storageQueue = pending.catch(() => {});
  return pending;
}

function getNotificationsModule(): typeof import('expo-notifications') | null {
  if (Platform.OS === 'web') return null;
  try {
    return require('expo-notifications') as typeof import('expo-notifications');
  } catch {
    return null;
  }
}

export function configureNotificationPresentation(): void {
  if (handlerConfigured) return;
  const Notifications = getNotificationsModule();
  if (!Notifications) return;
  handlerConfigured = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  } catch {
    // Ignore unsupported host runtimes.
  }
}

async function ensureAndroidChannel(
  Notifications: typeof import('expo-notifications')
): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Pengingat Cicilan',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 200, 250],
      sound: 'default',
    });
  } catch {
    // Best-effort channel creation.
  }
}

function parseStoredPrefs(raw: string | null): StoredReminderPrefs | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredReminderPrefs>;
    if (typeof parsed.enabled !== 'boolean') return null;
    const hour =
      typeof parsed.hour === 'number' && Number.isInteger(parsed.hour) && parsed.hour >= 0 && parsed.hour <= 23
        ? parsed.hour
        : DEFAULT_REMINDER_HOUR;
    const minute =
      typeof parsed.minute === 'number' &&
      Number.isInteger(parsed.minute) &&
      parsed.minute >= 0 &&
      parsed.minute <= 59
        ? parsed.minute
        : DEFAULT_REMINDER_MINUTE;
    return { enabled: parsed.enabled, hour, minute };
  } catch {
    return null;
  }
}

async function readStorage(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      const storage = (globalThis as { localStorage?: { getItem(k: string): string | null } }).localStorage;
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function writeStorage(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      const storage = (globalThis as { localStorage?: { setItem(k: string, v: string): void } }).localStorage;
      storage?.setItem(key, value);
    } catch {
      // Ignore restricted web storage.
    }
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function inspectPermission(
  Notifications: typeof import('expo-notifications') | null
): Promise<ReminderPermissionState> {
  if (!Notifications) return 'unsupported';
  try {
    const res = await Notifications.getPermissionsAsync();
    if (res.granted || res.status === 'granted') return 'granted';
    return res.canAskAgain === false ? 'denied' : 'unknown';
  } catch {
    return 'unsupported';
  }
}

async function cancelExistingInstallmentNotifications(
  Notifications: typeof import('expo-notifications'),
  includeImmediate = false
): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const item of scheduled) {
    const data = item.content?.data as { kind?: string; immediate?: boolean } | undefined;
    if (data?.kind === NOTIFICATION_KIND && (includeImmediate || !data.immediate)) {
      await Notifications.cancelScheduledNotificationAsync(item.identifier);
    }
  }
}

export async function hydrateInstallmentReminders(): Promise<InstallmentReminderState> {
  const ticket = revision;
  configureNotificationPresentation();
  const Notifications = getNotificationsModule();
  if (Notifications) {
    await ensureAndroidChannel(Notifications);
  }

  await storageQueue;
  const raw = await readStorage(PREF_KEY);
  const prefs = parseStoredPrefs(raw);
  const permission = await inspectPermission(Notifications);

  if (ticket !== revision) {
    return state;
  }

  publish({
    ready: true,
    enabled: prefs?.enabled ?? true,
    hour: prefs?.hour ?? DEFAULT_REMINDER_HOUR,
    minute: prefs?.minute ?? DEFAULT_REMINDER_MINUTE,
    permission,
    supported: Notifications !== null,
  });
  return state;
}

export async function requestInstallmentNotificationPermission(): Promise<ReminderPermissionState> {
  const Notifications = getNotificationsModule();
  if (!Notifications) {
    publish({ permission: 'unsupported', supported: false });
    return 'unsupported';
  }
  configureNotificationPresentation();
  await ensureAndroidChannel(Notifications);

  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted || current.status === 'granted') {
      publish({ permission: 'granted', supported: true });
      return 'granted';
    }
    const requested = await Notifications.requestPermissionsAsync();
    const next: ReminderPermissionState =
      requested.granted || requested.status === 'granted' ? 'granted' : 'denied';
    publish({ permission: next, supported: true });
    return next;
  } catch {
    publish({ permission: 'denied' });
    return 'denied';
  }
}

export async function setInstallmentRemindersEnabled(enabled: boolean): Promise<ReminderPermissionState> {
  const ticket = ++revision;
  let permission = state.permission;

  if (enabled) {
    permission = await requestInstallmentNotificationPermission();
  }

  publish({ enabled, permission });

  await persistInOrder(async () => {
    if (ticket !== revision) return;
    await writeStorage(
      PREF_KEY,
      JSON.stringify({ enabled, hour: state.hour, minute: state.minute })
    );
  });

  if (!enabled) {
    const Notifications = getNotificationsModule();
    if (Notifications) {
      try {
        await cancelExistingInstallmentNotifications(Notifications, true);
      } catch {
        // Ignore native cancellation error.
      }
    }
    publish({ scheduledCount: 0 });
  } else if (permission === 'granted') {
    await syncInstallmentRemindersFromApi();
  }

  return permission;
}

export async function setInstallmentReminderTime(hour: number, minute = 0): Promise<void> {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return;
  const ticket = ++revision;
  publish({ hour, minute });

  await persistInOrder(async () => {
    if (ticket !== revision) return;
    await writeStorage(
      PREF_KEY,
      JSON.stringify({ enabled: state.enabled, hour, minute })
    );
  });

  if (state.enabled && state.permission === 'granted') {
    await syncInstallmentRemindersFromApi();
  }
}

export async function syncInstallmentReminders(debts: readonly Debt[]): Promise<number> {
  const Notifications = getNotificationsModule();
  if (!Notifications) {
    publish({ scheduledCount: 0, supported: false, permission: 'unsupported' });
    return 0;
  }

  configureNotificationPresentation();
  const permission = await inspectPermission(Notifications);
  publish({ permission, supported: true });

  if (!state.enabled || permission !== 'granted') {
    try {
      await cancelExistingInstallmentNotifications(Notifications);
    } catch {
      // Ignore cleanup errors.
    }
    publish({ scheduledCount: 0 });
    return 0;
  }

  await ensureAndroidChannel(Notifications);
  await cancelExistingInstallmentNotifications(Notifications);

  const now = new Date();
  const plans = buildInstallmentNotificationPlans(debts, {
    now,
    hour: state.hour,
    minute: state.minute,
  });

  let scheduled = 0;
  for (const plan of plans) {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: plan.title,
          body: plan.body,
          sound: 'default',
          data: {
            kind: NOTIFICATION_KIND,
            route: '/debts',
            debtId: plan.debtId,
            planId: plan.id,
          },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(plan.fireAtMs),
          channelId: Platform.OS === 'android' ? CHANNEL_ID : undefined,
        },
      });
      scheduled += 1;
    } catch {
      // Continue scheduling remaining reminders if one trigger is rejected.
    }
  }

  // Also deliver at most one immediate reminder per day when a debt is already
  // due today or overdue and today's scheduled slot already passed.
  const todayIso = localTodayIso();
  const urgent = findUrgentInstallments(debts, todayIso, 0);
  if (urgent.length > 0) {
    const first = urgent[0];
    const signature = `${todayIso}:${first.debt.id}:${first.remaining}:${urgent.length}`;
    const lastSent = await readStorage(LAST_IMMEDIATE_KEY);
    if (lastSent !== signature) {
      const title =
        urgent.length > 1
          ? `Segera bayar ${urgent.length} cicilan`
          : first.urgency === 'overdue'
          ? 'Cicilan lewat jatuh tempo'
          : 'Segera bayar cicilan hari ini';
      const body =
        urgent.length > 1
          ? `${first.detail} Dan ${urgent.length - 1} cicilan lainnya.`
          : first.detail;
      try {
        await Notifications.scheduleNotificationAsync({
          content: {
            title,
            body,
            sound: 'default',
            data: {
              kind: NOTIFICATION_KIND,
              immediate: true,
              route: '/debts',
              debtId: first.debt.id,
            },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: 2,
            channelId: Platform.OS === 'android' ? CHANNEL_ID : undefined,
          },
        });
        await writeStorage(LAST_IMMEDIATE_KEY, signature);
      } catch {
        // Ignore if immediate scheduling is blocked.
      }
    }
  }

  publish({ scheduledCount: scheduled });
  return scheduled;
}

export async function syncInstallmentRemindersFromApi(): Promise<number> {
  try {
    const activeDebts = await debtApi.getDebts({ type: 'debt', status: 'active', limit: 100 });
    return await syncInstallmentReminders(activeDebts);
  } catch {
    return state.scheduledCount;
  }
}

export async function sendTestInstallmentNotification(debts?: readonly Debt[]): Promise<void> {
  const Notifications = getNotificationsModule();
  if (!Notifications) {
    throw new Error('Notifikasi perangkat tidak tersedia di versi web.');
  }

  const permission = await requestInstallmentNotificationPermission();
  if (permission !== 'granted') {
    throw new Error('Izin notifikasi belum diaktifkan. Aktifkan izin notifikasi di pengaturan perangkat.');
  }

  await ensureAndroidChannel(Notifications);
  const todayIso = localTodayIso();
  const urgent = debts ? findUrgentInstallments(debts, todayIso, 7) : [];
  const sample = urgent[0];

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Segera bayar cicilan',
      body: sample
        ? sample.detail
        : 'Contoh pengingat: cicilan jatuh tempo akan muncul otomatis di sini sebelum hari-H.',
      sound: 'default',
      data: {
        kind: NOTIFICATION_KIND,
        route: '/debts',
      },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 2,
      channelId: Platform.OS === 'android' ? CHANNEL_ID : undefined,
    },
  });
}
