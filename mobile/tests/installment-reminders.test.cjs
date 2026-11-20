/**
 * Unit, service, and UI regressions for installment due-soon notifications
 * ("Segera bayar cicilan").
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const { createHarness, loadTsModule, mobileRoot, tokenProxy } = require('./support/screen-harness.cjs');

function node(type, props = {}) {
  const children = props.children === undefined ? [] : [props.children].flat(Infinity);
  return { type, props, children };
}

const stub = (type) => (props = {}) => node(type, props);

const remindersMath = loadTsModule(
  path.join(mobileRoot, 'utils/installmentReminders.ts'),
  (name) => {
    throw new Error(`Unexpected import in installmentReminders.ts: ${name}`);
  }
);

function makeDebt(overrides = {}) {
  return {
    id: 1,
    user_id: 1,
    type: 'debt',
    person_name: 'Andi',
    total_amount: 1_000_000,
    paid_amount: 400_000,
    due_date: '2026-11-22',
    status: 'active',
    cash_synced: false,
    ...overrides,
  };
}

function createNotificationServiceHarness(options = {}) {
  const store = new Map(Object.entries(options.initialStore || {}));
  const scheduled = [...(options.initialScheduled || [])];
  const cancelledIds = [];
  const createdChannels = [];
  let permissionStatus = options.permissionStatus ?? 'granted';
  let requestResult = options.requestResult ?? 'granted';
  let nextId = 1;

  const serviceFile = path.join(mobileRoot, 'services/installmentNotifications.ts');
  const serviceJs = ts.transpileModule(fs.readFileSync(serviceFile, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: false },
  }).outputText;

  const sandbox = {
    exports: {},
    module: { exports: {} },
    console,
    Date,
    Math,
    Promise,
    Set,
    Map,
    JSON,
    Number,
    String,
    Boolean,
    Error,
  };
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;

  const NotificationsMock = {
    SchedulableTriggerInputTypes: { DATE: 'date', TIME_INTERVAL: 'timeInterval' },
    AndroidImportance: { HIGH: 4 },
    setNotificationHandler: () => {},
    setNotificationChannelAsync: async (id, cfg) => {
      createdChannels.push({ id, cfg });
    },
    getPermissionsAsync: async () => ({
      granted: permissionStatus === 'granted',
      status: permissionStatus,
      canAskAgain: permissionStatus !== 'denied',
    }),
    requestPermissionsAsync: async () => {
      permissionStatus = requestResult;
      return {
        granted: requestResult === 'granted',
        status: requestResult,
        canAskAgain: requestResult !== 'denied',
      };
    },
    getAllScheduledNotificationsAsync: async () => [...scheduled],
    cancelScheduledNotificationAsync: async (id) => {
      cancelledIds.push(id);
      const idx = scheduled.findIndex((item) => item.identifier === id);
      if (idx >= 0) scheduled.splice(idx, 1);
    },
    scheduleNotificationAsync: async (req) => {
      const identifier = `notif-${nextId++}`;
      scheduled.push({ identifier, ...req });
      return identifier;
    },
  };

  sandbox.require = (name) => {
    if (name === '../utils/installmentReminders') return remindersMath;
    if (name === '../utils/date') return { localTodayIso: () => options.todayIso || '2026-11-20' };
    if (name === './debts') {
      return {
        debtApi: {
          getDebts: async () => options.apiDebts || [],
        },
      };
    }
    if (name === 'react') return { useSyncExternalStore: (_s, g) => g() };
    if (name === 'react-native') return { Platform: { OS: options.os || 'android' } };
    if (name === 'expo-secure-store') {
      return {
        getItemAsync: async (key) => (store.has(key) ? store.get(key) : null),
        setItemAsync: async (key, value) => {
          store.set(key, value);
        },
      };
    }
    if (name === 'expo-notifications') return NotificationsMock;
    throw new Error(`Unexpected module in installmentNotifications.ts: ${name}`);
  };

  vm.runInNewContext(serviceJs, sandbox, { filename: serviceFile });
  const service = Object.keys(sandbox.module.exports).length
    ? sandbox.module.exports
    : sandbox.exports;

  return { service, store, scheduled, cancelledIds, createdChannels };
}

test('findUrgentInstallments ranks overdue, today, and due-soon debts while ignoring settled and receivables', () => {
  const debts = [
    makeDebt({ id: 1, person_name: 'Jauh', due_date: '2026-11-28' }),
    makeDebt({ id: 2, person_name: 'Piutang Dekat', type: 'receivable', due_date: '2026-11-20' }),
    makeDebt({ id: 3, person_name: 'Lunas', status: 'settled', due_date: '2026-11-20' }),
    makeDebt({ id: 4, person_name: 'Lusa', due_date: '2026-11-22', total_amount: 500_000, paid_amount: 0 }),
    makeDebt({ id: 5, person_name: 'Hari Ini', due_date: '2026-11-20', total_amount: 300_000, paid_amount: 100_000 }),
    makeDebt({ id: 6, person_name: 'Telat', due_date: '2026-11-18', total_amount: 400_000, paid_amount: 0 }),
  ];

  const urgent = remindersMath.findUrgentInstallments(debts, '2026-11-20');
  assert.deepEqual(
    JSON.parse(JSON.stringify(urgent.map((u) => ({ id: u.debt.id, urgency: u.urgency, remaining: u.remaining })))),
    [
      { id: 6, urgency: 'overdue', remaining: 400_000 },
      { id: 5, urgency: 'today', remaining: 200_000 },
      { id: 4, urgency: 'soon', remaining: 500_000 },
    ]
  );
  assert.match(urgent[0].detail, /lewat jatuh tempo/);
  assert.match(urgent[1].detail, /Segera bayar cicilan/);
  assert.match(urgent[2].detail, /jatuh tempo 22 Nov 2026/);
});

test('buildInstallmentNotificationPlans creates H-3, H-1, and Hari-H triggers in chronological order after now', () => {
  const now = new Date(2026, 10, 20, 10, 0, 0, 0); // 2026-11-20 10:00 local
  const debts = [
    makeDebt({ id: 9, person_name: 'Budi', due_date: '2026-11-22', total_amount: 600_000, paid_amount: 100_000 }),
  ];

  const plans = remindersMath.buildInstallmentNotificationPlans(debts, {
    now,
    hour: 9,
    minute: 0,
  });

  // H-3 (Nov 19 09:00) is in the past so skipped; H-1 (Nov 21 09:00) & H-0 (Nov 22 09:00) stay.
  assert.equal(plans.length, 2);
  assert.equal(plans[0].offsetDays, 1);
  assert.equal(plans[0].title, 'Besok jatuh tempo cicilan');
  assert.match(plans[0].body, /Budi/);
  assert.equal(plans[1].offsetDays, 0);
  assert.equal(plans[1].title, 'Segera bayar cicilan hari ini');
});

test('syncInstallmentReminders cancels stale installment alerts, preserves unrelated ones, and deduplicates immediate reminders', async () => {
  const { service, scheduled, cancelledIds } = createNotificationServiceHarness({
    todayIso: '2026-11-20',
    initialScheduled: [
      { identifier: 'old-inst', content: { data: { kind: 'installment-reminder' } } },
      { identifier: 'other-app', content: { data: { kind: 'something-else' } } },
    ],
  });

  await service.hydrateInstallmentReminders();

  const debts = [
    makeDebt({ id: 1, person_name: 'Andi', due_date: '2026-11-19', total_amount: 500_000, paid_amount: 0 }),
    makeDebt({ id: 2, person_name: 'Sari', due_date: '2026-11-28', total_amount: 800_000, paid_amount: 0 }),
  ];

  const count = await service.syncInstallmentReminders(debts);
  assert.deepEqual(cancelledIds, ['old-inst']);
  assert.ok(scheduled.some((n) => n.identifier === 'other-app'));
  // Sari has H-3, H-1, Hari-H future triggers (3) + 1 immediate trigger for overdue Andi.
  assert.equal(count, 3);
  const immediate = scheduled.filter((n) => n.trigger?.type === 'timeInterval');
  assert.equal(immediate.length, 1);
  assert.match(immediate[0].content.title, /Cicilan lewat jatuh tempo/);

  // Re-syncing the same day does not fire a duplicate immediate notification.
  await service.syncInstallmentReminders(debts);
  const immediateAfter = scheduled.filter((n) => n.trigger?.type === 'timeInterval');
  assert.equal(immediateAfter.length, 1);

  // Disabling cancels all installment reminders while keeping unrelated ones.
  await service.setInstallmentRemindersEnabled(false);
  assert.equal(service.getInstallmentReminderState().scheduledCount, 0);
  assert.deepEqual(scheduled.map((n) => n.identifier), ['other-app']);
});

test('sendTestInstallmentNotification schedules an immediate notification or fails cleanly if denied', async () => {
  const granted = createNotificationServiceHarness({ permissionStatus: 'granted' });
  await granted.service.sendTestInstallmentNotification();
  assert.equal(granted.scheduled.length, 1);
  assert.equal(granted.scheduled[0].content.title, 'Segera bayar cicilan');

  const denied = createNotificationServiceHarness({ permissionStatus: 'unknown', requestResult: 'denied' });
  await assert.rejects(() => denied.service.sendTestInstallmentNotification(), /Izin notifikasi belum diaktifkan/);
});

test('DashboardScreen shows Segera bayar cicilan banner for due-soon debts and navigates to /debts', async () => {
  const pushes = [];
  const synced = [];
  const today = new Date().toISOString().slice(0, 10);

  const harness = createHarness({
    componentPath: 'app/(tabs)/index.tsx',
    modules: {
      'expo-router': {
        router: { push: (route) => pushes.push(route), replace: () => {}, back: () => {} },
        useFocusEffect: (cb) => harness.React.useEffect(() => cb(), [cb]),
      },
    },
    moduleFallback: [
      [/components\/ui\/Screen$/, { Screen: stub('Screen') }],
      [/components\/ui\/FadeIn$/, { FadeIn: stub('View') }],
      [/components\/ui\/SectionHeader$/, { SectionHeader: stub('SectionHeader') }],
      [/components\/ui\/EmptyState$/, { EmptyState: stub('View') }],
      [/components\/ui\/ErrorState$/, { ErrorState: stub('View') }],
      [/components\/ReportSummaryCard$/, { ReportSummaryCard: stub('View') }],
      [/components\/QuickInputBar$/, { QuickInputBar: stub('View') }],
      [/components\/DebtSummaryCard$/, { DebtSummaryCard: stub('View') }],
      [/components\/TransactionCard$/, { TransactionCard: stub('View') }],
      [/services\/reports$/, { reportApi: { getDailyReport: async () => ({ title: 'Harian', net: 0, total_income: 0, total_expense: 0, total_investment: 0, top_expense_categories: [], start_date: today, end_date: today, average_expense: 0, investment_percentage: 0 }), getWeeklyReport: async () => ({}), getMonthlyReport: async () => ({}) } }],
      [/services\/transactions$/, { transactionApi: { getTransactions: async () => [] } }],
      [/services\/auth$/, { authApi: { getProfile: async () => ({ id: 1, first_name: 'Ayu' }) }, describeApiError: (_e, f) => f }],
      [/services\/debts$/, {
        debtApi: {
          getSummary: async () => ({ total_debt_remaining: 500_000, total_receivable_remaining: 0, active_debt_count: 1, active_receivable_count: 0, due_soon_count: 1 }),
          getDebts: async () => [makeDebt({ id: 11, person_name: 'Toko Motor', due_date: today, total_amount: 500_000, paid_amount: 0 })],
        },
      }],
      [/services\/installmentNotifications$/, {
        syncInstallmentReminders: async (debts) => {
          synced.push(debts);
          return 1;
        },
      }],
    ],
  });

  await harness.mount();

  assert.equal(synced.length, 1);
  assert.equal(synced[0][0].person_name, 'Toko Motor');
  assert.ok(harness.texts().includes('Segera bayar cicilan'));
  assert.ok(harness.byLabel('Notifikasi segera bayar cicilan'));

  await harness.press('Notifikasi segera bayar cicilan');
  assert.deepEqual(pushes, ['/debts']);
});

test('SettingsScreen exposes Pengingat cicilan toggle, time selector, and test trigger', async () => {
  const calls = { toggles: [], hours: [], tests: 0, alerts: [] };
  const reminderState = {
    ready: true,
    enabled: true,
    hour: 9,
    minute: 0,
    permission: 'granted',
    scheduledCount: 2,
    supported: true,
  };

  const harness = createHarness({
    componentPath: 'app/settings.tsx',
    modules: {
      'expo-router': {
        router: { back: () => {}, push: () => {}, replace: () => {} },
        useFocusEffect: (cb) => harness.React.useEffect(() => cb(), [cb]),
      },
      'react-native': { useWindowDimensions: () => ({ width: 390, height: 844, scale: 1, fontScale: 1 }) },
      '../utils/theme': { Colors: tokenProxy(), Fonts: tokenProxy(), Radius: tokenProxy(), Space: tokenProxy(), Type: tokenProxy() },
      '../components/ui/Screen': { Screen: stub('Screen') },
      '../components/ui/FadeIn': { FadeIn: stub('FadeIn') },
      '../components/auth/LinkGoogleSheet': { LinkGoogleSheet: stub('LinkGoogleSheet') },
      '../services/appAlert': { AppAlert: { alert: (t, m) => calls.alerts.push({ t, m }) } },
      '../services/auth': {
        authApi: { getProfile: async () => ({ id: 1, currency: 'IDR', timezone: 'Asia/Jakarta', has_password: true, google_linked: false, telegram_linked: false }) },
        describeApiError: (_e, f) => f,
      },
      '../services/googleAuth': { isGoogleAuthAvailable: async () => false },
      '../services/appLock': { getAppLockState: () => ({ ready: true, supported: true, enabled: false }), subscribeAppLock: () => () => {} },
      '../services/installmentNotifications': {
        useInstallmentReminders: () => reminderState,
        setInstallmentRemindersEnabled: async (next) => {
          calls.toggles.push(next);
          reminderState.enabled = next;
          harness.flush();
          return 'granted';
        },
        setInstallmentReminderTime: async (hour) => {
          calls.hours.push(hour);
          reminderState.hour = hour;
          harness.flush();
        },
        sendTestInstallmentNotification: async () => {
          calls.tests += 1;
        },
      },
    },
  });

  await harness.mount();

  assert.ok(harness.texts().includes('Pengingat cicilan'));
  assert.ok(harness.byLabel('Aktifkan pengingat cicilan'));
  assert.ok(harness.byLabel('Jam pengingat 08:00'));
  assert.ok(harness.byLabel('Jam pengingat 09:00'));
  assert.ok(harness.byLabel('Jam pengingat 20:00'));
  assert.ok(harness.byLabel('Uji notifikasi cicilan'));

  await harness.press('Jam pengingat 20:00');
  assert.deepEqual(calls.hours, [20]);

  await harness.press('Uji notifikasi cicilan');
  assert.equal(calls.tests, 1);
  assert.equal(calls.alerts[0].t, 'Notifikasi dijadwalkan');

  harness.byLabel('Aktifkan pengingat cicilan').props.onValueChange(false);
  await harness.settle();
  assert.deepEqual(calls.toggles, [false]);
  assert.equal(harness.byLabel('Uji notifikasi cicilan'), undefined);
});
