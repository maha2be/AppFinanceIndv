import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Fonts, Space } from '../../utils/theme';
import { createThemedStyles, useTheme } from '../../services/theme';
import { PeriodReport, Transaction, User, DebtSummary } from '../../types';
import { ReportSummaryCard } from '../../components/ReportSummaryCard';
import { QuickInputBar } from '../../components/QuickInputBar';
import { TransactionCard } from '../../components/TransactionCard';
import { DebtSummaryCard } from '../../components/DebtSummaryCard';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Screen } from '../../components/ui/Screen';
import { FadeIn } from '../../components/ui/FadeIn';
import { reportApi } from '../../services/reports';
import { transactionApi } from '../../services/transactions';
import { authApi } from '../../services/auth';
import { debtApi } from '../../services/debts';
import { describeApiError } from '../../services/auth';
import { formatDateIndo } from '../../utils/formatRupiah';
import { localTodayIso } from '../../utils/date';

export default function DashboardScreen() {
  const [user, setUser] = useState<User | null>(null);
  const [report, setReport] = useState<PeriodReport | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [debtSummary, setDebtSummary] = useState<DebtSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const requestSeqRef = useRef(0);
  const theme = useTheme();
  const { colors } = theme;
  const styles = useStyles(theme);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadData = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    const [profileResult, reportResult, txResult, debtResult] = await Promise.allSettled([
      authApi.getProfile(),
      reportApi.getDailyReport(),
      transactionApi.getTransactions({ limit: 10 }),
      debtApi.getSummary(),
    ]);

    if (!mountedRef.current || seq !== requestSeqRef.current) {
      return;
    }

    if (profileResult.status === 'fulfilled') setUser(profileResult.value);
    if (reportResult.status === 'fulfilled') setReport(reportResult.value);
    if (txResult.status === 'fulfilled') setTransactions(txResult.value);
    if (debtResult.status === 'fulfilled') setDebtSummary(debtResult.value);

    const failures = [profileResult, reportResult, txResult, debtResult].filter(
      (result) => result.status === 'rejected'
    );

    if (failures.length === 0) {
      setError(null);
      return;
    }

    const firstFailure = failures[0] as PromiseRejectedResult;
    const allFailed = failures.length === 4;
    setError(
      allFailed
        ? describeApiError(firstFailure.reason, 'Gagal memuat data. Tarik ke bawah untuk mencoba lagi.')
        : 'Sebagian data gagal dimuat. Tarik ke bawah untuk mencoba lagi.'
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <FadeIn>
        <Text style={styles.date}>{formatDateIndo(localTodayIso())}</Text>
        <Text style={styles.greeting} numberOfLines={1}>
          Halo, {user?.first_name || 'Pengguna'}
        </Text>
      </FadeIn>

      <FadeIn delay={60}>
        {error ? <ErrorState message={error} onRetry={loadData} /> : null}
        <ReportSummaryCard report={report} />
      </FadeIn>

      <FadeIn delay={120}>
        <SectionHeader title="Catat cepat" />
        <QuickInputBar onSuccess={loadData} />
      </FadeIn>

      <FadeIn delay={180}>
        <SectionHeader
          title="Hutang & Piutang"
          actionLabel="Lihat"
          onAction={() => router.push('/debts')}
        />
        <Pressable
          onPress={() => router.push('/debts')}
          accessibilityRole="button"
          accessibilityLabel="Buka hutang dan piutang"
          style={({ pressed }) => (pressed ? styles.pressed : null)}
        >
          <DebtSummaryCard summary={debtSummary} />
        </Pressable>
      </FadeIn>

      <FadeIn delay={210}>
        <SectionHeader
          title="Otomatisasi"
          actionLabel="Kelola"
          onAction={() => router.push('/recurring')}
        />
        <Pressable
          onPress={() => router.push('/recurring')}
          accessibilityRole="button"
          accessibilityLabel="Buka transaksi berulang"
          style={({ pressed }) => [styles.recurringRow, pressed ? styles.pressed : null]}
        >
          <View style={styles.recurringIcon}>
            <Ionicons name="repeat" size={17} color={colors.inkSoft} />
          </View>
          <View style={styles.recurringBody}>
            <Text style={styles.recurringTitle}>Transaksi berulang</Text>
            <Text style={styles.recurringHint}>Atur jadwal mingguan atau bulanan</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
        </Pressable>
      </FadeIn>

      <FadeIn delay={240}>
        <SectionHeader
          title="Transaksi terbaru"
          actionLabel="Seluruh Transaksi"
          actionUnderlined
          onAction={() => router.push('/transactions')}
        />

        {transactions.length === 0 ? (
          <EmptyState
            icon="receipt-outline"
            title="Belum ada transaksi tercatat"
            message='Ketik "makan 25000" di kolom catat cepat untuk mulai mencatat.'
            actionLabel="Catat manual"
            onAction={() => router.push('/(tabs)/add')}
          />
        ) : (
          <View>
            {transactions.map((transaction) => (
              <TransactionCard
                key={transaction.id}
                transaction={transaction}
                onPress={() => router.push(`/transaction/${transaction.id}`)}
              />
            ))}
          </View>
        )}

        <Pressable
          onPress={() => router.push('/transaction-history')}
          disabled={false}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Riwayat perubahan"
          style={({ pressed }) => [styles.auditLinkRow, pressed ? styles.pressed : null]}
        >
          <Ionicons name="time-outline" size={16} color={colors.inkSoft} />
          <Text style={styles.auditLinkText}>Riwayat perubahan</Text>
          <Ionicons name="chevron-forward" size={15} color={colors.inkMuted} />
        </Pressable>
      </FadeIn>
    </Screen>
  );
}

const useStyles = createThemedStyles(({ colors, type }) => StyleSheet.create({
  date: {
    ...type.micro,
    textTransform: 'uppercase',
    marginBottom: Space.xs,
  },
  greeting: {
    ...type.h1,
    marginBottom: Space.lg,
  },
  recurringRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: 56,
    paddingVertical: Space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  recurringIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recurringBody: {
    flex: 1,
    minWidth: 0,
  },
  recurringTitle: {
    ...type.bodyStrong,
    color: colors.ink,
  },
  recurringHint: {
    ...type.caption,
    marginTop: 2,
  },
  auditLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    minHeight: 44,
    paddingVertical: Space.sm,
    marginTop: Space.xs,
  },
  auditLinkText: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkSoft,
    flex: 1,
  },
  pressed: {
    opacity: 0.85,
  },
}));